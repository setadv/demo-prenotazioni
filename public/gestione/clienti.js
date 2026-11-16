import { OCCASIONI, ORIGINI, STATI, api, apriDialogo, avviso, chiudiDialogo, h, numeroWhatsApp, persone, testoData, puo } from "./comune.js";

const SEGMENTI = {
  tutti: ["Tutti", "Tutti i clienti riconosciuti dal telefono o dall'email."],
  abituali: ["Abituali", "Venuti almeno due volte."],
  vip: ["VIP", "Clienti con l'etichetta VIP."],
  nuovi: ["Nuovi", "Prima prenotazione negli ultimi 30 giorni."],
  riconquistare: ["Da riconquistare", "Ultima visita più di 90 giorni fa e nessuna prenotazione in arrivo."],
  assenze: ["Con assenze", "Almeno una prenotazione non onorata."],
  compleanno: ["Compleanno questo mese", "Clienti con il compleanno nel mese in corso."],
  marketing: ["Consenso promozioni", "Hanno accettato di ricevere novità e offerte: gli unici a cui mandare comunicazioni promozionali."],
  fidelity: ["Raccolta punti", "Iscritti alla raccolta punti."],
};
const SUGGERITE = ["VIP", "Allergie", "Vegetariano", "Famiglia con bambini", "Lavoro", "Amico del locale", "Tavolo fuori"];
const LINGUE = { it: "Italiano", en: "Inglese", de: "Tedesco", fr: "Francese", es: "Spagnolo" };
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const testoCompleanno = (mmgg) => (mmgg ? `${Number(mmgg.slice(3))} ${MESI[Number(mmgg.slice(0, 2)) - 1]}` : "");
const dataBreve = (iso) => testoData(iso, { day: "numeric", month: "short", year: "numeric" });

function badgeCliente(c) {
  const lista = c.etichette.map((e) => h("span", { class: `etichetta${e === "VIP" ? " vip" : ""}` }, e));
  if (c.visite >= 2) lista.push(h("span", { class: "etichetta abituale" }, "Abituale"));
  if (c.no_show) lista.push(h("span", { class: "etichetta allerta" }, `${c.no_show} ${c.no_show === 1 ? "assenza" : "assenze"}`));
  if (c.compleanno) lista.push(h("span", { class: "etichetta occasione" }, `Compleanno ${testoCompleanno(c.compleanno)}`));
  if (c.marketing) lista.push(h("span", { class: "etichetta consenso" }, "Consenso promozioni"));
  if (c.fidelity) lista.push(h("span", { class: "etichetta consenso" }, `${c.punti} punti`));
  if (c.lingua && c.lingua !== "it") lista.push(h("span", { class: "etichetta" }, LINGUE[c.lingua]));
  return lista;
}

function editorEtichette(iniziali) {
  const scelte = new Set(iniziali);
  const box = h("div", { class: "etichette modificabili" });
  const input = h("input", { list: "etichette-suggerite", maxlength: 24, placeholder: "Nuova etichetta", "aria-label": "Nuova etichetta" });
  const aggiungi = () => {
    const v = input.value.replaceAll(",", " ").trim();
    if (v && scelte.size < 12) scelte.add(v);
    input.value = "";
    disegna();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      aggiungi();
    }
  });
  function disegna() {
    box.replaceChildren(
      ...[...scelte].map((e) =>
        h(
          "span",
          { class: `etichetta${e === "VIP" ? " vip" : ""}` },
          e,
          h("button", { type: "button", class: "togli", "aria-label": `Togli ${e}`, onclick: () => { scelte.delete(e); disegna(); } }, "×"),
        ),
      ),
    );
  }
  disegna();
  return {
    el: h(
      "div",
      { class: "editor-etichette" },
      box,
      h("div", { class: "riga-input" }, input, h("button", { type: "button", class: "secondario", onclick: aggiungi }, "Aggiungi")),
      h("datalist", { id: "etichette-suggerite" }, SUGGERITE.map((s) => h("option", { value: s }))),
    ),
    valore: () => {
      if (input.value.trim()) aggiungi();
      return [...scelte];
    },
  };
}

