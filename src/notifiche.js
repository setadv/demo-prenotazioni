import { linkPubblico } from "./ristoranti.js";
import { LOCALI, dataIn, linguaValida, modelloIn, oggettoEmail, personeIn } from "./lingue.js";
import { base64url, giorniDa, hmac, leggiImpostazioni, oraRoma, sha256, spostaData, uguali } from "./util.js";

export const CANALI = ["email", "sms", "whatsapp"];
export const TIPI = ["conferma", "recensione", "premio", "ordine", "gift"];

/** Token per i link personali (prenotazione, sondaggio, ordine, buono): si ricava dall'id, non va salvato. */
export async function tokenPer(env, prefisso, id) {
  return base64url(await hmac(env.SESSION_SECRET ?? "demo", `${prefisso}:${id}`)).slice(0, 32);
}

export async function tokenPerValido(env, prefisso, id, token) {
  return Boolean(token) && uguali(token, await tokenPer(env, prefisso, id));
}

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
  return linkPubblico(env, "/prenotazione", { origine, frammento: `id=${id}&t=${await tokenPrenotazione(env, id)}${l}` });
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
    whatsapp_modelli: Object.fromEntries(Object.entries(MODELLI_WHATSAPP).map(([tipo, chiave]) => [tipo, whatsappBase(env) && Boolean(env[chiave])])),
  };
}

/** Secret con il nome del modello WhatsApp approvato per ogni tipo di messaggio. */
export const MODELLI_WHATSAPP = {
  conferma: "WHATSAPP_MODELLO_CONFERMA",
  recensione: "WHATSAPP_MODELLO_RECENSIONE",
  sondaggio: "WHATSAPP_MODELLO_SONDAGGIO",
  premio: "WHATSAPP_MODELLO_PREMIO",
  ordine: "WHATSAPP_MODELLO_ORDINE",
  gift: "WHATSAPP_MODELLO_GIFT",
};

/** Ordine dei parametri {{1}}, {{2}}, ... di ogni modello WhatsApp. */
export const PARAMETRI_WHATSAPP = {
  conferma: ["nome", "ristorante", "persone", "data", "ora", "codice", "link"],
  recensione: ["nome", "ristorante", "recensione"],
  sondaggio: ["nome", "ristorante", "sondaggio"],
  premio: ["nome", "soglia", "ristorante", "premio", "codice", "scadenza", "link"],
  ordine: ["nome", "codice", "ristorante", "tipo", "data", "ora", "totale", "link"],
  gift: ["destinatario", "mittente", "importo", "ristorante", "codice", "scadenza", "link"],
};

export function formatoEuro(lingua, centesimi) {
  return new Intl.NumberFormat(LOCALI[linguaValida(lingua)], { style: "currency", currency: "EUR" }).format(centesimi / 100);
}

/** Testo di un modello di messaggio nella lingua del cliente, con i valori sostituiti. */
export function testoModello(imp, chiave, lingua, valori) {
  return sostituisci(modelloIn(imp, chiave, lingua), valori);
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
    sondaggio: extra.sondaggio ?? "",
  };
}

const sostituisci = (modello, valori) => modello.replace(/\{(\w+)\}/g, (tutto, k) => (k in valori ? valori[k] : tutto));

/** Testo pronto del messaggio, nella lingua della prenotazione. */
export function componiMessaggio(tipo, imp, p, extra = {}) {
  const chiave = { recensione: "messaggio_recensione", sondaggio: "messaggio_sondaggio" }[tipo] ?? "messaggio_conferma";
  return sostituisci(modelloIn(imp, chiave, p.lingua), valoriMessaggio(imp, p, extra));
}

/** Codice lingua del modello WhatsApp: quello approvato per la lingua del cliente, altrimenti il primo dell'elenco. */
export function linguaWhatsApp(env, lingua) {
  const approvate = String(env.WHATSAPP_LINGUE ?? "it")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return approvate.find((l) => l.slice(0, 2).toLowerCase() === lingua) ?? approvate[0] ?? "it";
}

export async function inviaEmail(env, destinatario, oggetto, testo) {
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
      `INSERT OR IGNORE INTO whatsapp_messaggi (id, direzione, numero, testo, stato, prenotazione_id, creato_il, aggiornato_il, ristorante_id)
       VALUES (?, 'out', ?, ?, 'accettato', ?, ?, ?, ?)`,
    )
      .bind(id, numero, testo.slice(0, 1000), prenotazioneId, adesso, adesso, env.RID)
      .run();
  }
}

