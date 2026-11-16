import { CANALI, inviaConferma, tokenPrenotazione, tokenValido } from "./notifiche.js";
import { ALTRE_LINGUE, LINGUE, erroreIn, linguaRichiesta, modelloIn } from "./lingue.js";
import {
  calcolaDisponibilita,
  candidati,
  caricaGiorno,
  inserisciPrenotazione,
  slotDelGiorno,
  scontoPer,
  trovaOCreaCliente,
} from "./disponibilita.js";
import {
  ErroreRichiesta,
  OCCASIONI,
  STATI_ATTIVI,
  aMinuti,
  codiceCasuale,
  emailValida,
  errore,
  giornoSettimana,
  impronta,
  intero,
  json,
  leggiImpostazioni,
  leggiJson,
  limiteSuperato,
  normalizzaTelefono,
  oraRoma,
  oraValida,
  registraTentativo,
  spostaData,
  testo,
  tokenCasuale,
} from "./util.js";

export async function infoRistorante(env) {
  const imp = await leggiImpostazioni(env);
  const oggi = oraRoma().data;
  const [orari, chiusure, media] = await env.DB.batch([
    env.DB.prepare("SELECT giorno, servizio, inizio, fine FROM orari WHERE ristorante_id = ? ORDER BY giorno, inizio").bind(env.RID),
    env.DB.prepare("SELECT data FROM chiusure_r WHERE ristorante_id = ? AND data BETWEEN ? AND ?").bind(env.RID, oggi, spostaData(oggi, imp.giorni_prenotabili)),
    env.DB.prepare("SELECT chiave, aggiornato_il FROM media_r WHERE ristorante_id = ?").bind(env.RID),
  ]);
  const versione = (k) => media.results.find((m) => m.chiave === k)?.aggiornato_il ?? null;
  return json({
    nome: imp.nome,
    indirizzo: imp.indirizzo,
    telefono: imp.telefono,
    descrizione: imp.descrizione,
    descrizioni: Object.fromEntries([["it", imp.descrizione], ...ALTRE_LINGUE.map((l) => [l, imp[`descrizione_${l}`] || imp.descrizione])]),
    prezzo_medio: imp.prezzo_medio,
    max_persone_online: imp.max_persone_online,
    giorni_prenotabili: imp.giorni_prenotabili,
    orari: orari.results,
    chiusure: chiusure.results.map((c) => c.data),
    logo: versione("logo"),
    foto: versione("foto"),
    moduli: {
      fidelity: imp.fidelity_attiva ? { punti_visita: imp.punti_visita, soglia: imp.premio_soglia, premio: Object.fromEntries(LINGUE.map((l) => [l, modelloIn(imp, "premio_descrizione", l)])) } : null,
      gift: Boolean(imp.gift_attive),
      ordini: Boolean(imp.ordini_attivi && (imp.asporto_attivo || imp.consegna_attiva)),
    },
    oggi,
  });
}

export async function disponibilita(request, url, env) {
  const lingua = linguaRichiesta(request, url);
  const imp = await leggiImpostazioni(env);
  const persone = Number(url.searchParams.get("persone") ?? "2");
  if (!Number.isInteger(persone) || persone < 1 || persone > imp.max_persone_online) {
    throw new ErroreRichiesta(erroreIn(lingua, "persone_range", { max: imp.max_persone_online }));
  }
  return json(await calcolaDisponibilita(env, url.searchParams.get("data"), persone, imp, lingua));
}

/** Testo libero del cliente: obbligatorio o facoltativo, con messaggi nella sua lingua. */
function campo(valore, max, lingua, chiaveVuoto = null, min = 1) {
  const t = typeof valore === "string" ? valore.trim() : valore == null ? "" : String(valore).trim();
  if (chiaveVuoto && t.length < min) throw new ErroreRichiesta(erroreIn(lingua, chiaveVuoto));
  if (t.length > max) throw new ErroreRichiesta(erroreIn(lingua, "lungo"));
  return t;
}

