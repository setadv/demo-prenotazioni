import { dataIn, modelloIn, oggettoEmail, personeIn } from "./lingue.js";
import { base64url, giorniDa, hmac, leggiImpostazioni, oraRoma, sha256, spostaData, uguali } from "./util.js";

export const CANALI = ["email", "sms", "whatsapp"];
export const TIPI = ["conferma", "recensione"];

/** Il link personale del cliente si ricava dall'id: si può rigenerare quando serve senza conservare il token. */
export async function tokenPrenotazione(env, id) {
  return base64url(await hmac(env.SESSION_SECRET ?? "demo", `prenotazione:${id}`)).slice(0, 32);
}

export async function tokenValido(env, id, token, tokenHash) {
  if (!token) return false;
  if (uguali(token, await tokenPrenotazione(env, id))) return true;
  return Boolean(tokenHash) && uguali(await sha256(token), tokenHash);
}

export async function linkPrenotazione(env, origine, id, lingua = "it") {
  const l = lingua && lingua !== "it" ? `&l=${lingua}` : "";
  return `${origine}/prenotazione#id=${id}&t=${await tokenPrenotazione(env, id)}${l}`;
}

/** Numero in formato internazionale senza spazi. I cellulari italiani senza prefisso ricevono +39. */
export function numeroInternazionale(tel) {
  const pulito = String(tel ?? "").trim();
  let cifre = pulito.replace(/\D/g, "");
  if (pulito.startsWith("+")) return cifre.length >= 8 ? `+${cifre}` : null;
  if (cifre.startsWith("00")) cifre = cifre.slice(2);
  else if (/^3\d{8,9}$/.test(cifre)) cifre = `39${cifre}`;
  else if (/^0\d{5,10}$/.test(cifre)) cifre = `39${cifre}`;
  return cifre.length >= 10 ? `+${cifre}` : null;
}

const whatsappBase = (env) => Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);

export function canaliAttivi(env) {
  return {
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_MITTENTE),
    sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_NUMERO),
    whatsapp: whatsappBase(env) && Boolean(env.WHATSAPP_MODELLO_CONFERMA),
    whatsapp_recensione: whatsappBase(env) && Boolean(env.WHATSAPP_MODELLO_RECENSIONE),
  };
}

function valoriMessaggio(imp, p, extra = {}) {
  const lingua = p.lingua ?? "it";
  return {
    nome: String(p.nome ?? "").split(" ")[0],
    ristorante: imp.nome,
    persone: personeIn(lingua, p.persone),
    data: dataIn(lingua, p.data),
    ora: p.ora,
    codice: p.codice,
    telefono: imp.telefono,
    indirizzo: imp.indirizzo,
    link: extra.link ?? "",
    recensione: extra.recensione ?? imp.link_recensioni ?? "",
  };
}

const sostituisci = (modello, valori) => modello.replace(/\{(\w+)\}/g, (tutto, k) => (k in valori ? valori[k] : tutto));

/** Testo pronto del messaggio, nella lingua della prenotazione. */
export function componiMessaggio(tipo, imp, p, extra = {}) {
  const chiave = tipo === "recensione" ? "messaggio_recensione" : "messaggio_conferma";
  return sostituisci(modelloIn(imp, chiave, p.lingua), valoriMessaggio(imp, p, extra));
}

/** Parametri dei modelli WhatsApp approvati da Meta, nell'ordine {{1}}, {{2}}, ... indicato nel README. */
function parametriWhatsApp(tipo, v) {
  return tipo === "recensione" ? [v.nome, v.ristorante, v.recensione] : [v.nome, v.ristorante, v.persone, v.data, v.ora, v.codice, v.link];
}

/** Codice lingua del modello WhatsApp: quello approvato per la lingua del cliente, altrimenti il primo dell'elenco. */
export function linguaWhatsApp(env, lingua) {
  const approvate = String(env.WHATSAPP_LINGUE ?? "it")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return approvate.find((l) => l.slice(0, 2).toLowerCase() === lingua) ?? approvate[0] ?? "it";
}

