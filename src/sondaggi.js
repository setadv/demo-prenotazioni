import { erroreIn, linguaRichiesta } from "./lingue.js";
import { tokenPerValido } from "./notifiche.js";
import { ErroreRichiesta, intero, json, leggiImpostazioni, leggiJson, oraRoma, spostaData } from "./util.js";

const VOTI = ["voto_cibo", "voto_servizio", "voto_ambiente", "voto_prezzo"];

async function prenotazioneSondaggio(request, env, id, lingua) {
  const token = request.headers.get("x-sondaggio-token") ?? "";
  if (!(await tokenPerValido(env, "sondaggio", id, token))) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
  const p = await env.DB.prepare("SELECT id, data, nome, cliente_id, stato FROM prenotazioni_v2 WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  if (!p) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
  return p;
}

export async function leggiSondaggio(request, env, id) {
  const lingua = linguaRichiesta(request);
  const p = await prenotazioneSondaggio(request, env, id, lingua);
  const imp = await leggiImpostazioni(env);
  const fatto = await env.DB.prepare("SELECT 1 FROM sondaggi WHERE prenotazione_id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  return json({
    ristorante: imp.nome,
    nome: p.nome.split(" ")[0],
    data: p.data,
    compilato: Boolean(fatto),
    link_recensioni: imp.link_recensioni || null,
  });
}

/** Risposta del cliente: una sola per visita. Il link per la recensione torna a tutti, qualunque sia il voto. */
export async function rispondiSondaggio(request, env, id) {
  const corpo = await leggiJson(request);
  const lingua = linguaRichiesta(request, null, corpo);
  const p = await prenotazioneSondaggio(request, env, id, lingua);
  const voti = VOTI.map((k) => {
    const n = Number(corpo[k]);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ErroreRichiesta(erroreIn(lingua, "voto"));
    return n;
  });
  const consiglio = corpo.consiglio === null || corpo.consiglio === undefined || corpo.consiglio === "" ? null : Number(corpo.consiglio);
  if (consiglio !== null && (!Number.isInteger(consiglio) || consiglio < 0 || consiglio > 10)) throw new ErroreRichiesta(erroreIn(lingua, "voto"));
  const commento = typeof corpo.commento === "string" ? corpo.commento.trim() : "";
  if (commento.length > 1000) throw new ErroreRichiesta(erroreIn(lingua, "lungo"));
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO sondaggi (prenotazione_id, cliente_id, voto_cibo, voto_servizio, voto_ambiente, voto_prezzo, consiglio, commento, lingua, creato_il, ristorante_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, p.cliente_id, ...voti, consiglio, commento, lingua, new Date().toISOString(), env.RID)
    .run();
  if (!r.meta.changes) throw new ErroreRichiesta(erroreIn(lingua, "sondaggio_fatto"), 409);
  const imp = await leggiImpostazioni(env);
  return json({ ok: true, link_recensioni: imp.link_recensioni || null }, 201);
}

/** Risultati per il pannello: medie, NPS, risposte con commento e chi ha dato voti bassi. */
export async function risultatiSondaggi(url, env) {
  const giorni = intero(url.searchParams.get("giorni") ?? "90", 7, 365, "Periodo");
  const da = `${spostaData(oraRoma().data, -(giorni - 1))}T00:00:00`;
  const [medie, risposte] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS risposte, AVG(voto_cibo) AS cibo, AVG(voto_servizio) AS servizio, AVG(voto_ambiente) AS ambiente, AVG(voto_prezzo) AS prezzo,
         SUM(consiglio IS NOT NULL) AS con_consiglio, SUM(consiglio >= 9) AS promotori, SUM(consiglio <= 6) AS detrattori
       FROM sondaggi WHERE ristorante_id = ? AND creato_il >= ?`,
    ).bind(env.RID, da),
    env.DB.prepare(
      `SELECT s.prenotazione_id, s.voto_cibo, s.voto_servizio, s.voto_ambiente, s.voto_prezzo, s.consiglio, s.commento, s.lingua, s.creato_il, s.gestito,
         p.data, p.nome, p.telefono, p.email, p.cliente_id
       FROM sondaggi s JOIN prenotazioni_v2 p ON p.id = s.prenotazione_id
       WHERE s.ristorante_id = ? AND s.creato_il >= ? ORDER BY s.creato_il DESC LIMIT 200`,
    ).bind(env.RID, da),
  ]);
  const m = medie.results[0];
  const nps = m.con_consiglio ? Math.round(((m.promotori - m.detrattori) / m.con_consiglio) * 100) : null;
  const elenco = risposte.results.map((r) => ({
    ...r,
    // Da richiamare: un voto 1-2 o un consiglio fino a 6.
    critico: Math.min(r.voto_cibo, r.voto_servizio, r.voto_ambiente, r.voto_prezzo) <= 2 || (r.consiglio !== null && r.consiglio <= 6),
  }));
  return json({ giorni, risposte: m.risposte, medie: { cibo: m.cibo, servizio: m.servizio, ambiente: m.ambiente, prezzo: m.prezzo }, nps, elenco });
}

export async function segnaSondaggio(request, env, id) {
  const corpo = await leggiJson(request);
  const r = await env.DB.prepare("UPDATE sondaggi SET gestito = ? WHERE prenotazione_id = ? AND ristorante_id = ?").bind(corpo.gestito ? 1 : 0, id, env.RID).run();
  if (!r.meta.changes) throw new ErroreRichiesta("Risposta non trovata.", 404);
  return json({ ok: true });
}
