export const STATI = ["in_attesa", "confermata", "arrivata", "no_show", "annullata"];
export const STATI_ATTIVI = ["in_attesa", "confermata", "arrivata"];
export const ORIGINI = ["online", "telefono", "walk_in"];
export const OCCASIONI = ["", "compleanno", "anniversario", "romantica", "lavoro", "famiglia", "altro"];
export const SQL_ATTIVI = "('in_attesa', 'confermata', 'arrivata')";

const encoder = new TextEncoder();

export const json = (dati, status = 200, headers = {}) =>
  new Response(JSON.stringify(dati), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...headers,
    },
  });

export const errore = (messaggio, status = 400, extra = {}) => json({ errore: messaggio, ...extra }, status);

export class ErroreRichiesta extends Error {
  constructor(messaggio, status = 400) {
    super(messaggio);
    this.status = status;
  }
}

export function oraRoma(adesso = new Date()) {
  const parti = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(adesso)
      .map((p) => [p.type, p.value]),
  );
  const ora = `${parti.hour}:${parti.minute}`;
  return { data: `${parti.year}-${parti.month}-${parti.day}`, ora, minuti: aMinuti(ora) };
}

export function dataValida(valore) {
  if (typeof valore !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false;
  const d = new Date(`${valore}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valore;
}

export const oraValida = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const aMinuti = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const daMinuti = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function giorniDa(da, a) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86400000);
}

export function spostaData(data, giorni) {
  return new Date(Date.parse(`${data}T12:00:00Z`) + giorni * 86400000).toISOString().slice(0, 10);
}

export const giornoSettimana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();

export function testo(valore, max, { min = 0, campo = "Il campo" } = {}) {
  const t = typeof valore === "string" ? valore.trim() : valore == null ? "" : String(valore).trim();
  if (t.length < min) throw new ErroreRichiesta(min > 1 ? `${campo} deve avere almeno ${min} caratteri.` : `${campo} è obbligatorio.`);
  if (t.length > max) throw new ErroreRichiesta(`${campo} può avere al massimo ${max} caratteri.`);
  return t;
}

export function intero(valore, min, max, campo) {
  const n = Number(valore);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErroreRichiesta(`${campo}: inserisci un numero da ${min} a ${max}.`);
  return n;
}

export function normalizzaTelefono(tel) {
  let cifre = String(tel ?? "").replace(/\D/g, "");
  if (cifre.startsWith("0039")) cifre = cifre.slice(4);
  else if (cifre.startsWith("39") && cifre.length >= 11) cifre = cifre.slice(2);
  return cifre.length >= 6 ? cifre : null;
}

export const emailValida = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

export const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export async function hmac(segreto, testoDaFirmare) {
  const chiave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(segreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", chiave, encoder.encode(testoDaFirmare)));
}

export async function sha256(testoDaHash) {
  return base64url(await crypto.subtle.digest("SHA-256", encoder.encode(testoDaHash)));
}

export function uguali(a, b) {
  const x = typeof a === "string" ? encoder.encode(a) : a;
  const y = typeof b === "string" ? encoder.encode(b) : b;
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

export function tokenCasuale() {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function codiceCasuale() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ALFABETO[b % ALFABETO.length]).join("");
}

export async function leggiJson(request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    throw new ErroreRichiesta("Richiesta non valida.");
  }
  try {
    const corpo = await request.json();
    if (corpo && typeof corpo === "object" && !Array.isArray(corpo)) return corpo;
  } catch {}
  throw new ErroreRichiesta("Richiesta non valida.");
}

export async function impronta(request, env) {
  const ip = request.headers.get("cf-connecting-ip") ?? "locale";
  return base64url(await hmac(env.SESSION_SECRET ?? "demo", ip)).slice(0, 22);
}

export async function limiteSuperato(env, chiave, massimo, minuti) {
  const riga = await env.DB.prepare("SELECT COUNT(*) AS totale FROM tentativi WHERE chiave = ? AND momento > ?")
    .bind(chiave, Date.now() - minuti * 60000)
    .first();
  return riga.totale >= massimo;
}

export async function registraTentativo(env, chiave) {
  const adesso = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tentativi WHERE momento < ?").bind(adesso - 86400000),
    env.DB.prepare("INSERT INTO tentativi (chiave, momento) VALUES (?, ?)").bind(chiave, adesso),
  ]);
}

const NUMERICHE = new Set([
  "prezzo_medio",
  "durata",
  "intervallo",
  "anticipo",
  "giorni_prenotabili",
  "max_persone_online",
  "conferma_automatica",
]);

export async function leggiImpostazioni(env) {
  const { results } = await env.DB.prepare("SELECT chiave, valore FROM impostazioni").all();
  const imp = {};
  for (const r of results) imp[r.chiave] = NUMERICHE.has(r.chiave) ? Number(r.valore) : r.valore;
  return imp;
}