async function inviaEmail(env, destinatario, oggetto, testo) {
  const r = await fetch(env.RESEND_ENDPOINT ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "user-agent": "demo-prenotazioni/1.0",
    },
    body: JSON.stringify({ from: env.EMAIL_MITTENTE, to: [destinatario], subject: oggetto, text: testo }),
  });
  if (!r.ok) throw new Error(`Email non inviata (${r.status}): ${(await r.text()).slice(0, 160)}`);
}

async function inviaSms(env, numero, testo) {
  const base = env.TWILIO_ENDPOINT ?? "https://api.twilio.com";
  const r = await fetch(`${base}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: numero, From: env.TWILIO_NUMERO, Body: testo }),
  });
  if (!r.ok) throw new Error(`SMS non inviato (${r.status}): ${(await r.text()).slice(0, 160)}`);
}

/** Messaggio con modello approvato tramite l'API Cloud di WhatsApp (Meta). */
async function inviaWhatsApp(env, { numero, modello, lingua, parametri, testo, prenotazioneId }) {
  const base = env.WHATSAPP_ENDPOINT ?? "https://graph.facebook.com/v23.0";
  const r = await fetch(`${base}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: numero.replace(/^\+/, ""),
      type: "template",
      template: {
        name: modello,
        language: { code: linguaWhatsApp(env, lingua) },
        components: [{ type: "body", parameters: parametri.map((t) => ({ type: "text", text: String(t) })) }],
      },
    }),
  });
  const risposta = await r.text();
  if (!r.ok) throw new Error(`WhatsApp non inviato (${r.status}): ${risposta.slice(0, 160)}`);
  let id = null;
  try {
    id = JSON.parse(risposta).messages?.[0]?.id ?? null;
  } catch {}
  if (id) {
    const adesso = new Date().toISOString();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO whatsapp_messaggi (id, direzione, numero, testo, stato, prenotazione_id, creato_il, aggiornato_il)
       VALUES (?, 'out', ?, ?, 'accettato', ?, ?, ?)`,
    )
      .bind(id, numero, testo.slice(0, 1000), prenotazioneId, adesso, adesso)
      .run();
  }
}

async function registra(env, id, canale, esito, dettaglio = "", tipo = "conferma") {
  await env.DB.prepare("INSERT INTO notifiche (prenotazione_id, canale, esito, dettaglio, creata_il, tipo) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, canale, esito, dettaglio.slice(0, 300), new Date().toISOString(), tipo)
    .run();
}

/**
 * Invia il messaggio sul canale scelto dal cliente, poi prova gli altri canali automatici.
 * Chi preferisce WhatsApp non riceve SMS a pagamento al suo posto; se WhatsApp non è
 * automatico il messaggio resta da inviare con un clic dal pannello.
 * Le richieste di recensione non usano mai l'SMS se il cliente non l'ha scelto.
 */
async function invia(env, imp, p, tipo, extra) {
  const attivi = canaliAttivi(env);
  const numero = numeroInternazionale(p.telefono);
  const possibili = {
    whatsapp: (tipo === "recensione" ? attivi.whatsapp_recensione : attivi.whatsapp) && numero,
    email: attivi.email && p.email,
    sms: attivi.sms && numero,
  };
  let ordine;
  if (p.canale === "whatsapp") ordine = possibili.whatsapp ? ["whatsapp", "email"] : [];
  else ordine = [p.canale, "email", "sms"];
  if (tipo === "recensione") ordine = ordine.filter((c) => c !== "sms" || p.canale === "sms");
  ordine = ordine.filter((c, i, a) => a.indexOf(c) === i && possibili[c]);

  const valori = valoriMessaggio(imp, p, extra);
  const testo = componiMessaggio(tipo, imp, p, extra);
  for (const canale of ordine) {
    try {
      if (canale === "email") await inviaEmail(env, p.email, oggettoEmail(tipo, p.lingua, imp.nome), testo);
      else if (canale === "sms") await inviaSms(env, numero, testo);
      else {
        await inviaWhatsApp(env, {
          numero,
          modello: tipo === "recensione" ? env.WHATSAPP_MODELLO_RECENSIONE : env.WHATSAPP_MODELLO_CONFERMA,
          lingua: p.lingua ?? "it",
          parametri: parametriWhatsApp(tipo, valori),
          testo,
          prenotazioneId: p.id,
        });
      }
      await registra(env, p.id, canale, "inviata", canale === "email" ? p.email : numero, tipo);
      return true;
    } catch (e) {
      await registra(env, p.id, canale, "errore", e.message, tipo);
    }
  }
  await registra(env, p.id, p.canale, "da_inviare", ordine.length ? "Invio automatico non riuscito" : "Invio automatico non configurato per questo canale", tipo);
  return false;
}

export async function inviaConferma(env, imp, p, origine) {
  try {
    const gia = await env.DB.prepare(
      "SELECT 1 FROM notifiche WHERE prenotazione_id = ? AND tipo = 'conferma' AND esito IN ('inviata', 'manuale') LIMIT 1",
    )
      .bind(p.id)
      .first();
    if (gia) return;
    await invia(env, imp, p, "conferma", { link: await linkPrenotazione(env, origine, p.id, p.lingua) });
  } catch (e) {
    console.error("Notifica non registrata", e);
  }
}

/**
 * Chiede la recensione ai clienti arrivati, qualche ora dopo la fine del pasto e una sola volta.
 * Gira ogni 15 minuti (Cron Trigger) e quando il gestore apre l'agenda.
 * Tutti ricevono lo stesso link: Google vieta di filtrare chi è invitato a recensire.
 */
export async function elaboraRecensioni(env) {
  try {
    const imp = await leggiImpostazioni(env);
    if (!imp.link_recensioni || !imp.recensioni_automatiche) return 0;
    const adesso = oraRoma();
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.codice, p.data, p.ora, p.inizio_min, p.durata, p.persone, p.nome, p.telefono, p.email, p.canale, p.lingua
       FROM prenotazioni_v2 p
       WHERE p.stato = 'arrivata' AND p.data BETWEEN ? AND ? AND (p.telefono <> '' OR p.email <> '')
         AND NOT EXISTS (SELECT 1 FROM notifiche n WHERE n.prenotazione_id = p.id AND n.tipo = 'recensione')
       ORDER BY p.data, p.inizio_min LIMIT 25`,
    )
      .bind(spostaData(adesso.data, -2), adesso.data)
      .all();
    let inviate = 0;
    for (const p of results) {
      const trascorsi = giorniDa(p.data, adesso.data) * 1440 + adesso.minuti - (p.inizio_min + p.durata);
      if (trascorsi < imp.recensione_dopo_ore * 60) continue;
      // Prenota l'invio in un'unica istruzione: due esecuzioni contemporanee non mandano due messaggi.
      const presa = await env.DB.prepare(
        `INSERT INTO notifiche (prenotazione_id, canale, esito, dettaglio, creata_il, tipo)
         SELECT ?1, ?2, 'da_inviare', 'In preparazione', ?3, 'recensione'
         WHERE NOT EXISTS (SELECT 1 FROM notifiche WHERE prenotazione_id = ?1 AND tipo = 'recensione')`,
      )
        .bind(p.id, p.canale, new Date().toISOString())
        .run();
      if (!presa.meta.changes) continue;
      if (await invia(env, imp, p, "recensione", {})) inviate += 1;
    }
    return inviate;
  } catch (e) {
    console.error("Richieste di recensione non elaborate", e);
    return 0;
  }
}

export async function registraInvioManuale(env, id, canale, tipo = "conferma") {
  await registra(env, id, canale, "manuale", "Inviato dal gestore", tipo);
}
