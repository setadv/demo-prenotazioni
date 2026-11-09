import { ATTIVI, STATI, aMinuti, api, avviso, campoData, condiviso, daMinuti, h, oggiRoma, oraRoma, persone } from "./comune.js";
import { apriNuovaPrenotazione, azioniPer, cambiaStato, cambiaTavolo } from "./agenda.js";
import { creaPianta, creaTavolo } from "./pianta.js";

const DA = 11 * 60;
const A = 23 * 60 + 45;

function minutiIniziali() {
  if (condiviso.data !== oggiRoma()) return 20 * 60;
  const m = aMinuti(oraRoma());
  return Math.min(Math.max(Math.floor(m / 15) * 15, DA), A);
}

export async function vistaSala(contenitore) {
  let dati = null;
  let salaId = null;
  let minuti = minutiIniziali();
  let tavoloScelto = null;
  let daAssegnare = null;

  const ora = h("input", { type: "range", id: "cursore-ora", min: DA, max: A, step: 15, value: minuti });
  const oraTesto = h("output", { class: "ora-scelta" }, daMinuti(minuti));
  const schede = h("div", { class: "schede", role: "tablist", "aria-label": "Sale" });
  const area = h("div", { class: "area-pianta" });
  const pannello = h("aside", { class: "pannello-laterale", "aria-live": "polite" });

  ora.addEventListener("input", () => {
    minuti = Number(ora.value);
    oraTesto.textContent = daMinuti(minuti);
    disegna();
  });

  function impostaMinuti(m) {
    minuti = Math.min(Math.max(m, DA), A);
    ora.value = minuti;
    oraTesto.textContent = daMinuti(minuti);
    if (dati) disegna();
  }
  const passo = (delta) => impostaMinuti(minuti + delta);
  const adesso = () => {
    if (condiviso.data !== oggiRoma()) {
      condiviso.data = oggiRoma();
      contenitore.querySelector("input[type=date]").value = condiviso.data;
      impostaMinuti(minutiIniziali());
      ricarica();
    } else impostaMinuti(minutiIniziali());
  };

  const ricarica = async () => {
    try {
      dati = await api(`/api/admin/agenda?data=${condiviso.data}`);
      if (!dati.sale.some((s) => s.id === salaId)) salaId = dati.sale[0]?.id ?? null;
      if (daAssegnare && !dati.prenotazioni.some((p) => p.id === daAssegnare && !p.tavolo_id && ATTIVI.includes(p.stato))) daAssegnare = null;
      disegna();
    } catch (e) {
      if (e.status !== 401) area.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  };

  const attive = () => dati.prenotazioni.filter((p) => ATTIVI.includes(p.stato));
  const occupante = (tavoloId) =>
    attive().find((p) => p.tavolo_id === tavoloId && p.inizio_min <= minuti && minuti < p.inizio_min + p.durata);
  const prossima = (tavoloId) =>
    attive()
      .filter((p) => p.tavolo_id === tavoloId && p.inizio_min > minuti)
      .sort((a, b) => a.inizio_min - b.inizio_min)[0];

  function infoTavolo(t) {
    const p = occupante(t.id);
    const scelto = tavoloScelto === t.id;
    if (p) {
      return {
        stato: p.stato === "arrivata" ? "seduto" : p.stato === "in_attesa" ? "attesa" : "prenotato",
        titolo: p.nome.split(" ")[0],
        dettaglio: `${p.persone} pers. alle ${p.ora}`,
        etichetta: `Tavolo ${t.nome}, ${STATI[p.stato].toLowerCase()}: ${p.nome}, ${persone(p.persone)} alle ${p.ora}`,
        selezionato: scelto,
      };
    }
    const dopo = prossima(t.id);
    const fine = dopo ? daMinuti(dopo.inizio_min) : null;
    return {
      stato: daAssegnare ? (adatto(t) ? "adatto" : "libero") : "libero",
      dettaglio: fine ? `Libero fino ${fine}` : `${t.posti_min}-${t.posti_max} posti`,
      etichetta: `Tavolo ${t.nome}, libero${fine ? ` fino alle ${fine}` : ""}, ${t.posti_min}-${t.posti_max} posti`,
      selezionato: scelto,
    };
  }

  function adatto(t) {
    const p = dati.prenotazioni.find((x) => x.id === daAssegnare);
    if (!p || p.persone > t.posti_max) return false;
    return !attive().some(
      (o) => o.tavolo_id === t.id && o.inizio_min < p.inizio_min + p.durata && p.inizio_min < o.inizio_min + o.durata,
    );
  }

  async function clicTavolo(t) {
    if (daAssegnare) {
      const p = dati.prenotazioni.find((x) => x.id === daAssegnare);
      try {
        await cambiaTavolo(p.id, t.id);
        avviso(`${p.nome} assegnato al tavolo ${t.nome}.`);
        daAssegnare = null;
        tavoloScelto = t.id;
      } catch (e) {
        avviso(e.message, "errore");
      }
      await ricarica();
      return;
    }
    tavoloScelto = tavoloScelto === t.id ? null : t.id;
    disegna();
  }

  function disegna() {
    schede.replaceChildren(
      ...dati.sale.map((s) =>
        h("button", {
          type: "button",
          role: "tab",
          class: "scheda-sala",
          "aria-selected": s.id === salaId ? "true" : "false",
          onclick: () => {
            salaId = s.id;
            disegna();
          },
        }, s.nome),
      ),
    );
    const sala = dati.sale.find((s) => s.id === salaId);
    if (!sala) {
      area.replaceChildren(h("p", { class: "vuoto" }, "Non ci sono sale. Creane una in Mappa tavoli."));
      pannello.replaceChildren();
      return;
    }
    const pianta = creaPianta(sala);
    for (const t of dati.tavoli.filter((x) => x.sala_id === sala.id)) {
      const el = creaTavolo(t, sala, infoTavolo(t));
      el.addEventListener("click", () => clicTavolo(t));
      pianta.append(el);
    }
    area.replaceChildren(
      pianta,
      h(
        "p",
        { class: "legenda-sala" },
        h("span", { class: "chiave stato-libero" }, "Libero"),
        h("span", { class: "chiave stato-attesa" }, "Da confermare"),
        h("span", { class: "chiave stato-prenotato" }, "Prenotato"),
        h("span", { class: "chiave stato-seduto" }, "Seduti"),
      ),
    );
    disegnaPannello();
  }

  function schedaPrenotazione(p) {
    return h(
      "li",
      { class: "mini", dataset: { stato: p.stato } },
      h("p", {}, h("strong", {}, `${p.ora} ${p.nome}`), ` ${persone(p.persone)}`),
      h("p", { class: "legenda" }, STATI[p.stato], p.telefono ? `, ${p.telefono}` : ""),
      h(
        "div",
        { class: "azioni" },
        azioniPer(p.stato).map(([testo, stato]) =>
          h("button", {
            type: "button",
            class: "secondario",
            onclick: async () => {
              try {
                await cambiaStato(p.id, stato);
                avviso(`${p.nome}: ${STATI[stato].toLowerCase()}.`);
              } catch (e) {
                avviso(e.message, "errore");
              }
              await ricarica();
            },
          }, testo),
        ),
      ),
    );
  }

  function disegnaPannello() {
    const senza = attive().filter((p) => !p.tavolo_id);
    const blocchi = [];
    if (daAssegnare) {
      const p = dati.prenotazioni.find((x) => x.id === daAssegnare);
      blocchi.push(
        h(
          "div",
          { class: "assegna-attivo" },
          h("p", {}, h("strong", {}, `Scegli un tavolo per ${p.nome}`), `, ${persone(p.persone)} alle ${p.ora}. I tavoli adatti sono evidenziati.`),
          h("button", { type: "button", class: "secondario", onclick: () => { daAssegnare = null; disegna(); } }, "Annulla"),
        ),
      );
    }
    if (tavoloScelto) {
      const t = dati.tavoli.find((x) => x.id === tavoloScelto);
      const delTavolo = attive().filter((p) => p.tavolo_id === tavoloScelto);
      blocchi.push(
        h("h2", {}, `Tavolo ${t.nome}`),
        h("p", { class: "legenda" }, `${t.posti_min}-${t.posti_max} posti${t.online ? "" : ", non prenotabile online"}`),
        delTavolo.length
          ? h("ul", { class: "lista-mini" }, delTavolo.map(schedaPrenotazione))
          : h("p", { class: "legenda" }, "Nessuna prenotazione su questo tavolo oggi."),
        h("button", {
          type: "button",
          class: "secondario",
          onclick: () =>
            apriNuovaPrenotazione({
              tavoli: dati.tavoli,
              sale: dati.sale,
              data: condiviso.data,
              ora: daMinuti(minuti),
              tavolo_id: t.id,
              onSalvata: ricarica,
            }),
        }, "Prenota questo tavolo"),
      );
    }
    blocchi.push(h("h2", {}, "Senza tavolo"));
    blocchi.push(
      senza.length
        ? h(
            "ul",
            { class: "lista-mini" },
            senza.map((p) =>
              h(
                "li",
                { class: "mini" },
                h("p", {}, h("strong", {}, `${p.ora} ${p.nome}`), ` ${persone(p.persone)}`),
                h("button", {
                  type: "button",
                  class: "secondario",
                  "aria-pressed": daAssegnare === p.id ? "true" : "false",
                  onclick: () => {
                    daAssegnare = p.id;
                    tavoloScelto = null;
                    minuti = Math.min(Math.max(p.inizio_min, DA), A);
                    ora.value = minuti;
                    oraTesto.textContent = daMinuti(minuti);
                    disegna();
                  },
                }, "Assegna un tavolo"),
              ),
            ),
          )
        : h("p", { class: "legenda" }, "Tutte le prenotazioni attive hanno un tavolo."),
    );
    pannello.replaceChildren(...blocchi.filter(Boolean));
  }

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Sala")),
    h("div", { class: "strumenti" }, campoData(ricarica)),
    h(
      "div",
      { class: "barra-ora" },
      h("label", { class: "etichetta-ora", htmlFor: "cursore-ora" }, "Ora"),
      h("button", { type: "button", class: "secondario", "aria-label": "15 minuti prima", onclick: () => passo(-15) }, "‹"),
      ora,
      h("button", { type: "button", class: "secondario", "aria-label": "15 minuti dopo", onclick: () => passo(15) }, "›"),
      oraTesto,
      h("button", { type: "button", class: "secondario", onclick: adesso }, "Adesso"),
    ),
    schede,
    h("div", { class: "layout-sala" }, area, pannello),
  );
  await ricarica();
  return {};
}
