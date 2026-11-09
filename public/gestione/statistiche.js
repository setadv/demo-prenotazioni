import { ORIGINI, api, h, testoData } from "./comune.js";

const PERIODI = { 7: "7 giorni", 30: "30 giorni", 90: "90 giorni" };
const percentuale = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "nessun dato");

export async function vistaStatistiche(contenitore) {
  let giorni = 30;
  const corpo = h("div", { class: "statistiche", "aria-live": "polite" });
  const scelta = h(
    "div",
    { class: "filtri", role: "group", "aria-label": "Periodo" },
    Object.entries(PERIODI).map(([k, v]) =>
      h("button", {
        type: "button",
        class: "filtro",
        "aria-pressed": Number(k) === giorni ? "true" : "false",
        onclick: (e) => {
          giorni = Number(k);
          scelta.querySelectorAll(".filtro").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          carica();
        },
      }, v),
    ),
  );

  async function carica() {
    try {
      disegna(await api(`/api/admin/statistiche?giorni=${giorni}`));
    } catch (e) {
      if (e.status !== 401) corpo.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  }

  function disegna(d) {
    const tot = d.serie.reduce(
      (s, g) => ({
        prenotazioni: s.prenotazioni + g.prenotazioni,
        coperti: s.coperti + g.coperti,
        arrivate: s.arrivate + g.arrivate,
        no_show: s.no_show + g.no_show,
        annullate: s.annullate + g.annullate,
      }),
      { prenotazioni: 0, coperti: 0, arrivate: 0, no_show: 0, annullate: 0 },
    );
    const massimo = Math.max(1, ...d.serie.map((g) => g.coperti));
    const totOrigini = d.origini.reduce((s, o) => s + o.prenotazioni, 0);

    const grafico = h(
      "div",
      { class: "grafico", role: "img", "aria-label": `Coperti per giorno dal ${testoData(d.da)} al ${testoData(d.a)}. Massimo ${massimo}.` },
      d.serie.map((g) => {
        const barra = h("span", { class: "valore-colonna", title: `${testoData(g.data, { weekday: "short", day: "numeric", month: "short" })}: ${g.coperti} coperti` });
        barra.style.height = `${(g.coperti / massimo) * 100}%`;
        return h("span", { class: "colonna" }, barra);
      }),
    );

    corpo.replaceChildren(
      h(
        "dl",
        { class: "cifre" },
        h("div", {}, h("dt", {}, "Coperti"), h("dd", {}, String(tot.coperti))),
        h("div", {}, h("dt", {}, "Prenotazioni"), h("dd", {}, String(tot.prenotazioni))),
        h("div", {}, h("dt", {}, "Assenze sui clienti attesi"), h("dd", {}, percentuale(tot.no_show, tot.no_show + tot.arrivate))),
        h("div", {}, h("dt", {}, "Annullate"), h("dd", {}, percentuale(tot.annullate, tot.prenotazioni))),
      ),
      h("p", { class: "legenda" }, `Prossimi 7 giorni: ${d.prossimi_7_giorni.prenotazioni} prenotazioni per ${d.prossimi_7_giorni.coperti} coperti.`),
      h("h2", {}, "Coperti per giorno"),
      grafico,
      h("p", { class: "assi legenda" }, h("span", {}, testoData(d.da, { day: "numeric", month: "short" })), h("span", {}, testoData(d.a, { day: "numeric", month: "short" }))),
      h("h2", {}, "Da dove arrivano"),
      totOrigini
        ? h(
            "ul",
            { class: "origini" },
            d.origini.map((o) => {
              const barra = h("span", { class: "riempimento" });
              barra.style.width = `${(o.prenotazioni / totOrigini) * 100}%`;
              return h(
                "li",
                {},
                h("span", { class: "nome-origine" }, ORIGINI[o.origine] ?? o.origine),
                h("span", { class: "traccia" }, barra),
                h("span", {}, `${o.prenotazioni} (${percentuale(o.prenotazioni, totOrigini)})`),
              );
            }),
          )
        : h("p", { class: "legenda" }, "Nessuna prenotazione nel periodo."),
      h(
        "details",
        { class: "dettaglio-giorni" },
        h("summary", {}, "Mostra i dati giorno per giorno"),
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ["Giorno", "Prenotazioni", "Coperti", "Arrivati", "Assenze", "Annullate"].map((t) => h("th", { scope: "col" }, t)))),
          h(
            "tbody",
            {},
            [...d.serie].reverse().map((g) =>
              h(
                "tr",
                {},
                h("th", { scope: "row" }, testoData(g.data, { weekday: "short", day: "numeric", month: "short" })),
                [g.prenotazioni, g.coperti, g.arrivate, g.no_show, g.annullate].map((v) => h("td", {}, String(v))),
              ),
            ),
          ),
        ),
      ),
    );
  }

  contenitore.append(h("div", { class: "testata-vista" }, h("h1", {}, "Statistiche")), h("div", { class: "strumenti" }, scelta), corpo);
  await carica();
  return {};
}
