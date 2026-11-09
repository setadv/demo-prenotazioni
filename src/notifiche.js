import { base64url, hmac, sha256, uguali } from "./util.js";

export const CANALI = ["email", "sms", "whatsapp"];

/** Il link personale del cliente si ricava dall'id: si può rigenerare quando serve senza conservare il token. */
export async function tokenPrenotazione(env, id) {
  return base64url(await hmac(env.SESSION_SECRET ?? "demo", `prenotazione:${id}`)).slice(0, 32);
}

export async function tokenValido(env, id, token, tokenHash) {
  if (!token) return false;
  if (uguali(token, await tokenPrenotazione(env, id))) return true;
  return Boolean(tokenHash) && uguali(await sha256(token), tokenHash);
}

export async function linkPrenotazione(env, origine, id) {
  return `${origine}/prenotazione#id=${id}&t=${await tokenPrenotazione(env, id)}`;
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

export function canaliAttivi(env) {
  return {
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_MITTENTE),
    sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_NUMERO),
    whatsapp: false,
  };
}

export function componiMessaggio(modello, imp, p, link) {
  const data = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${p.data}T12:00:00Z`),
  );
  const valori = {
    nome: p.nome.split(" ")[0],
    ristorante: imp.nome,
    persone: p.persone === 1 ? "1 persona" : `${p.persone} persone`,
    data,
    ora: p.ora,
    codice: p.codice,
    link,
    telefono: imp.telefono,
    indirizzo: imp.indirizzo,
  };
  return modello.replace(/\{(\w+)\}/g, (tutto, chiave) => (chiave in valori ? valori[chiave] : tutto));
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

async function registra(env, id, canale, esito, dettaglio = "") {
  await env.DB.prepare("INSERT INTO notifiche (prenotazione_id, canale, esito, dettaglio, creata_il) VALUES (?, ?, ?, ?, ?)")
    .bind(id, canale, esito, dettaglio.slice(0, 300), new Date().toISOString())
    .run();
}

/**
 * Invia la conferma sul canale scelto dal cliente. Se quel canale non è automatico,
 * prova un altro canale automatico disponibile; altrimenti segna il messaggio come
 * da inviare, così il gestore lo manda con un clic dal pannello.
 */
export async function inviaConferma(env, imp, p, origine) {
  try {
    const gia = await env.DB.prepare("SELECT 1 FROM notifiche WHERE prenotazione_id = ? AND esito IN ('inviata', 'manuale') LIMIT 1")
      .bind(p.id)
      .first();
    if (gia) return;
    const testo = componiMessaggio(imp.messaggio_conferma, imp, p, await linkPrenotazione(env, origine, p.id));
    const attivi = canaliAttivi(env);
    const numero = numeroInternazionale(p.telefono);
    const possibili = {
      email: attivi.email && p.email,
      sms: attivi.sms && numero,
    };
    // Chi preferisce WhatsApp riceve il messaggio dal gestore con un clic: niente SMS a pagamento al suo posto.
    const ordine = p.canale === "whatsapp" ? [] : [p.canale, "email", "sms"].filter((c, i, a) => a.indexOf(c) === i && possibili[c]);
    for (const canale of ordine) {
      try {
        if (canale === "email") await inviaEmail(env, p.email, `Prenotazione confermata da ${imp.nome}`, testo);
        else await inviaSms(env, numero, testo);
        await registra(env, p.id, canale, "inviata", canale === "email" ? p.email : numero);
        return;
      } catch (e) {
        await registra(env, p.id, canale, "errore", e.message);
      }
    }
    await registra(env, p.id, p.canale, "da_inviare", ordine.length ? "Invio automatico non riuscito" : "Invio automatico non configurato per questo canale");
  } catch (e) {
    console.error("Notifica non registrata", e);
  }
}

export async function registraInvioManuale(env, id, canale) {
  await registra(env, id, canale, "manuale", "Inviato dal gestore");
}
