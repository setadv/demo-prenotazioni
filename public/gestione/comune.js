export const $ = (id) => document.getElementById(id);

const PROPRIETA = new Set(["value", "checked", "disabled", "hidden", "selected", "type", "htmlFor", "min", "max", "step"]);

/** Crea un elemento DOM senza usare innerHTML: i testi dei clienti non vengono mai interpretati come HTML. */
export function h(tag, attributi = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (PROPRIETA.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of figli.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

export class ErroreApi extends Error {
  constructor(messaggio, status) {
    super(messaggio);
    this.status = status;
  }
}

export async function api(percorso, { metodo = "GET", corpo, grezzo = false } = {}) {
  const opzioni = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    if (grezzo) opzioni.body = corpo;
    else {
      opzioni.headers["content-type"] = "application/json";
      opzioni.body = JSON.stringify(corpo);
    }
  }
  const r = await fetch(percorso, opzioni);
  const dati = await r.json().catch(() => ({}));
  if (r.status === 401 && percorso !== "/api/admin/login") {
    document.dispatchEvent(new CustomEvent("sessione-scaduta"));
  }
  if (!r.ok) throw new ErroreApi(dati.errore || "Operazione non riuscita. Riprova.", r.status);
  return dati;
}

let timerAvviso;
export function avviso(testo, tipo = "ok") {
  const el = $("avviso");
  el.textContent = testo;
  el.dataset.tipo = tipo;
  el.classList.add("visibile");
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => el.classList.remove("visibile"), tipo === "errore" ? 7000 : 3500);
}

export const oggiRoma = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
export const oraRoma = () =>
  new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
export const spostaData = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const aMinuti = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const daMinuti = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const testoData = (iso, opzioni = { weekday: "long", day: "numeric", month: "long" }) =>
  new Intl.DateTimeFormat("it-IT", { ...opzioni, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
export const persone = (n) => (n === 1 ? "1 persona" : `${n} persone`);

export const STATI = {
  in_attesa: "Da confermare",
  confermata: "Confermata",
  arrivata: "Arrivati",
  no_show: "Non presentati",
  annullata: "Annullata",
};
export const ATTIVI = ["in_attesa", "confermata", "arrivata"];
export const ORIGINI = { online: "Online", telefono: "Telefono", walk_in: "Senza prenotazione" };
export const OCCASIONI = {
  compleanno: "Compleanno",
  anniversario: "Anniversario",
  romantica: "Cena romantica",
  lavoro: "Lavoro",
  famiglia: "In famiglia",
  altro: "Occasione speciale",
};
export const GIORNI = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
export const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0];

/** Data condivisa tra Agenda e Sala, così passando da una vista all'altra si resta sullo stesso giorno. */
export const condiviso = { data: oggiRoma() };

export function campoData(onCambia) {
  const input = h("input", { type: "date", value: condiviso.data, "aria-label": "Giorno" });
  const vai = (giorni) => {
    condiviso.data = giorni === null ? oggiRoma() : spostaData(condiviso.data, giorni);
    input.value = condiviso.data;
    onCambia();
  };
  input.addEventListener("change", () => {
    if (!input.value) return;
    condiviso.data = input.value;
    onCambia();
  });
  return h(
    "div",
    { class: "scegli-giorno" },
    h("button", { type: "button", class: "secondario", "aria-label": "Giorno precedente", onclick: () => vai(-1) }, "‹"),
    input,
    h("button", { type: "button", class: "secondario", "aria-label": "Giorno successivo", onclick: () => vai(1) }, "›"),
    h("button", { type: "button", class: "secondario", onclick: () => vai(null) }, "Oggi"),
  );
}

export function apriDialogo(...contenuto) {
  const d = $("dialogo");
  d.replaceChildren(...contenuto.filter(Boolean));
  if (!d.open) d.showModal();
  return d;
}

export function chiudiDialogo() {
  const d = $("dialogo");
  if (d.open) d.close();
}

/** Numero per i link WhatsApp e SMS: solo cifre, con prefisso internazionale (+39 per i numeri italiani senza prefisso). */
export function numeroWhatsApp(tel) {
  const pulito = String(tel ?? "").trim();
  let cifre = pulito.replace(/\D/g, "");
  if (pulito.startsWith("+")) return cifre.length >= 8 ? cifre : null;
  if (cifre.startsWith("00")) cifre = cifre.slice(2);
  else if (/^3\d{8,9}$/.test(cifre) || /^0\d{5,10}$/.test(cifre)) cifre = `39${cifre}`;
  return cifre.length >= 10 ? cifre : null;
}

export function etichettaTavolo(t) {
  return `${t.nome} (${t.posti_min === t.posti_max ? t.posti_max : `${t.posti_min}-${t.posti_max}`} posti)`;
}
