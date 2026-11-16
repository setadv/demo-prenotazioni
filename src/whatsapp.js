import { canaliAttivi } from "./notifiche.js";
import { hmac, json, uguali } from "./util.js";

const esadecimale = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Verifica dell'URL del webhook, richiesta da Meta quando lo registri nell'app. */
export function verificaWebhook(url, env) {
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const sfida = url.searchParams.get("hub.challenge") ?? "";
  if (modo === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && uguali(token, env.WHATSAPP_VERIFY_TOKEN) && /^[\w-]{1,200}$/.test(sfida)) {
    return new Response(sfida, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response("Non autorizzato", { status: 403 });
}

/**
 * Riceve da Meta i messaggi dei clienti e gli stati di consegna dei messaggi inviati.
 * Accetta solo richieste firmate con l'App Secret (header X-Hub-Signature-256).
 */
export async function riceviWebhook(request, env) {
  if (!env.WHATSAPP_APP_SECRET) return new Response("Webhook non configurato", { status: 503 });
  const corpo = await request.text();
  if (corpo.length > 512 * 1024) return new Response("Troppo grande", { status: 413 });
  const firma = request.headers.get("x-hub-signature-256") ?? "";
  const attesa = `sha256=${esadecimale(await hmac(env.WHATSAPP_APP_SECRET, corpo))}`;
  if (!uguali(firma, attesa)) return new Response("Firma non valida", { status: 401 });

  let dati;
  try {
    dati = JSON.parse(corpo);
  } catch {
    return new Response("JSON non valido", { status: 400 });
  }
  const adesso = new Date().toISOString();
  const istruzioni = [];
  for (const voce of dati.entry ?? []) {
    for (const cambio of voce.changes ?? []) {
      const v = cambio.value ?? {};
      const nomi = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? ""]));
      for (const m of v.messages ?? []) {
        if (typeof m.id !== "string" || typeof m.from !== "string") continue;
        const testo = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type ?? "messaggio"}]`;
        const quando = /^\d+$/.test(m.timestamp ?? "") ? new Date(Number(m.timestamp) * 1000).toISOString() : adesso;
        istruzioni.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO whatsapp_messaggi (id, direzione, numero, nome, testo, stato, creato_il, aggiornato_il)
             VALUES (?, 'in', ?, ?, ?, 'ricevuto', ?, ?)`,
          ).bind(m.id.slice(0, 200), `+${m.from.replace(/\D/g, "")}`, String(nomi.get(m.from) ?? "").slice(0, 80), String(testo).slice(0, 1000), quando, adesso),
        );
      }
      for (const s of v.statuses ?? []) {
        if (typeof s.id !== "string" || typeof s.status !== "string") continue;
        const errore = s.errors?.[0]?.title ? `: ${s.errors[0].title}` : "";
        istruzioni.push(
          env.DB.prepare("UPDATE whatsapp_messaggi SET stato = ?, aggiornato_il = ? WHERE id = ? AND direzione = 'out'").bind(
            `${s.status}${errore}`.slice(0, 120),
            adesso,
            s.id.slice(0, 200),
          ),
        );
      }
    }
  }
  if (istruzioni.length) await env.DB.batch(istruzioni.slice(0, 200));
  return new Response("ok");
}

/** Stato della configurazione e ultimi messaggi, per la sezione WhatsApp del pannello. */
export async function statoWhatsApp(url, env) {
  const attivi = canaliAttivi(env);
  const [ricevuti, inviati] = await env.DB.batch([
    env.DB.prepare(
      `SELECT w.numero, w.nome, w.testo, w.creato_il, c.nome AS cliente
       FROM whatsapp_messaggi w
       LEFT JOIN clienti c ON c.tel_norm = substr(w.numero, CASE WHEN w.numero LIKE '+39%' THEN 4 ELSE 2 END)
       WHERE w.direzione = 'in' ORDER BY w.creato_il DESC LIMIT 30`,
    ),
    env.DB.prepare(
      `SELECT w.numero, w.stato, w.creato_il, w.aggiornato_il, p.nome AS cliente
       FROM whatsapp_messaggi w LEFT JOIN prenotazioni_v2 p ON p.id = w.prenotazione_id
       WHERE w.direzione = 'out' ORDER BY w.creato_il DESC LIMIT 30`,
    ),
  ]);
  return json({
    configurazione: {
      token: Boolean(env.WHATSAPP_TOKEN),
      numero: Boolean(env.WHATSAPP_PHONE_ID),
      modello_conferma: env.WHATSAPP_MODELLO_CONFERMA ?? null,
      modello_recensione: env.WHATSAPP_MODELLO_RECENSIONE ?? null,
      lingue: String(env.WHATSAPP_LINGUE ?? "it"),
      webhook: Boolean(env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET),
      conferme_automatiche: attivi.whatsapp,
      recensioni_automatiche: attivi.whatsapp_recensione,
    },
    webhook_url: `${url.origin}/api/whatsapp/webhook`,
    ricevuti: ricevuti.results,
    inviati: inviati.results,
  });
}
