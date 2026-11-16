import { api, apriDialogo, avviso, chiudiDialogo, corrente, h, testoData } from "./comune.js";

export const RUOLI = {
  titolare: { nome: "Titolare", aiuto: "Tutto, comprese impostazioni, sala, esportazioni e persone." },
  staff: { nome: "Staff", aiuto: "Agenda, sala, ordini, clienti e buoni. Non cambia impostazioni né persone." },
  lettura: { nome: "Sola lettura", aiuto: "Vede tutto ma non modifica nulla. Utile per un commercialista o un socio." },
};
const STATI = {
  attivo: "Attivo",
  prova: "In prova",
  prova_scaduta: "Prova scaduta",
  sospeso: "Sospeso",
  disattivato: "Disattivato",
};
const MODULI = { whatsapp: "WhatsApp automatico", fidelity: "Raccolta punti", gift: "Gift card", sondaggi: "Sondaggi dopo la visita", ordini: "Asporto e consegna" };

const quando = (iso) => (iso ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(iso)) : "mai");

/** Mostra il link di invito: se l'email è partita basta un avviso, altrimenti il gestore lo copia e lo manda lui. */
export function mostraInvito(esito, email) {
  if (esito.inviata) {
    avviso(`Invito inviato a ${email}.`);
    return;
  }
  const campo = h("input", { value: esito.link, readonly: true, class: "largo", "aria-label": "Link di invito" });
  apriDialogo(
    h("h2", {}, "Link di accesso"),
    h("p", {}, `Manda questo link a ${email}: con il link sceglie la sua password. Vale 7 giorni ed è personale.`),
    campo,
    h(
      "div",
      { class: "pulsanti-dialogo" },
      h("button", {
        type: "button",
        class: "azione compatta",
        onclick: async () => {
          campo.select();
          await navigator.clipboard?.writeText(esito.link).catch(() => {});
          avviso("Link copiato.");
        },
      }, "Copia il link"),
      h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Chiudi"),
    ),
  );
}

