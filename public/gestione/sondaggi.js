import { api, avviso, h, testoData } from "./comune.js";
import { impostazioniModulo } from "./moduli.js";

const DOMANDE = { cibo: "Cibo", servizio: "Servizio", ambiente: "Ambiente", prezzo: "Qualità prezzo" };
const PERIODI = { 30: "30 giorni", 90: "90 giorni", 365: "Un anno" };
const media = (v) => (v == null ? "–" : v.toFixed(1).replace(".", ","));

export async function vistaSondaggi(contenitore) {
  const moduli = await api("/api/admin/moduli");
  let giorni = 90;
  let soloCritici = false;
  const corpo = h("div", {});
  const filtri = h("div", { class: "filtri", role: "group", "aria-label": "Periodo" });

  async function carica() {
    try {
      disegna(await api(`/api/admin/sondaggi?giorni=${giorni}`));
    } catch (e) {
      if (e.status !== 401) corpo.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  }

  function barra(voto) {
    // Proprietà impostata da script: la Content-Security-Policy blocca gli attributi style scritti nel markup.
    const el = h("span", { class: "barra-voto", "aria-hidden": "true" });
    el.style.setProperty("--valore", `${((voto ?? 0) / 5) * 100}%`);
    return el;
  }

  function disegna(r) {
    filtri.replaceChildren(
      ...Object.entries(PERIODI).map(([g, nome]) =>
        h("button", { type: "button", class: "filtro", "aria-pressed": String(Number(g) === giorni), onclick: () => { giorni = Number(g); carica(); } }, nome),
      ),
      h("button", { type: "button", class: "filtro", "aria-pressed": String(soloCritici), onclick: () => { soloCritici = !soloCritici; carica(); } }, "Solo da richiamare"),
    );
    if (!r.risposte) {
      corpo.replaceChildren(h("p", { class: "vuoto" }, "Nessuna risposta nel periodo. Il sondaggio parte qualche ora dopo la visita ai clienti segnati come Arrivati."));
      return;
    }
    const elenco = soloCritici ? r.elenco.filter((x) => x.critico) : r.elenco;
    corpo.replaceChildren(
      h(
        "dl",
        { class: "cifre" },
        h("div", {}, h("dt", {}, "Risposte"), h("dd", {}, String(r.risposte))),
        h("div", { title: "Promotori (9-10) meno detrattori (0-6), su 100" }, h("dt", {}, "Net Promoter Score"), h("dd", {}, r.nps == null ? "–" : String(r.nps))),
        ...Object.entries(DOMANDE).map(([k, nome]) => h("div", {}, h("dt", {}, nome), h("dd", {}, media(r.medie[k]), h("small", {}, " /5")), barra(r.medie[k]))),
      ),
      h("h2", { class: "titolo-sezione-piccolo" }, `Risposte${soloCritici ? " da richiamare" : ""}`),
      elenco.length
        ? h(
            "div",
            { class: "elenco-clienti" },
            elenco.map((x) =>
              h(
                "article",
                { class: `cliente risposta${x.critico ? " critica" : ""}` },
                h(
                  "div",
                  { class: "testa-cliente" },
                  h("h3", {}, x.nome),
                  h("span", { class: "legenda" }, `visita del ${testoData(x.data, { day: "numeric", month: "short" })}`),
                  x.critico ? h("span", { class: "etichetta allerta" }, "Da richiamare") : null,
                  x.lingua !== "it" ? h("span", { class: "etichetta" }, x.lingua.toUpperCase()) : null,
                ),
                h(
                  "p",
                  { class: "voti" },
                  Object.entries(DOMANDE).map(([k, nome]) => h("span", { class: x[`voto_${k}`] <= 2 ? "basso" : "" }, `${nome} ${"★".repeat(x[`voto_${k}`])}${"☆".repeat(5 - x[`voto_${k}`])}`)),
                  x.consiglio != null ? h("span", { class: x.consiglio <= 6 ? "basso" : "" }, `Consiglio ${x.consiglio}/10`) : null,
                ),
                x.commento ? h("blockquote", { class: "commento" }, x.commento) : null,
                h(
                  "p",
                  { class: "contatti" },
                  x.telefono ? h("a", { href: `tel:${x.telefono.replace(/[^\d+]/g, "")}` }, x.telefono) : null,
                  x.email ? h("a", { href: `mailto:${x.email}` }, x.email) : null,
                  x.critico
                    ? h(
                        "label",
                        { class: "spunta interruttore" },
                        h("input", {
                          type: "checkbox",
                          checked: Boolean(x.gestito),
                          onchange: async (e) => {
                            try {
                              await api(`/api/admin/sondaggi/${x.prenotazione_id}`, { metodo: "PATCH", corpo: { gestito: e.target.checked } });
                              avviso(e.target.checked ? `${x.nome}: segnato come richiamato.` : `${x.nome}: da richiamare.`);
                            } catch (err) {
                              avviso(err.message, "errore");
                            }
                          },
                        }),
                        "Richiamato",
                      )
                    : null,
                ),
              ),
            ),
          )
        : h("p", { class: "vuoto" }, "Nessuna risposta da richiamare."),
    );
  }

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Sondaggi")),
    h(
      "p",
      { class: "legenda" },
      "Qualche ora dopo la visita il cliente riceve un solo messaggio con il sondaggio. Alla fine, a tutti compare anche il link per la recensione: le regole di Google non permettono di mostrarlo solo a chi è soddisfatto.",
    ),
    filtri,
    corpo,
    impostazioniModulo({
      titolo: "Impostazioni del sondaggio",
      modulo: "sondaggio",
      impostazioni: moduli.impostazioni,
      onSalvato: carica,
      campi: [
        { chiave: "sondaggio_attivo", tipo: "spunta", etichetta: "Dopo la visita manda il sondaggio al posto della sola richiesta di recensione" },
        { chiave: "messaggio_sondaggio", tipo: "tradotto", etichetta: "Messaggio con il sondaggio", aiuto: "Puoi usare: {nome}, {ristorante}, {data}, {sondaggio}. {sondaggio} è il link e deve restare nel testo. Orario di invio e invio automatico si regolano in Impostazioni, Messaggio dopo la visita." },
      ],
    }),
  );
  await carica();
  return {};
}
