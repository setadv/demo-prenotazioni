import { api, condiviso, h, persone, STATI, testoData } from "./comune.js";

/**
 * Avviso delle nuove prenotazioni online: una fascia ben visibile in alto, un suono,
 * il numero nel titolo della scheda e, se il gestore lo consente, la notifica del browser.
 * Il pannello chiede le novità ogni 20 secondi; restano in evidenza finché qualcuno clicca "Ho visto".
 */
const OGNI_MS = 20000;
const PRIMO_AVVIO_MS = 12 * 3600000;
let timer = null;
let chiave = null;
let visto = null; // momento (ISO) fino al quale le prenotazioni sono già state viste
let conosciute = new Set();
let ultime = { totale: 0, prenotazioni: [] };
let suono = null;
let apriAgenda = () => {};

const fascia = h("section", { id: "nuove-prenotazioni", class: "nuove-prenotazioni", role: "alert", "aria-live": "assertive", hidden: true });
document.body.prepend(fascia);

function leggiVisto() {
  try {
    return localStorage.getItem(chiave);
  } catch {
    return null;
  }
}
function salvaVisto(valore) {
  visto = valore;
  try {
    localStorage.setItem(chiave, valore);
  } catch {
    /* senza memoria del browser vale solo per questa sessione */
  }
}

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

function notificaBrowser(nuove, totale) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const p = nuove[0];
  try {
    const n = new Notification(totale === 1 ? "Nuova prenotazione" : `${totale} nuove prenotazioni`, {
      body: `${p.nome} · ${persone(p.persone)} · ${testoData(p.data, { weekday: "short", day: "numeric", month: "short" })} alle ${p.ora}`,
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
  const altre = totale - Math.min(prenotazioni.length, 3);
  const permessoDaChiedere = "Notification" in window && Notification.permission === "default";
  fascia.replaceChildren(
    h(
      "div",
      { class: "nuove-testa" },
      h("span", { class: "campanella", "aria-hidden": "true" }, "🔔"),
      h("strong", {}, totale === 1 ? "Nuova prenotazione online" : `${totale} nuove prenotazioni online`),
    ),
    h(
      "ul",
      { class: "nuove-elenco" },
      prenotazioni.slice(0, 3).map((p) =>
        h(
          "li",
          {},
          h("b", {}, p.nome),
          ` · ${persone(p.persone)} · ${testoData(p.data, { weekday: "short", day: "numeric", month: "short" })} alle ${p.ora}`,
          h("span", { class: "nuove-stato", dataset: { stato: p.stato } }, STATI[p.stato] ?? p.stato),
        ),
      ),
      altre > 0 ? h("li", { class: "nuove-altre" }, altre === 1 ? "e 1 altra" : `e altre ${altre}`) : null,
    ),
    h(
      "div",
      { class: "nuove-azioni" },
      h("button", { type: "button", class: "nuove-apri", onclick: vai }, "Apri in agenda"),
      h("button", { type: "button", class: "nuove-visto", onclick: segnaVisto }, "Ho visto"),
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

function segnaVisto() {
  const piuRecente = ultime.prenotazioni[0]?.creata_il;
  if (piuRecente && piuRecente > (visto ?? "")) salvaVisto(piuRecente);
  ultime = { totale: 0, prenotazioni: [] };
  disegna();
  controlla();
}

function vai() {
  const prima = ultime.prenotazioni[ultime.prenotazioni.length - 1];
  if (prima) condiviso.data = prima.data;
  segnaVisto();
  apriAgenda();
}

async function controlla() {
  if (!chiave) return;
  try {
    const dati = await api(`/api/admin/novita${visto ? `?dopo=${encodeURIComponent(visto)}` : ""}`);
    if (!visto) {
      // Primo avvio su questo browser: mostra le prenotazioni online delle ultime 12 ore.
      salvaVisto(new Date(Date.parse(dati.adesso) - PRIMO_AVVIO_MS).toISOString());
      return controlla();
    }
    const nuove = dati.prenotazioni.filter((p) => !conosciute.has(p.id));
    dati.prenotazioni.forEach((p) => conosciute.add(p.id));
    ultime = { totale: dati.totale, prenotazioni: dati.prenotazioni };
    disegna();
    if (nuove.length) {
      suona();
      notificaBrowser(nuove, dati.totale);
    }
  } catch {
    /* rete assente o sessione scaduta: si riprova al prossimo giro */
  }
}

/** Da chiamare dopo l'accesso. vaiAgenda apre la vista Agenda sul giorno già impostato. */
export function avviaNovita(sessione, vaiAgenda) {
  fermaNovita();
  chiave = `novita-visto:${sessione.ristorante?.slug ?? sessione.nome ?? "ristorante"}`;
  visto = leggiVisto();
  apriAgenda = vaiAgenda;
  controlla();
  timer = setInterval(controlla, OGNI_MS);
  document.addEventListener("visibilitychange", alRitorno);
}

function alRitorno() {
  if (document.visibilityState === "visible") controlla();
}

export function fermaNovita() {
  clearInterval(timer);
  timer = null;
  chiave = null;
  conosciute = new Set();
  ultime = { totale: 0, prenotazioni: [] };
  document.removeEventListener("visibilitychange", alRitorno);
  disegna();
}

/** Il titolo della scheda cambia a ogni vista: il numero delle novità va rimesso davanti. */
export function titoloConNovita(titolo) {
  return ultime.totale ? `(${ultime.totale}) ${titolo}` : titolo;
}
