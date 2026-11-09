import {
  ATTIVI,
  OCCASIONI,
  ORIGINI,
  STATI,
  aMinuti,
  api,
  apriDialogo,
  avviso,
  campoData,
  chiudiDialogo,
  condiviso,
  daMinuti,
  etichettaTavolo,
  h,
  oraRoma,
  oggiRoma,
  persone,
  testoData,
} from "./comune.js";

const FILTRI = { tutto: "Tutto il giorno", pranzo: "Pranzo", cena: "Cena" };

export async function cambiaStato(id, stato) {
  await api(`/api/admin/prenotazioni/${id}`, { metodo: "PATCH", corpo: { stato } });
}

export async function cambiaTavolo(id, tavolo_id) {
  await api(`/api/admin/prenotazioni/${id}`, { metodo: "PATCH", corpo: { tavolo_id } });
}

/** Azioni disponibili per ciascuno stato, con l'etichetta del pulsante e lo stato di arrivo. */
export function azioniPer(stato) {
  switch (stato) {
    case "in_attesa":
      return [["Conferma", "confermata"], ["Arrivati", "arrivata"], ["Annulla", "annullata"]];
    case "confermata":
      return [["Arrivati", "arrivata"], ["Non presentati", "no_show"], ["Annulla", "annullata"]];
    case "arrivata":
      return [["Annulla arrivo", "confermata"]];
    default:
      return [["Ripristina", "confermata"]];
  }
}

export function selettoreTavolo(p, tavoli, sale, onCambia) {
  const select = h(
    "select",
    { "aria-label": `Tavolo per ${p.nome}`, class: "scegli-tavolo" },
    h("option", { value: "", selected: !p.tavolo_id }, "Senza tavolo"),
    sale.map((s) =>
      h(
        "optgroup",
        { label: s.nome },
        tavoli
          .filter((t) => t.sala_id === s.id)
          .map((t) =>
            h(
              "option",
              { value: t.id, selected: t.id === p.tavolo_id },
              `${etichettaTavolo(t)}${p.persone > t.posti_max ? ", troppo piccolo" : ""}`,
            ),
          ),
      ),
    ),
  );
  select.addEventListener("change", () => onCambia(select.value || null, select));
  return select;
}

function rigaPrenotazione(p, dati, ricarica) {
  const etichette = [];
  if (p.occasione) etichette.push(h("span", { class: "etichetta occasione" }, OCCASIONI[p.occasione] ?? p.occasione));
  if (p.visite >= 2) etichette.push(h("span", { class: "etichetta abituale" }, `Cliente abituale, ${p.visite} visite`));
  else if (p.visite === 1) etichette.push(h("span", { class: "etichetta" }, "Già venuto una volta"));
  if (p.no_show) etichette.push(h("span", { class: "etichetta allerta" }, `${p.no_show} ${p.no_show === 1 ? "assenza" : "assenze"} in passato`));
  if (p.origine !== "online") etichette.push(h("span", { class: "etichetta" }, ORIGINI[p.origine]));
  if (p.sconto) etichette.push(h("span", { class: "etichetta sconto" }, `Sconto ${p.sconto}%`));

  const azioni = azioniPer(p.stato).map(([testo, nuovo]) =>
    h("button", {
      type: "button",
      class: nuovo === "annullata" || nuovo === "no_show" ? "secondario pericolo" : "secondario",
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await cambiaStato(p.id, nuovo);
          avviso(`${p.nome}: ${STATI[nuovo].toLowerCase()}.`);
          await ricarica();
        } catch (err) {
          avviso(err.message, "errore");
          await ricarica();
        }
      },
    }, testo),
  );

  const tavolo = selettoreTavolo(p, dati.tavoli, dati.sale, async (valore, select) => {
    select.disabled = true;
    try {
      await cambiaTavolo(p.id, valore);
      avviso(valore ? `${p.nome} spostato al tavolo ${dati.tavoli.find((t) => t.id === valore).nome}.` : `${p.nome} è ora senza tavolo.`);
    } catch (err) {
      avviso(err.message, "errore");
    }
    await ricarica();
  });

  return h(
    "article",
    { class: "riga", dataset: { stato: p.stato } },
    h("div", { class: "quanti", title: "Persone" }, String(p.persone)),
    h(
      "div",
      { class: "chi" },
      h("p", { class: "nome-cliente" }, h("strong", {}, p.nome), h("span", { class: `badge-stato stato-${p.stato}` }, STATI[p.stato])),
      h(
        "p",
        { class: "contatti" },
        p.telefono ? h("a", { href: `tel:${p.telefono.replace(/[^\d+]/g, "")}` }, p.telefono) : null,
        p.email ? h("span", {}, p.email) : null,
        h("span", {}, `Codice ${p.codice}`),
      ),
      etichette.length ? h("p", { class: "etichette" }, etichette) : null,
      p.note ? h("p", { class: "nota" }, `Richiesta: ${p.note}`) : null,
      p.note_cliente ? h("p", { class: "nota" }, `Note sul cliente: ${p.note_cliente}`) : null,
    ),
    h("div", { class: "gestione-riga" }, h("label", { class: "piccola" }, "Tavolo", tavolo), h("div", { class: "azioni" }, azioni)),
  );
}

