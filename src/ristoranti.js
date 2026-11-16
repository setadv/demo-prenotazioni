import { MODULI } from "./predefiniti.js";
import { base64url } from "./util.js";

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const STATI_RISTORANTE = ["prova", "attivo", "sospeso", "disattivato"];

/** Chiavi delle integrazioni che ogni ristorante configura per sé (cifrate nel database). */
export const CHIAVI_INTEGRAZIONI = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_ID",
  "WHATSAPP_LINGUE",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_MODELLO_CONFERMA",
  "WHATSAPP_MODELLO_RECENSIONE",
  "WHATSAPP_MODELLO_SONDAGGIO",
  "WHATSAPP_MODELLO_PREMIO",
  "WHATSAPP_MODELLO_ORDINE",
  "WHATSAPP_MODELLO_GIFT",
];

const oggi = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());

/** Il ristorante può ricevere prenotazioni e ordini: attivo, oppure in prova non scaduta. */
export function operativo(r) {
  if (!r) return false;
  if (r.stato === "attivo") return true;
  return r.stato === "prova" && (!r.prova_fino || r.prova_fino >= oggi());
}

/** Stato mostrato all'amministratore, con la prova scaduta trattata come sospensione. */
export function statoEffettivo(r) {
  if (r.stato === "prova" && r.prova_fino && r.prova_fino < oggi()) return "prova_scaduta";
  return r.stato;
}

export const moduliDi = (r) => new Set(String(r?.moduli ?? "").split(",").filter((m) => m in MODULI));

async function chiaveCifratura(env) {
  const materiale = new TextEncoder().encode(`integrazioni:${env.CHIAVE_CIFRATURA ?? env.SESSION_SECRET ?? "demo"}`);
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", materiale), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function cifra(env, oggetto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dati = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chiaveCifratura(env), new TextEncoder().encode(JSON.stringify(oggetto))));
  const tutto = new Uint8Array(iv.length + dati.length);
  tutto.set(iv);
  tutto.set(dati, iv.length);
  return base64url(tutto);
}

export async function decifra(env, testo) {
  if (!testo) return {};
  try {
    const b = Uint8Array.from(atob(testo.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((testo.length + 3) % 4)), (c) => c.charCodeAt(0));
    const chiaro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, await chiaveCifratura(env), b.slice(12));
    return JSON.parse(new TextDecoder().decode(chiaro));
  } catch {
    return {};
  }
}

/** Ristorante della richiesta pubblica: sottodominio, poi ?r=, header, cookie e infine il ristorante predefinito. */
export function slugRichiesta(request, url, env) {
  const host = url.hostname.toLowerCase();
  const base = String(env.DOMINIO_BASE ?? "").toLowerCase();
  if (base && host.endsWith(`.${base}`)) {
    const sotto = host.slice(0, -base.length - 1);
    if (SLUG.test(sotto)) return sotto;
  }
  const cookie = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)r=([a-z0-9-]{1,40})/)?.[1];
  for (const s of [url.searchParams.get("r"), request.headers.get("x-ristorante"), cookie, env.RISTORANTE_PREDEFINITO]) {
    if (s && SLUG.test(s)) return s;
  }
  return null;
}

/** Il ristorante predefinito (la demo) usa i secret dell'app e la password principale. */
export function predefinito(env, r) {
  return Boolean(r) && (env.RISTORANTE_PREDEFINITO ? r.slug === env.RISTORANTE_PREDEFINITO : r.id === "demo");
}

/** Ristorante della richiesta pubblica; senza indicazioni è quello predefinito. */
export async function ristoranteRichiesta(request, url, env) {
  const slug = slugRichiesta(request, url, env);
  if (slug) return ristorantePerSlug(env, slug);
  return env.DB.prepare("SELECT * FROM ristoranti WHERE id = 'demo'").first();
}

export async function ristorantePerSlug(env, slug) {
  return slug ? env.DB.prepare("SELECT * FROM ristoranti WHERE slug = ?").bind(slug).first() : null;
}

export async function ristorantePerId(env, id) {
  return id ? env.DB.prepare("SELECT * FROM ristoranti WHERE id = ?").bind(id).first() : null;
}

/** Indirizzo pubblico del ristorante: il suo sottodominio, oppure questo sito con ?r=slug. */
export function urlRistorante(env, r, origine) {
  if (env.DOMINIO_BASE) return { base: `https://${r.slug}.${env.DOMINIO_BASE}`, query: "" };
  // Il ristorante predefinito risponde anche senza ?r=: i suoi link restano quelli di sempre.
  return { base: origine, query: predefinito(env, r) ? "" : `r=${r.slug}` };
}

/**
 * Contesto di un ristorante: l'env della richiesta con id, moduli, indirizzo pubblico e
 * integrazioni del ristorante. Il resto del codice legge solo da qui, quindi non vede mai
 * i dati o le chiavi di un altro ristorante.
 */
export async function contesto(env, r, origine) {
  const moduli = moduliDi(r);
  const c = { ...env, RID: r.id, SLUG: r.slug, RISTORANTE: r, MODULI: moduli, URL_PUBBLICO: urlRistorante(env, r, origine) };
  // Le integrazioni dei secret valgono solo per il ristorante indicato (la demo); gli altri usano le proprie.
  const usaSecret = predefinito(env, r);
  if (!usaSecret) for (const k of CHIAVI_INTEGRAZIONI) delete c[k];
  Object.assign(c, Object.fromEntries(Object.entries(await decifra(env, r.integrazioni)).filter(([k, v]) => CHIAVI_INTEGRAZIONI.includes(k) && v)));
  if (!moduli.has("whatsapp")) {
    delete c.WHATSAPP_TOKEN;
    delete c.WHATSAPP_PHONE_ID;
  }
  if (!moduli.has("gift") && !moduli.has("ordini")) delete c.STRIPE_SECRET_KEY;
  // Il mittente delle email è quello della piattaforma, con il nome del ristorante.
  const indirizzo = String(env.EMAIL_MITTENTE ?? "").match(/<([^>]+)>/)?.[1] ?? env.EMAIL_MITTENTE;
  if (indirizzo) c.EMAIL_MITTENTE = `${r.nome.replace(/[<>"]/g, "")} <${indirizzo}>`;
  return c;
}

/**
 * Link a una pagina pubblica del ristorante, con eventuali parametri e frammento (#...).
 * Con DOMINIO_BASE è il sottodominio del ristorante; altrimenti l'origine indicata (o quella della richiesta) con ?r=slug.
 */
export function linkPubblico(env, percorso, { origine = null, query = "", frammento = "" } = {}) {
  const u = env.URL_PUBBLICO ?? { base: "", query: "" };
  const base = env.DOMINIO_BASE || !origine ? u.base : origine;
  const parametri = [query, u.query].filter(Boolean).join("&");
  return `${base}${percorso}${parametri ? `?${parametri}` : ""}${frammento ? `#${frammento}` : ""}`;
}

export function registra(env, { ristorante = null, autore, azione, dettaglio = "" }) {
  return env.DB.prepare("INSERT INTO registro (ristorante_id, autore, azione, dettaglio, creato_il) VALUES (?, ?, ?, ?, ?)")
    .bind(ristorante, String(autore).slice(0, 120), azione, String(dettaglio).slice(0, 500), new Date().toISOString())
    .run();
}
