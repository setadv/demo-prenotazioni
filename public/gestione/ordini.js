import { $, api, avviso, campoData, condiviso, h, testoData, paginaPubblica } from "./comune.js";
import { impostazioniModulo, pulsantiInvio } from "./moduli.js";

const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);
const STATI = {
  nuovo: "Nuovo",
  in_preparazione: "In preparazione",
  pronto: "Pronto",
  in_consegna: "In consegna",
  completato: "Completato",
  annullato: "Annullato",
};
const AZIONI = {
  nuovo: [["Accetta e prepara", "in_preparazione"], ["Rifiuta", "annullato"]],
  in_preparazione: [["Pronto", "pronto", "asporto"], ["Parte la consegna", "in_consegna", "consegna"], ["Annulla", "annullato"]],
  pronto: [["Ritirato", "completato"], ["Annulla", "annullato"]],
  in_consegna: [["Consegnato", "completato"], ["Annulla", "annullato"]],
  completato: [],
  annullato: [["Ripristina", "nuovo"]],
};
const NOMI_CANALE = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };

export async function vistaOrdini(contenitore) {
  const elenco = h("div", { class: "elenco-ordini", "aria-live": "polite" });
  const riepilogo = h("p", { class: "riepilogo" });
  const moduli = await api("/api/admin/moduli");
  let ultimi = new Set();
  let timer;

  async function carica() {
    clearTimeout(timer);
    try {
      const dati = await api(`/api/admin/ordini?data=${condiviso.data}`);
      disegna(dati);
    } catch (e) {
      if (e.status !== 401) elenco.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
    // Nuovi ordini senza ricaricare: ogni 30 secondi.
    timer = setTimeout(carica, 30000);
  }

  async function cambia(o, stato) {
    try {
      const r = await api(`/api/admin/ordini/${o.id}`, { metodo: "PATCH", corpo: { stato } });
      avviso(r.rimborso ?? `Ordine ${o.codice}: ${STATI[stato].toLowerCase()}.`, r.rimborso ? "errore" : "ok");
    } catch (e) {
      avviso(e.message, "errore");
    }
    carica();
  }

  function stampa(o) {
    const foglio = $("stampa");
    foglio.replaceChildren(
      h(
        "div",
        { class: "comanda" },
        h("p", { class: "comanda-titolo" }, `${o.tipo === "consegna" ? "CONSEGNA" : "ASPORTO"} · ${o.ora}`),
        h("p", {}, `Ordine ${o.codice} · ${testoData(o.data)}`),
        h("p", {}, h("strong", {}, o.nome), ` · ${o.telefono}`),
        o.tipo === "consegna" ? h("p", {}, `${o.indirizzo}, ${o.cap}`) : null,
        h("ul", {}, o.righe.map((r) => h("li", {}, `${r.quantita} × ${r.nome}`))),
        o.note ? h("p", {}, `Note: ${o.note}`) : null,
        h("p", { class: "comanda-totale" }, `Totale ${euro(o.totale)} · ${o.pagato ? "PAGATO" : "DA INCASSARE"}`),
      ),
    );
    document.body.classList.add("stampa-qr");
    window.addEventListener("afterprint", () => document.body.classList.remove("stampa-qr"), { once: true });
    window.print();
  }

  function scheda(o, nuovo) {
    const azioni = AZIONI[o.stato]
      .filter(([, , tipo]) => !tipo || tipo === o.tipo)
      .map(([testo, stato]) =>
        h("button", { type: "button", class: stato === "annullato" ? "secondario pericolo" : stato === "in_preparazione" ? "azione compatta" : "secondario", onclick: () => cambia(o, stato) }, testo),
      );
    const inviato = o.notifica && ["inviata", "manuale"].includes(o.notifica.esito);
    const messaggi =
      o.stato !== "annullato" && o.stato !== "nuovo"
        ? h(
            "div",
            { class: "messaggi" },
            inviato
              ? h("span", { class: "invio ok" }, `Conferma inviata via ${NOMI_CANALE[o.notifica.canale]}`)
              : h("span", { class: "invio attesa" }, `Conferma da inviare, preferisce ${NOMI_CANALE[o.canale]}`),
            inviato
              ? null
              : pulsantiInvio({
                  testo: o.messaggio,
                  telefono: o.telefono,
                  email: o.email,
                  canale: o.canale,
                  oggetto: "Ordine confermato",
                  onInviato: (canale) =>
                    api(`/api/admin/ordini/${o.id}/notifica`, { metodo: "POST", corpo: { canale } })
                      .then(() => setTimeout(carica, 300))
                      .catch((e) => avviso(e.message, "errore")),
                }),
          )
        : null;
    const pagato = h("input", {
      type: "checkbox",
      checked: o.pagato,
      onchange: async (e) => {
        try {
          await api(`/api/admin/ordini/${o.id}/pagato`, { metodo: "PATCH", corpo: { pagato: e.target.checked } });
        } catch (err) {
          avviso(err.message, "errore");
        }
      },
    });
    return h(
      "article",
      { class: `ordine-scheda${nuovo ? " appena-arrivato" : ""}`, dataset: { stato: o.stato } },
      h(
        "div",
        { class: "ordine-testa" },
        h("p", { class: "ordine-ora" }, o.ora),
        h(
          "div",
          {},
          h("p", { class: "nome-cliente" }, h("strong", {}, o.nome), h("span", { class: `badge-stato ordine-${o.stato}` }, STATI[o.stato]), h("span", { class: "etichetta" }, o.tipo === "consegna" ? "Consegna" : "Asporto")),
          h(
            "p",
            { class: "contatti" },
            h("a", { href: `tel:${o.telefono.replace(/[^\d+]/g, "")}` }, o.telefono),
            o.email ? h("span", {}, o.email) : null,
            h("span", {}, `Codice ${o.codice}`),
          ),
          o.tipo === "consegna" ? h("p", { class: "indirizzo-ordine" }, `${o.indirizzo}, ${o.cap}`) : null,
        ),
        h("p", { class: "ordine-totale" }, euro(o.totale)),
      ),
      h("ul", { class: "righe-ordine" }, o.righe.map((r) => h("li", {}, h("strong", {}, `${r.quantita} ×`), ` ${r.nome}`))),
      o.note ? h("p", { class: "nota" }, `Note: ${o.note}`) : null,
      messaggi,
      h(
        "div",
        { class: "ordine-azioni" },
        h("label", { class: "spunta interruttore" }, pagato, o.pagamento === "online" ? "Pagato online" : "Incassato"),
        h("div", { class: "azioni" }, azioni, h("button", { type: "button", class: "secondario", onclick: () => stampa(o) }, "Stampa comanda")),
      ),
    );
  }

  function disegna({ ordini }) {
    const attivi = ordini.filter((o) => !["completato", "annullato"].includes(o.stato));
    const nuovi = ordini.filter((o) => o.stato === "nuovo");
    const incasso = ordini.filter((o) => o.stato !== "annullato").reduce((s, o) => s + o.totale, 0);
    riepilogo.replaceChildren(
      `${ordini.length} ${ordini.length === 1 ? "ordine" : "ordini"}, ${attivi.length} da evadere, ${euro(incasso)} in totale. `,
      nuovi.length ? h("strong", { class: "da-fare" }, `${nuovi.length} da accettare.`) : "",
    );
    document.title = nuovi.length ? `(${nuovi.length}) Ordini` : "Ordini";
    const arrivati = new Set(nuovi.map((o) => o.id).filter((id) => ultimi.size && !ultimi.has(id)));
    ultimi = new Set(ordini.map((o) => o.id));
    if (!ordini.length) {
      elenco.replaceChildren(h("div", { class: "vuoto" }, h("p", {}, "Nessun ordine in questo giorno."), h("p", {}, "I clienti ordinano dalla pagina ", h("a", { href: paginaPubblica("/ordina"), target: "_blank", rel: "noopener" }, "Ordina"), ".")));
      return;
    }
    const gruppi = [
      ["Da accettare", ordini.filter((o) => o.stato === "nuovo")],
      ["In corso", ordini.filter((o) => ["in_preparazione", "pronto", "in_consegna"].includes(o.stato))],
      ["Chiusi", ordini.filter((o) => ["completato", "annullato"].includes(o.stato))],
    ].filter(([, lista]) => lista.length);
    elenco.replaceChildren(...gruppi.map(([titolo, lista]) => h("section", { class: "turno" }, h("h2", {}, titolo, h("small", {}, String(lista.length))), lista.map((o) => scheda(o, arrivati.has(o.id))))));
  }

  const impostazioni = impostazioniModulo({
    titolo: "Impostazioni di asporto e consegna",
    modulo: "ordini",
    impostazioni: moduli.impostazioni,
    campi: [
      { chiave: "ordini_attivi", tipo: "spunta", etichetta: "Ordini online attivi (pagina /ordina)" },
      { chiave: "asporto_attivo", tipo: "spunta", etichetta: "Ritiro al ristorante" },
      { chiave: "consegna_attiva", tipo: "spunta", etichetta: "Consegna a domicilio" },
      {
        chiave: "pagamento_alla_consegna",
        tipo: "spunta",
        etichetta: moduli.stripe ? "Pagamento al ritiro o alla consegna (oltre al pagamento online con Stripe)" : "Pagamento al ritiro o alla consegna. Il pagamento online si attiva con i secret di Stripe.",
      },
      { chiave: "ordini_preparazione", tipo: "numero", etichetta: "Minuti di preparazione", min: 10, max: 240, aiuto: "Il primo orario ordinabile è adesso più questo tempo." },
      { chiave: "ordini_max_fascia", tipo: "numero", etichetta: "Ordini massimi per orario", min: 1, max: 50 },
      { chiave: "consegna_costo", tipo: "euro", etichetta: "Costo della consegna (€)" },
      { chiave: "consegna_minimo", tipo: "euro", etichetta: "Ordine minimo per la consegna (€)" },
      { chiave: "consegna_gratis_da", tipo: "euro", etichetta: "Consegna gratis da (€)", aiuto: "0 = mai gratis." },
      { chiave: "consegna_cap", tipo: "testo", etichetta: "CAP serviti", max: 400, placeholder: "80031, 80032", aiuto: "Vuoto = tutti i CAP." },
      { chiave: "messaggio_ordine", tipo: "tradotto", etichetta: "Messaggio di conferma dell'ordine", aiuto: "Parte quando accetti l'ordine. Puoi usare: {nome}, {codice}, {ristorante}, {tipo}, {data}, {ora}, {totale}, {link}." },
    ],
  });

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Ordini"), h("div", { class: "pulsanti-testata" }, h("a", { class: "secondario pulsante-link", href: paginaPubblica("/ordina"), target: "_blank", rel: "noopener" }, "Apri la pagina degli ordini"))),
    h("p", { class: "legenda" }, "Asporto e consegna dal tuo sito, senza commissioni di piattaforma. I piatti ordinabili si scelgono nel Menù. Questa pagina si aggiorna da sola ogni 30 secondi."),
    h("div", { class: "strumenti" }, campoData(carica)),
    riepilogo,
    elenco,
    impostazioni,
  );
  await carica();
  return {
    esci() {
      clearTimeout(timer);
      return true;
    },
  };
}