export function apriNuovaPrenotazione({ tavoli, sale, data, ora, tavolo_id, onSalvata }) {
  const messaggio = h("p", { class: "messaggio", role: "alert", hidden: true });
  const forza = h("button", { type: "button", class: "secondario", hidden: true }, "Salva senza tavolo");
  const modulo = h(
    "form",
    { class: "modulo-dialogo", method: "dialog" },
    h("h2", {}, "Nuova prenotazione"),
    h(
      "fieldset",
      { class: "scelta-origine" },
      h("legend", { class: "piccola" }, "Come è arrivata"),
      h("label", { class: "spunta" }, h("input", { type: "radio", name: "origine", value: "telefono", checked: true }), "Al telefono"),
      h("label", { class: "spunta" }, h("input", { type: "radio", name: "origine", value: "walk_in" }), "Cliente senza prenotazione, già al tavolo"),
    ),
    h(
      "div",
      { class: "campi" },
      h("label", {}, "Giorno", h("input", { type: "date", name: "data", required: true, value: data })),
      h("label", {}, "Ora", h("input", { type: "time", name: "ora", required: true, step: 900, value: ora })),
      h("label", {}, "Persone", h("input", { type: "number", name: "persone", required: true, min: 1, max: 50, value: 2 })),
      h(
        "label",
        {},
        "Tavolo",
        h(
          "select",
          { name: "tavolo_id" },
          h("option", { value: "" }, "Scegli in automatico"),
          sale.map((s) =>
            h("optgroup", { label: s.nome }, tavoli.filter((t) => t.sala_id === s.id).map((t) => h("option", { value: t.id, selected: t.id === tavolo_id }, etichettaTavolo(t)))),
          ),
        ),
      ),
      h("label", {}, "Nome e cognome", h("input", { name: "nome", required: true, minlength: 2, maxlength: 80 })),
      h("label", {}, "Telefono", h("input", { name: "telefono", type: "tel", maxlength: 30 })),
      h("label", { class: "largo" }, "Email (facoltativa)", h("input", { name: "email", type: "email", maxlength: 254 })),
      h("label", { class: "largo" }, "Note", h("textarea", { name: "note", rows: 2, maxlength: 300 })),
    ),
    messaggio,
    h(
      "div",
      { class: "pulsanti-dialogo" },
      h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Chiudi"),
      forza,
      h("button", { type: "submit", class: "azione" }, "Salva prenotazione"),
    ),
  );

  const invia = async (forzata) => {
    const c = new FormData(modulo);
    messaggio.hidden = true;
    try {
      const r = await api("/api/admin/prenotazioni", {
        metodo: "POST",
        corpo: {
          origine: c.get("origine"),
          data: c.get("data"),
          ora: c.get("ora"),
          persone: Number(c.get("persone")),
          tavolo_id: c.get("tavolo_id") || null,
          nome: c.get("nome"),
          telefono: c.get("telefono"),
          email: c.get("email"),
          note: c.get("note"),
          forza: forzata,
        },
      });
      chiudiDialogo();
      avviso(r.tavolo_id ? `Prenotazione salvata al tavolo ${tavoli.find((t) => t.id === r.tavolo_id)?.nome}.` : "Prenotazione salvata senza tavolo.");
      await onSalvata(c.get("data"));
    } catch (e) {
      messaggio.textContent = e.message;
      messaggio.hidden = false;
      forza.hidden = e.status !== 409;
    }
  };
  modulo.addEventListener("submit", (e) => {
    e.preventDefault();
    if (modulo.reportValidity()) invia(false);
  });
  forza.addEventListener("click", () => {
    if (modulo.reportValidity()) invia(true);
  });
  apriDialogo(modulo);
  modulo.querySelector("[name=nome]").focus();
}

