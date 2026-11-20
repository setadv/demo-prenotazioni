import { api, condiviso, h, persone, STATI, testoData } from "./comune.js";

/**
 * Avviso delle prenotazioni online da confermare: una fascia ben visibile in alto, un suono,
 * il numero nel titolo della scheda e, se il gestore lo consente, la notifica del browser.
 * L'avviso resta finché ogni prenotazione non viene confermata o annullata.
 * Il pannello controlla ogni 20 secondi, e subito dopo ogni modifica a una prenotazione.
 */
const OGNI_MS = 20000;
let timer = null;
let attivo = false;
let ridotto = false;
let conosciute = new Set();
let ultime = { totale: 0, prenotazioni: [] };
let suono = null;
let apriAgenda = () => {};

const fascia = h("section", { id: "nuove-prenotazioni", class: "nuove-prenotazioni", role: "alert", "aria-live": "assertive", hidden: true });
document.body.prepend(fascia);

/** Il browser permette il suono solo dopo un clic: il contesto audio si prepara al primo clic nel pannello. */
function preparaSuono() {
  if (suono) return;
  try {
    suono = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    suono = null;
  }
}
document.addEventListener("pointerdown", preparaSuono, { once: true });
document.addEventListener("keydown", preparaSuono, { once: true });

function suona() {
  if (!suono) return;
  if (suono.state === "suspended") suono.resume().catch(() => {});
  const t = suono.currentTime;
  [[880, 0], [1175, 0.18], [880, 0.6], [1175, 0.78]].forEach(([freq, inizio]) => {
    const o = suono.createOscillator();
    const g = suono.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t + inizio);
    g.gain.exponentialRampToValueAtTime(0.35, t + inizio + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + inizio + 0.35);
    o.connect(g).connect(suono.destination);
    o.start(t + inizio);
    o.stop(t + inizio + 0.4);
  });
}

const quando = (p) => `${testoData(p.data, { weekday: "short", day: "numeric", month: "short" })} alle ${p.ora}`;

function notificaBrowser(nuove, totale) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const p = nuove[0];
  try {
    const n = new Notification(totale === 1 ? "Prenotazione da confermare" : `${totale} prenotazioni da confermare`, {
      body: `${p.nome} · ${persone(p.persone)} · ${quando(p)}`,
      tag: "nuove-prenotazioni",
      renotify: true,
    });
    n.onclick = () => {
      window.focus();
      vai();
      n.close();
    };
  } catch {
    /* alcuni browser (per esempio su telefono) non mostrano notifiche da una pagina */
  }
}

function aggiornaTitolo() {
  const base = document.title.replace(/^\(\d+\) /, "");
  document.title = ultime.totale ? `(${ultime.totale}) ${base}` : base;
}

function disegna() {
  const { totale, prenotazioni } = ultime;
  aggiornaTitolo();
  document.body.classList.toggle("con-novita", totale > 0);
  if (!totale) {
    fascia.hidden = true;
    fascia.replaceChildren();
    return;
  }
  fascia.classList.toggle("ridotta", ridotto);
  const titolo = totale === 1 ? "1 prenotazione online da confermare" : `${totale} prenotazioni online da confermare`;
  if (ridotto) {
    fascia.replaceChildren(
      h(
        "button",
        { type: "button", class: "nuove-espandi", onclick: () => ((ridotto = false), disegna()) },
        h("span", { class: "campanella", "aria-hidden": "true" }, "🔔"),
        ` ${titolo}`,
      ),
    );
    fascia.hidden = false;
    return;
  }
  const altre = totale - Math.min(prenotazioni.length, 3);
  const permessoDaChiedere = "Notification" in window && Notification.permission === "default";
  fascia.replaceChildren(
    h(
      "div",
      { class: "nuove-testa" },
      h("span", { class: "campanella", "aria-hidden": "true" }, "🔔"),
      h("strong", {}, titolo),
    ),
    h(
      "ul",
      { class: "nuove-elenco" },
      prenotazioni.slice(0, 3).map((p) =>
        h(
          "li",
          {},
          h("b", {}, p.nome),
          ` · ${persone(p.persone)} · ${quando(p)}`,
          h("span", { class: "nuove-stato" }, STATI[p.stato] ?? p.stato),
        ),
      ),
      altre > 0 ? h("li", { class: "nuove-altre" }, altre === 1 ? "e 1 altra" : `e altre ${altre}`) : null,
    ),
    h("p", { class: "nuove-nota" }, "L'avviso resta finché le prenotazioni non vengono confermate o annullate."),
    h(
      "div",
      { class: "nuove-azioni" },
      h("button", { type: "button", class: "nuove-apri", onclick: vai }, "Apri in agenda"),
      h("button", { type: "button", class: "nuove-visto", onclick: () => ((ridotto = true), disegna()) }, "Riduci"),
      permessoDaChiedere
        ? h(
            "button",
            {
              type: "button",
              class: "nuove-permesso",
              onclick: () => Notification.requestPermission().then(disegna).catch(() => {}),
            },
            "Avvisami anche fuori dal pannello",
          )
        : null,
    ),
  );
  fascia.hidden = false;
}

/** Apre l'agenda sul giorno della prenotazione da confermare arrivata per prima. */
function vai() {
  const prima = ultime.prenotazioni[ultime.prenotazioni.length - 1];
  if (prima) condiviso.data = prima.data;
  ridotto = true;
  disegna();
  apriAgenda();
}

async function controlla() {
  if (!attivo) return;
  try {
    const dati = await api("/api/admin/novita");
    const nuove = dati.prenotazioni.filter((p) => !conosciute.has(p.id));
    conosciute = new Set(dati.prenotazioni.map((p) => p.id));
    ultime = { totale: dati.totale, prenotazioni: dati.prenotazioni };
    if (nuove.length) {
      ridotto = false; // una prenotazione nuova riapre la fascia anche se era ridotta
      suona();
      notificaBrowser(nuove, dati.totale);
    }
    disegna();
  } catch {
    /* rete assente o sessione scaduta: si riprova al prossimo giro */
  }
}

function alRitorno() {
  if (document.visibilityState === "visible") controlla();
}

/** Da chiamare dopo l'accesso. vaiAgenda apre la vista Agenda sul giorno già impostato. */
export function avviaNovita(_sessione, vaiAgenda) {
  fermaNovita();
  attivo = true;
  apriAgenda = vaiAgenda;
  controlla();
  timer = setInterval(controlla, OGNI_MS);
  document.addEventListener("visibilitychange", alRitorno);
  document.addEventListener("prenotazioni-cambiate", controlla);
}

export function fermaNovita() {
  clearInterval(timer);
  timer = null;
  attivo = false;
  ridotto = false;
  conosciute = new Set();
  ultime = { totale: 0, prenotazioni: [] };
  document.removeEventListener("visibilitychange", alRitorno);
  document.removeEventListener("prenotazioni-cambiate", controlla);
  disegna();
}

/** Il titolo della scheda cambia a ogni vista: il numero delle prenotazioni da confermare va rimesso davanti. */
export function titoloConNovita(titolo) {
  return ultime.totale ? `(${ultime.totale}) ${titolo}` : titolo;
}