async function apriScheda(id, onSalvato) {
  let { cliente: c, storico, fidelity } = await api(`/api/admin/clienti/${id}`);
  const etichette = editorEtichette(c.etichette);
  const [meseIniziale, giornoIniziale] = c.compleanno ? [Number(c.compleanno.slice(0, 2)), Number(c.compleanno.slice(3))] : [0, 0];
  const mese = h("select", { name: "mese", "aria-label": "Mese del compleanno" }, h("option", { value: 0 }, "Mese"), MESI.map((m, i) => h("option", { value: i + 1, selected: i + 1 === meseIniziale }, m)));
  const giorno = h("select", { name: "giorno", "aria-label": "Giorno del compleanno" }, h("option", { value: 0 }, "Giorno"), Array.from({ length: 31 }, (_, i) => h("option", { value: i + 1, selected: i + 1 === giornoIniziale }, String(i + 1))));
  const errore = h("p", { class: "messaggio", role: "alert", hidden: true });
  const numero = numeroWhatsApp(c.telefono);

  const modulo = h(
    "form",
    { class: "modulo-dialogo scheda-cliente" },
    h("h2", {}, c.nome),
    h(
      "p",
      { class: "contatti" },
      c.telefono ? h("a", { href: `tel:${c.telefono.replace(/[^\d+]/g, "")}` }, c.telefono) : null,
      numero ? h("a", { href: `https://wa.me/${numero}`, target: "_blank", rel: "noopener" }, "Scrivi su WhatsApp") : null,
      c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : null,
    ),
    h(
      "dl",
      { class: "cifre-cliente" },
      h("div", {}, h("dt", {}, "Visite"), h("dd", {}, String(c.visite))),
      h("div", {}, h("dt", {}, "Coperti"), h("dd", {}, String(c.coperti))),
      h("div", {}, h("dt", {}, "Assenze"), h("dd", {}, String(c.no_show))),
      h("div", {}, h("dt", {}, "Ultima visita"), h("dd", {}, c.ultima_visita ? dataBreve(c.ultima_visita) : "nessuna")),
    ),
    h("fieldset", { class: "campo-gruppo" }, h("legend", { class: "piccola" }, "Etichette"), etichette.el),
    h(
      "div",
      { class: "campi" },
      h("fieldset", { class: "campo-gruppo" }, h("legend", { class: "piccola" }, "Compleanno"), h("div", { class: "riga-input" }, giorno, mese)),
      h("label", {}, "Lingua dei messaggi", h("select", { name: "lingua" }, Object.entries(LINGUE).map(([k, v]) => h("option", { value: k, selected: k === c.lingua }, v)))),
      h(
        "label",
        { class: "spunta largo" },
        h("input", { type: "checkbox", name: "marketing", checked: c.marketing }),
        h(
          "span",
          {},
          "Ha dato il consenso a ricevere novità e offerte",
          h("span", { class: "aiuto" }, c.marketing && c.marketing_il ? ` Registrato il ${dataBreve(c.marketing_il.slice(0, 10))}.` : " Spunta solo se il cliente te lo ha chiesto: la data viene registrata."),
        ),
      ),
      h(
        "label",
        { class: "spunta largo" },
        h("input", { type: "checkbox", name: "fidelity", checked: c.fidelity }),
        h("span", {}, `Iscritto alla raccolta punti: ${fidelity.saldo} punti`, fidelity.premi.some((p) => p.stato === "attivo") ? h("span", { class: "aiuto" }, ` · premio da usare: ${fidelity.premi.find((p) => p.stato === "attivo").codice}`) : null),
      ),
      h("label", { class: "largo" }, "Note sul cliente", h("textarea", { name: "note", rows: 3, maxlength: 500, value: c.note ?? "", placeholder: "Preferenze, allergie, tavolo preferito" })),
    ),
    errore,
    h(
      "div",
      { class: "pulsanti-dialogo" },
      h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Chiudi"),
      h("button", { type: "submit", class: "azione" }, "Salva"),
    ),
    h("h3", { class: "titolo-storico" }, "Storico"),
    storico.length
      ? h(
          "ul",
          { class: "storico" },
          storico.map((p) =>
            h(
              "li",
              {},
              h("span", {}, `${dataBreve(p.data)}, ${p.ora}`),
              h("span", {}, persone(p.persone)),
              h("span", { class: `badge-stato stato-${p.stato}` }, STATI[p.stato]),
              h("span", { class: "legenda" }, [ORIGINI[p.origine], p.tavolo ? `tavolo ${p.tavolo}` : null, p.occasione ? OCCASIONI[p.occasione] : null].filter(Boolean).join(", ")),
            ),
          ),
        )
      : h("p", { class: "vuoto" }, "Nessuna prenotazione."),
  );

  modulo.addEventListener("submit", async (e) => {
    e.preventDefault();
    errore.hidden = true;
    const f = new FormData(modulo);
    const m = Number(mese.value);
    const g = Number(giorno.value);
    if (Boolean(m) !== Boolean(g)) {
      errore.textContent = "Per il compleanno scegli sia il giorno sia il mese, oppure nessuno dei due.";
      errore.hidden = false;
      return;
    }
    try {
      ({ cliente: c, storico, fidelity } = await api(`/api/admin/clienti/${id}`, {
        metodo: "PATCH",
        corpo: {
          note: f.get("note"),
          etichette: etichette.valore(),
          compleanno: m ? `${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}` : null,
          marketing: f.get("marketing") === "on",
          fidelity: f.get("fidelity") === "on",
          lingua: f.get("lingua"),
        },
      }));
      chiudiDialogo();
      avviso(`Scheda di ${c.nome} salvata.`);
      onSalvato();
    } catch (err) {
      errore.textContent = err.message;
      errore.hidden = false;
    }
  });
  apriDialogo(modulo);
}