export async function vistaAgenda(contenitore) {
  let filtro = "tutto";
  let dati = null;
  const riepilogo = h("p", { class: "riepilogo", "aria-live": "polite" });
  const elenco = h("div", { class: "elenco" });
  const chips = h(
    "div",
    { class: "filtri", role: "group", "aria-label": "Servizio" },
    Object.entries(FILTRI).map(([k, v]) =>
      h("button", {
        type: "button",
        class: "filtro",
        "aria-pressed": k === filtro ? "true" : "false",
        onclick: (e) => {
          filtro = k;
          chips.querySelectorAll(".filtro").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          disegna();
        },
      }, v),
    ),
  );

  const ricarica = async () => {
    try {
      dati = await api(`/api/admin/agenda?data=${condiviso.data}`);
      disegna();
    } catch (e) {
      if (e.status !== 401) elenco.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  };

  function disegna() {
    titolo.textContent = testoData(condiviso.data);
    const visibili = dati.prenotazioni.filter((p) =>
      filtro === "tutto" ? true : filtro === "pranzo" ? p.inizio_min < 17 * 60 : p.inizio_min >= 17 * 60,
    );
    const attive = visibili.filter((p) => ATTIVI.includes(p.stato));
    const coperti = attive.reduce((s, p) => s + p.persone, 0);
    const daConfermare = visibili.filter((p) => p.stato === "in_attesa").length;
    const senzaTavolo = attive.filter((p) => !p.tavolo_id).length;
    riepilogo.replaceChildren(
      ...[
      `${attive.length} ${attive.length === 1 ? "prenotazione" : "prenotazioni"} per ${coperti} coperti.`,
      daConfermare ? h("strong", { class: "da-fare" }, ` ${daConfermare} da confermare.`) : null,
      senzaTavolo ? h("strong", { class: "da-fare" }, ` ${senzaTavolo} senza tavolo.`) : null,
      ].filter(Boolean),
    );

    elenco.replaceChildren();
    if (!visibili.length) {
      elenco.append(
        h(
          "div",
          { class: "vuoto" },
          h("p", {}, "Nessuna prenotazione per questo servizio."),
          h("button", { type: "button", class: "secondario", onclick: nuova }, "Aggiungi una prenotazione"),
        ),
      );
      return;
    }
    const ore = [...new Set(visibili.map((p) => p.ora))];
    for (const ora of ore) {
      const gruppo = visibili.filter((p) => p.ora === ora);
      const c = gruppo.filter((p) => ATTIVI.includes(p.stato)).reduce((s, p) => s + p.persone, 0);
      elenco.append(
        h(
          "section",
          { class: "turno" },
          h("h2", {}, ora, h("small", {}, `${c} coperti`)),
          gruppo.map((p) => rigaPrenotazione(p, dati, ricarica)),
        ),
      );
    }
  }

  const nuova = () =>
    apriNuovaPrenotazione({
      tavoli: dati.tavoli,
      sale: dati.sale,
      data: condiviso.data,
      ora: condiviso.data === oggiRoma() ? daMinuti(Math.floor(aMinuti(oraRoma()) / 15) * 15) : "20:00",
      onSalvata: async (data) => {
        condiviso.data = data;
        contenitore.querySelector("input[type=date]").value = data;
        await ricarica();
      },
    });

  const titolo = h("h1", {}, testoData(condiviso.data));
  contenitore.append(
    h(
      "div",
      { class: "testata-vista" },
      titolo,
      h("button", { type: "button", class: "azione compatta", onclick: () => dati && nuova() }, "Nuova prenotazione"),
    ),
    h("div", { class: "strumenti" }, campoData(ricarica), chips),
    riepilogo,
    elenco,
  );
  await ricarica();
  return {};
}
