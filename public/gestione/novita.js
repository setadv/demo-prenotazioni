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
const VUOTO = { totale: 0, prenotazioni: [], ordini_totale: 0, ordini: [] };
let ultime = VUOTO;
let apriOrdini = () => {};
const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);
const STATI_ORDINE = { nuovo: "Da accettare", in_preparazione: "In preparazione", pronto: "Pronto", in_consegna: "In consegna" };
const complessivo = () => ultime.totale + ultime.ordini_totale;
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

function notificaBrowser(nuove) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const p = nuove[0];
  const ordine = Boolean(p.tipo);
  try {
    const n = new Notification(ordine ? "Nuovo ordine da evadere" : "Prenotazione da confermare", {
      body: ordine ? `${p.nome} · ${p.tipo === "consegna" ? "Consegna" : "Asporto"} alle ${p.ora} · ${euro(p.totale)}` : `${p.nome} · ${persone(p.persone)} · ${quando(p)}`,
      tag: "nuove-prenotazioni",
      renotify: true,
    });
    n.onclick = () => {
      window.focus();
      ordine ? vaiOrdini() : vai();
      n.close();
    };
  } catch {
    /* alcuni browser (per esempio su telefono) non mostrano notifiche da una pagina */
  }
}

function aggiornaTitolo() {
  const base = document.title.replace(/^\(\d+\) /, "");
  document.title = complessivo() ? `(${complessivo()}) ${base}` : base;
}

function titoloAvviso() {
  const parti = [];
  if (ultime.totale) parti.push(ultime.totale === 1 ? "1 prenotazione da confermare" : `${ultime.totale} prenotazioni da confermare`);
  if (ultime.ordini_totale) parti.push(ultime.ordini_totale === 1 ? "1 ordine di oggi da evadere" : `${ultime.ordini_totale} ordini di oggi da evadere`);
  return parti.join(" · ");
}

function elenco(righe, totale, riga) {
  const altre = totale - Math.min(righe.length, 3);
  return h(
    "ul",
    { class: "nuove-elenco" },
    righe.slice(0, 3).map(riga),
    altre > 0 ? h("li", { class: "nuove-altre" }, altre === 1 ? "e 1 altro" : `e altri ${altre}`) : null,
  );
}

function disegna() {
  const totale = complessivo();
  aggiornaTitolo();
  document.body.classList.toggle("con-novita", totale > 0);
  if (!totale) {
    fascia.hidden = true;
    fascia.replaceChildren();
    return;
  }
  fascia.classList.toggle("ridotta", ridotto);
  const titolo = titoloAvviso();
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
  const permessoDaChiedere = "Notification" in window && Notification.permission === "default";
  fascia.replaceChildren(
    h(
      "div",
      { class: "nuove-testa" },
      h("span", { class: "campanella", "aria-hidden": "true" }, "🔔"),
      h("strong", {}, titolo),
    ),
    ultime.totale
      ? [
          ultime.ordini_totale ? h("p", { class: "nuove-sezione" }, "Prenotazioni online") : null,
          elenco(ultime.prenotazioni, ultime.totale, (p) =>
            h("li", {}, h("b", {}, p.nome), ` · ${persone(p.persone)} · ${quando(p)}`, h("span", { class: "nuove-stato" }, STATI[p.stato] ?? p.stato)),
          ),
        ]
      : null,
    ultime.ordini_totale
      ? [
          ultime.totale ? h("p", { class: "nuove-sezione" }, "Ordini di oggi") : null,
          elenco(ultime.ordini, ultime.ordini_totale, (o) =>
            h(
              "li",
              {},
              h("b", {}, o.nome),
              ` · ${o.tipo === "consegna" ? "Consegna" : "Asporto"} alle ${o.ora} · ${euro(o.totale)}`,
              h("span", { class: "nuove-stato" }, STATI_ORDINE[o.stato] ?? o.stato),
            ),
          ),
        ]
      : null,
    h("p", { class: "nuove-nota" }, "L'avviso resta finché le prenotazioni non sono confermate o annullate e gli ordini completati o annullati."),
    h(
      "div",
      { class: "nuove-azioni" },
      ultime.totale ? h("button", { type: "button", class: "nuove-apri", onclick: vai }, "Apri in agenda") : null,
      ultime.ordini_totale ? h("button", { type: "button", class: "nuove-apri", onclick: vaiOrdini }, "Apri ordini") : null,
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

/** Apre gli ordini sul giorno di oggi. */
function vaiOrdini() {
  condiviso.data = ultime.ordini[0]?.data ?? condiviso.data;
  ridotto = true;
  disegna();
  apriOrdini();
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
    ultime = { ...VUOTO, ...dati, ordini: dati.ordini ?? [] };
    const tutte = [...ultime.prenotazioni, ...ultime.ordini];
    const nuove = tutte.filter((x) => !conosciute.has(x.id));
    conosciute = new Set(tutte.map((x) => x.id));
    if (nuove.length) {
      ridotto = false; // una novità riapre la fascia anche se era ridotta
      suona();
      notificaBrowser(nuove);
    }
    disegna();
  } catch {
    /* rete assente o sessione scaduta: si riprova al prossimo giro */
  }
}

function alRitorno() {
  if (document.visibilityState === "visible") controlla();
}

/** Da chiamare dopo l'accesso. vaiA(vista) apre la vista indicata sul giorno già impostato. */
export function avviaNovita(_sessione, vaiA) {
  fermaNovita();
  attivo = true;
  apriAgenda = () => vaiA("agenda");
  apriOrdini = () => vaiA("ordini");
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
  ultime = VUOTO;
  document.removeEventListener("visibilitychange", alRitorno);
  document.removeEventListener("prenotazioni-cambiate", controlla);
  disegna();
}

/** Il titolo della scheda cambia a ogni vista: il numero delle prenotazioni da confermare va rimesso davanti. */
export function titoloConNovita(titolo) {
  return complessivo() ? `(${complessivo()}) ${titolo}` : titolo;
}