export async function vistaClienti(contenitore) {
  const cerca = h("input", { type: "search", placeholder: "Nome, telefono, email o etichetta", "aria-label": "Cerca un cliente" });
  const filtri = h("div", { class: "filtri", role: "group", "aria-label": "Gruppi di clienti" });
  const spiegazione = h("p", { class: "legenda" });
  const esporta = h("a", { class: "secondario pulsante-link", download: "", hidden: !puo("esportare") }, "Esporta CSV");
  const elenco = h("div", { class: "elenco-clienti", "aria-live": "polite" });
  let segmento = "tutti";
  let timer;
  let ultima = 0;

  const parametri = () => `segmento=${segmento}&q=${encodeURIComponent(cerca.value.trim())}`;

  async function carica() {
    const richiesta = ++ultima;
    esporta.href = `/api/admin/clienti.csv?${parametri()}`;
    try {
      const dati = await api(`/api/admin/clienti?${parametri()}`);
      if (richiesta !== ultima) return;
      disegnaFiltri(dati.conteggi);
      disegna(dati.clienti);
    } catch (e) {
      if (e.status !== 401) elenco.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  }

  function disegnaFiltri(conteggi) {
    filtri.replaceChildren(
      ...Object.entries(SEGMENTI).map(([k, [nome]]) =>
        h("button", {
          type: "button",
          class: "filtro",
          "aria-pressed": String(k === segmento),
          onclick: () => {
            segmento = k;
            carica();
          },
        }, `${nome} ${conteggi[k] ?? 0}`),
      ),
    );
    spiegazione.textContent = SEGMENTI[segmento][1];
  }

  function disegna(clienti) {
    if (!clienti.length) {
      elenco.replaceChildren(
        h("p", { class: "vuoto" }, cerca.value.trim() || segmento !== "tutti" ? "Nessun cliente in questo gruppo." : "I clienti compaiono qui dopo la prima prenotazione."),
      );
      return;
    }
    elenco.replaceChildren(
      h("p", { class: "legenda" }, `${clienti.length} ${clienti.length === 1 ? "cliente" : "clienti"}${clienti.length === 200 ? ": mostro i primi 200, affina la ricerca" : ""}`),
      ...clienti.map(schedaCliente),
    );
  }

  function schedaCliente(c) {
    const dati = [
      `${c.visite} ${c.visite === 1 ? "visita" : "visite"}`,
      `${c.prenotazioni} ${c.prenotazioni === 1 ? "prenotazione" : "prenotazioni"}`,
    ];
    if (c.ultima_visita) dati.push(`ultima visita ${dataBreve(c.ultima_visita)}`);
    if (c.prossima) dati.push(`prossima ${testoData(c.prossima, { day: "numeric", month: "short" })}`);
    const badge = badgeCliente(c);
    return h(
      "article",
      { class: "cliente" },
      h(
        "div",
        { class: "testa-cliente" },
        h("h2", {}, c.nome),
        h("button", { type: "button", class: "secondario", onclick: () => apriScheda(c.id, carica).catch((e) => avviso(e.message, "errore")) }, "Apri la scheda"),
      ),
      badge.length ? h("p", { class: "etichette" }, badge) : null,
      h(
        "p",
        { class: "contatti" },
        c.telefono ? h("a", { href: `tel:${c.telefono.replace(/[^\d+]/g, "")}` }, c.telefono) : null,
        c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : null,
      ),
      h("p", { class: "legenda" }, dati.join(", ")),
      c.note ? h("p", { class: "nota" }, c.note) : null,
    );
  }

  cerca.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(carica, 250);
  });

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Clienti"), h("div", { class: "pulsanti-testata" }, esporta)),
    h("p", { class: "legenda" }, "Ogni cliente viene riconosciuto dal telefono o dall'email: visite, assenze, preferenze ed etichette compaiono anche in agenda."),
    h("div", { class: "strumenti" }, cerca),
    filtri,
    spiegazione,
    elenco,
  );
  await carica();
  return {};
}