export async function nuovaPrenotazione(request, env, ctx) {
  const corpo = await leggiJson(request);
  if (corpo.sito) return json({ id: crypto.randomUUID(), codice: codiceCasuale(), token: tokenCasuale(), stato: "in_attesa" }, 201);

  const lingua = linguaRichiesta(request, null, corpo);
  const imp = await leggiImpostazioni(env);
  const persone = Number(corpo.persone);
  if (!Number.isInteger(persone) || persone < 1) throw new ErroreRichiesta(erroreIn(lingua, "persone"));
  if (persone > imp.max_persone_online) throw new ErroreRichiesta(erroreIn(lingua, "gruppo", { max: imp.max_persone_online }));
  const nome = campo(corpo.nome, 80, lingua, "nome", 2);
  const telefono = campo(corpo.telefono, 30, lingua, "telefono");
  if (!normalizzaTelefono(telefono)) throw new ErroreRichiesta(erroreIn(lingua, "telefono"));
  const email = campo(corpo.email, 254, lingua);
  if (email && !emailValida(email)) throw new ErroreRichiesta(erroreIn(lingua, "email"));
  const occasione = OCCASIONI.includes(corpo.occasione ?? "") ? corpo.occasione ?? "" : "";
  const canale = CANALI.includes(corpo.canale) ? corpo.canale : email ? "email" : "sms";
  if (canale === "email" && !email) throw new ErroreRichiesta(erroreIn(lingua, "email_canale"));
  const note = campo(corpo.note, 300, lingua);
  if (corpo.privacy !== true) throw new ErroreRichiesta(erroreIn(lingua, "privacy"));
  if (!oraValida(corpo.ora)) throw new ErroreRichiesta(erroreIn(lingua, "orario"));

  const disp = await calcolaDisponibilita(env, corpo.data, persone, imp, lingua);
  const slot = disp.slot.find((s) => s.ora === corpo.ora);
  if (!slot || !slot.disponibile) throw new ErroreRichiesta(erroreIn(lingua, "occupato"), 409);

  const chiave = `prenota:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 10, 60)) throw new ErroreRichiesta(erroreIn(lingua, "limite"), 429);

  const { tavoli } = await caricaGiorno(env, corpo.data);
  const tavoliIds = candidati(tavoli, persone, true).map((t) => t.id);
  const id = crypto.randomUUID();
  const token = await tokenPrenotazione(env, id);
  const riga = {
    id,
    codice: codiceCasuale(),
    token_hash: null,
    data: corpo.data,
    ora: corpo.ora,
    inizio_min: aMinuti(corpo.ora),
    durata: imp.durata,
    persone,
    nome,
    telefono,
    email,
    occasione,
    note,
    stato: imp.conferma_automatica ? "confermata" : "in_attesa",
    origine: "online",
    cliente_id: await trovaOCreaCliente(env, { nome, telefono, email, lingua, marketing: corpo.marketing === true, fidelity: corpo.fidelity === true && Boolean(imp.fidelity_attiva) }),
    sconto: slot.sconto,
    canale,
    lingua,
  };
  const tavolo = await inserisciPrenotazione(env, riga, tavoliIds);
  if (tavolo === false) throw new ErroreRichiesta(erroreIn(lingua, "occupato"), 409);

  await registraTentativo(env, chiave);
  if (riga.stato === "confermata") ctx.waitUntil(inviaConferma(env, imp, riga, new URL(request.url).origin));
  return json({ id: riga.id, codice: riga.codice, token, stato: riga.stato, sconto: riga.sconto, canale }, 201);
}

async function prenotazioneConToken(request, env, id) {
  const token = request.headers.get("x-prenotazione-token") ?? "";
  const p = await env.DB.prepare(
    `SELECT id, codice, token_hash, data, ora, inizio_min, persone, nome, occasione, note, stato, sconto, lingua, cliente_id
     FROM prenotazioni_v2 WHERE id = ? AND ristorante_id = ?`,
  )
    .bind(id, env.RID)
    .first();
  if (!p || !(await tokenValido(env, p.id, token, p.token_hash))) {
    throw new ErroreRichiesta(erroreIn(linguaRichiesta(request), "non_trovata"), 404);
  }
  return p;
}

function annullabile(p) {
  const adesso = oraRoma();
  const futura = p.data > adesso.data || (p.data === adesso.data && p.inizio_min > adesso.minuti);
  return STATI_ATTIVI.includes(p.stato) && p.stato !== "arrivata" && futura;
}

export async function leggiPrenotazione(request, env, id) {
  const p = await prenotazioneConToken(request, env, id);
  const imp = await leggiImpostazioni(env);
  let fidelity = null;
  if (imp.fidelity_attiva && p.cliente_id) {
    const c = await env.DB.prepare(
      "SELECT c.fidelity, (SELECT COALESCE(SUM(punti), 0) FROM punti_movimenti WHERE cliente_id = c.id) AS saldo FROM clienti c WHERE c.id = ? AND c.ristorante_id = ?",
    )
      .bind(p.cliente_id, env.RID)
      .first();
    if (c?.fidelity) fidelity = { saldo: c.saldo, soglia: imp.premio_soglia };
  }
  return json({
    fidelity,
    codice: p.codice,
    data: p.data,
    ora: p.ora,
    persone: p.persone,
    nome: p.nome,
    occasione: p.occasione,
    note: p.note,
    stato: p.stato,
    sconto: p.sconto,
    annullabile: annullabile(p),
    lingua: p.lingua,
    ristorante: { nome: imp.nome, indirizzo: imp.indirizzo, telefono: imp.telefono },
  });
}

export async function annullaPrenotazione(request, env, id) {
  const p = await prenotazioneConToken(request, env, id);
  if (!annullabile(p)) throw new ErroreRichiesta(erroreIn(linguaRichiesta(request), "non_annullabile"), 409);
  await env.DB.prepare("UPDATE prenotazioni_v2 SET stato = 'annullata', aggiornata_il = ? WHERE id = ? AND ristorante_id = ?")
    .bind(new Date().toISOString(), id, env.RID)
    .run();
  return json({ ok: true, stato: "annullata" });
}

export { scontoPer, slotDelGiorno, giornoSettimana, errore };