async function registra(env, id, canale, esito, dettaglio = "", tipo = "conferma") {
  await env.DB.prepare("INSERT INTO notifiche (prenotazione_id, canale, esito, dettaglio, creata_il, tipo, ristorante_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, canale, esito, dettaglio.slice(0, 300), new Date().toISOString(), tipo, env.RID)
    .run();
}

/**
 * Consegna un messaggio sul canale scelto dal cliente, poi prova gli altri canali automatici.
 * Chi preferisce WhatsApp non riceve SMS a pagamento al suo posto; se WhatsApp non è
 * automatico il messaggio resta da inviare con un clic dal pannello.
 * I messaggi che non sono una conferma (dopo la visita, premi, buoni) non usano l'SMS se il cliente non l'ha scelto.
 * `rif` è l'id dell'oggetto a cui si riferisce (prenotazione, ordine, premio, gift card).
 */
export async function consegna(env, imp, { rif, tipo, registro = tipo, canale, telefono, email, lingua = "it", valori, testo }) {
  const attivi = canaliAttivi(env);
  const numero = numeroInternazionale(telefono);
  const possibili = {
    whatsapp: attivi.whatsapp_modelli[tipo] && numero,
    email: attivi.email && email,
    sms: attivi.sms && numero,
  };
  let ordine;
  if (canale === "whatsapp") ordine = possibili.whatsapp ? ["whatsapp", "email"] : [];
  else ordine = [canale, "email", "sms"];
  if (!["conferma", "ordine"].includes(tipo)) ordine = ordine.filter((c) => c !== "sms" || canale === "sms");
  ordine = ordine.filter((c, i, a) => a.indexOf(c) === i && possibili[c]);

  for (const c of ordine) {
    try {
      if (c === "email") await inviaEmail(env, email, oggettoEmail(tipo, lingua, imp.nome), testo);
      else if (c === "sms") await inviaSms(env, numero, testo);
      else {
        await inviaWhatsApp(env, {
          numero,
          modello: env[MODELLI_WHATSAPP[tipo]],
          lingua,
          parametri: PARAMETRI_WHATSAPP[tipo].map((k) => valori[k] ?? ""),
          testo,
          prenotazioneId: rif,
        });
      }
      await registra(env, rif, c, "inviata", c === "email" ? email : numero, registro);
      return true;
    } catch (e) {
      await registra(env, rif, c, "errore", e.message, registro);
    }
  }
  await registra(env, rif, canale, "da_inviare", ordine.length ? "Invio automatico non riuscito" : "Invio automatico non configurato per questo canale", registro);
  return false;
}

async function invia(env, imp, p, tipo, extra, registro = tipo) {
  return consegna(env, imp, {
    rif: p.id,
    tipo,
    registro,
    canale: p.canale,
    telefono: p.telefono,
    email: p.email,
    lingua: p.lingua ?? "it",
    valori: valoriMessaggio(imp, p, extra),
    testo: componiMessaggio(tipo, imp, p, extra),
  });
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

/** Indirizzo pubblico del sito, per i link nei messaggi che partono dal Cron Trigger. */
export function origineSito(env, imp) {
  if (env.DOMINIO_BASE && env.SLUG) return `https://${env.SLUG}.${env.DOMINIO_BASE}`;
  return env.SITO_URL?.replace(/\/$/, "") || imp.url_sito || null;
}

/**
 * Messaggio dopo la visita: il sondaggio se attivo, altrimenti la richiesta di recensione.
 * Al termine del sondaggio il link per la recensione compare a tutti, qualunque voto abbiano dato.
 */
export async function messaggioDopoVisita(env, imp, p, origine) {
  if (imp.sondaggio_attivo && origine) {
    const l = p.lingua && p.lingua !== "it" ? `&l=${p.lingua}` : "";
    const sondaggio = linkPubblico(env, "/sondaggio", { origine, frammento: `id=${p.id}&t=${await tokenPer(env, "sondaggio", p.id)}${l}` });
    return { tipo: "sondaggio", extra: { sondaggio }, testo: componiMessaggio("sondaggio", imp, p, { sondaggio }) };
  }
  if (imp.link_recensioni) return { tipo: "recensione", extra: {}, testo: componiMessaggio("recensione", imp, p) };
  return null;
}

/**
 * Manda il messaggio dopo la visita ai clienti arrivati, qualche ora dopo la fine del pasto e una sola volta.
 * Gira ogni 15 minuti (Cron Trigger) e quando il gestore apre l'agenda.
 * Tutti ricevono lo stesso link: Google vieta di filtrare chi è invitato a recensire.
 */
export async function elaboraRecensioni(env, origineRichiesta = null) {
  try {
    const imp = await leggiImpostazioni(env);
    const origine = origineRichiesta ?? origineSito(env, imp);
    if (!imp.recensioni_automatiche || !(imp.link_recensioni || (imp.sondaggio_attivo && origine))) return 0;
    const adesso = oraRoma();
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.codice, p.data, p.ora, p.inizio_min, p.durata, p.persone, p.nome, p.telefono, p.email, p.canale, p.lingua
       FROM prenotazioni_v2 p
       WHERE p.ristorante_id = ? AND p.stato = 'arrivata' AND p.data BETWEEN ? AND ? AND (p.telefono <> '' OR p.email <> '')
         AND NOT EXISTS (SELECT 1 FROM notifiche n WHERE n.prenotazione_id = p.id AND n.tipo = 'recensione')
       ORDER BY p.data, p.inizio_min LIMIT 25`,
    )
      .bind(env.RID, spostaData(adesso.data, -2), adesso.data)
      .all();
    let inviate = 0;
    for (const p of results) {
      const trascorsi = giorniDa(p.data, adesso.data) * 1440 + adesso.minuti - (p.inizio_min + p.durata);
      if (trascorsi < imp.recensione_dopo_ore * 60) continue;
      // Prenota l'invio in un'unica istruzione: due esecuzioni contemporanee non mandano due messaggi.
      const presa = await env.DB.prepare(
        `INSERT INTO notifiche (prenotazione_id, canale, esito, dettaglio, creata_il, tipo, ristorante_id)
         SELECT ?1, ?2, 'da_inviare', 'In preparazione', ?3, 'recensione', ?4
         WHERE NOT EXISTS (SELECT 1 FROM notifiche WHERE prenotazione_id = ?1 AND tipo = 'recensione')`,
      )
        .bind(p.id, p.canale, new Date().toISOString(), env.RID)
        .run();
      if (!presa.meta.changes) continue;
      const m = await messaggioDopoVisita(env, imp, p, origine);
      if (m && (await invia(env, imp, p, m.tipo, m.extra, "recensione"))) inviate += 1;
    }
    return inviate;
  } catch (e) {
    console.error("Messaggi dopo la visita non elaborati", e);
    return 0;
  }
}

export async function registraInvioManuale(env, id, canale, tipo = "conferma") {
  await registra(env, id, canale, "manuale", "Inviato dal gestore", tipo);
}