export async function vistaAccount(contenitore) {
  const s = corrente.sessione;
  const r = s.ristorante;
  const titolare = s.utente.ruolo === "titolare";

  const errorePw = h("p", { class: "messaggio", role: "alert", hidden: true });
  const formPw = h(
    "form",
    {
      class: "campi",
      onsubmit: async (e) => {
        e.preventDefault();
        errorePw.hidden = true;
        const d = new FormData(e.target);
        if (d.get("nuova") !== d.get("ripeti")) {
          errorePw.textContent = "Le due password nuove non coincidono.";
          errorePw.hidden = false;
          return;
        }
        try {
          await api("/api/admin/password", { metodo: "POST", corpo: { attuale: d.get("attuale"), nuova: d.get("nuova") } });
          e.target.reset();
          avviso("Password cambiata.");
        } catch (err) {
          errorePw.textContent = err.message;
          errorePw.hidden = false;
        }
      },
    },
    h("label", {}, "Password attuale", h("input", { type: "password", name: "attuale", autocomplete: "current-password", required: true })),
    h("label", {}, "Nuova password", h("input", { type: "password", name: "nuova", autocomplete: "new-password", minlength: 10, required: true })),
    h("label", {}, "Ripeti la nuova password", h("input", { type: "password", name: "ripeti", autocomplete: "new-password", minlength: 10, required: true })),
    errorePw,
    h("button", { type: "submit", class: "azione compatta" }, "Cambia password"),
  );

  const persone = h("div", {});
  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Account")),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Il tuo accesso"),
      h(
        "dl",
        { class: "scheda-dati" },
        h("div", {}, h("dt", {}, "Nome"), h("dd", {}, s.utente.nome || "–")),
        h("div", {}, h("dt", {}, "Email"), h("dd", {}, s.utente.email || "Accesso con la password principale")),
        h("div", {}, h("dt", {}, "Ruolo"), h("dd", {}, RUOLI[s.utente.ruolo]?.nome ?? s.utente.ruolo)),
      ),
      s.assistenza
        ? h("p", { class: "legenda" }, "Sei entrato come assistenza dalla piattaforma: le modifiche restano nel registro.")
        : s.utente.id
          ? formPw
          : h("p", { class: "legenda" }, "Stai usando la password principale. Per un accesso personale chiedi un invito con la tua email."),
    ),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Abbonamento"),
      h(
        "dl",
        { class: "scheda-dati" },
        h("div", {}, h("dt", {}, "Piano"), h("dd", {}, r.piano)),
        h("div", {}, h("dt", {}, "Stato"), h("dd", {}, STATI[r.stato] ?? r.stato, r.stato === "prova" && r.prova_fino ? ` fino al ${testoData(r.prova_fino, { day: "numeric", month: "long", year: "numeric" })}` : "")),
        h("div", {}, h("dt", {}, "Funzioni incluse"), h("dd", {}, ["Prenotazioni, menù, QR, CRM, recensioni", ...r.moduli.map((m) => MODULI[m] ?? m)].join(" · "))),
        h("div", {}, h("dt", {}, "Indirizzo pubblico"), h("dd", {}, h("a", { href: r.indirizzo, target: "_blank", rel: "noopener" }, r.indirizzo))),
      ),
      h("p", { class: "legenda" }, "Per cambiare piano o aggiungere funzioni contatta l'assistenza."),
    ),
    h("section", { class: "blocco", hidden: !titolare }, h("h2", {}, "Persone che usano il pannello"), persone),
  );

  if (!titolare) return {};

  async function carica() {
    const { utenti, io } = await api("/api/admin/utenti");
    const errore = h("p", { class: "messaggio", role: "alert", hidden: true });
    const nuovo = h(
      "form",
      {
        class: "riga-modifica invito",
        onsubmit: async (e) => {
          e.preventDefault();
          errore.hidden = true;
          const d = Object.fromEntries(new FormData(e.target));
          try {
            const esito = await api("/api/admin/utenti", { metodo: "POST", corpo: d });
            e.target.reset();
            mostraInvito(esito, d.email);
            carica();
          } catch (err) {
            errore.textContent = err.message;
            errore.hidden = false;
          }
        },
      },
      h("label", { class: "cresce" }, "Email", h("input", { type: "email", name: "email", required: true, autocomplete: "off" })),
      h("label", {}, "Nome", h("input", { name: "nome", maxlength: 80 })),
      h("label", {}, "Ruolo", h("select", { name: "ruolo" }, Object.entries(RUOLI).map(([k, v]) => h("option", { value: k, selected: k === "staff" }, v.nome)))),
      h("button", { type: "submit", class: "azione compatta" }, "Invita"),
    );
    persone.replaceChildren(
      h("p", { class: "legenda" }, "Ognuno entra con la propria email e password. ", Object.values(RUOLI).map((v) => `${v.nome}: ${v.aiuto} `)),
      h(
        "div",
        { class: "tabella-scorre" },
        h(
          "table",
          { class: "tabella" },
          h("thead", {}, h("tr", {}, h("th", {}, "Persona"), h("th", {}, "Ruolo"), h("th", {}, "Ultimo accesso"), h("th", {}, "Stato"), h("th", {}, ""))),
          h(
            "tbody",
            {},
            utenti.map((u) => {
              const io_ = u.id === io;
              const cambia = async (corpo) => {
                try {
                  await api(`/api/admin/utenti/${u.id}`, { metodo: "PATCH", corpo });
                  avviso("Fatto.");
                } catch (err) {
                  avviso(err.message, "errore");
                }
                carica();
              };
              return h(
                "tr",
                { class: u.attivo ? "" : "spento" },
                h("td", {}, h("strong", {}, u.nome || u.email), u.nome ? h("br") : null, u.nome ? h("small", {}, u.email) : null),
                h(
                  "td",
                  {},
                  h(
                    "select",
                    { "aria-label": `Ruolo di ${u.email}`, disabled: io_, onchange: (e) => cambia({ ruolo: e.target.value }) },
                    Object.entries(RUOLI).map(([k, v]) => h("option", { value: k, selected: k === u.ruolo }, v.nome)),
                  ),
                ),
                h("td", {}, u.attivato ? quando(u.ultimo_accesso) : "Invito in attesa"),
                h("td", {}, u.attivo ? "Attivo" : "Disattivato"),
                h(
                  "td",
                  { class: "azioni-riga" },
                  u.attivo
                    ? h("button", {
                        type: "button",
                        class: "secondario",
                        onclick: async () => {
                          try {
                            mostraInvito(await api(`/api/admin/utenti/${u.id}/invito`, { metodo: "POST" }), u.email);
                          } catch (err) {
                            avviso(err.message, "errore");
                          }
                        },
                      }, u.attivato ? "Reimposta password" : "Nuovo invito")
                    : null,
                  io_ ? h("span", { class: "legenda" }, "Sei tu") : h("button", { type: "button", class: `secondario${u.attivo ? " pericolo" : ""}`, onclick: () => cambia({ attivo: !u.attivo }) }, u.attivo ? "Disattiva" : "Riattiva"),
                ),
              );
            }),
          ),
        ),
      ),
      h("h3", { class: "titolo-sezione-piccolo" }, "Invita una persona"),
      nuovo,
      errore,
    );
  }
  await carica();
  return {};
}
