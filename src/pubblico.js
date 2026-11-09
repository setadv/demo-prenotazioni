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
  sha256,
  spostaData,
  testo,
  tokenCasuale,
  uguali,
} from "./util.js";

export async function infoRistorante(env) {
  const imp = await leggiImpostazioni(env);
  const oggi = oraRoma().data;
  const [orari, chiusure] = await env.DB.batch([
    env.DB.prepare("SELECT giorno, servizio, inizio, fine FROM orari ORDER BY giorno, inizio"),
    env.DB.prepare("SELECT data FROM chiusure WHERE data BETWEEN ? AND ?").bind(oggi, spostaData(oggi, imp.giorni_prenotabili)),
  ]);
  return json({
    nome: imp.nome,
    indirizzo: imp.indirizzo,
    telefono: imp.telefono,
    descrizione: imp.descrizione,
    prezzo_medio: imp.prezzo_medio,
    max_persone_online: imp.max_persone_online,
    giorni_prenotabili: imp.giorni_prenotabili,
    orari: orari.results,
    chiusure: chiusure.results.map((c) => c.data),
    oggi,
  });
}

export async function disponibilita(url, env) {
  const imp = await leggiImpostazioni(env);
  const persone = intero(url.searchParams.get("persone") ?? "2", 1, imp.max_persone_online, "Persone");
  return json(await calcolaDisponibilita(env, url.searchParams.get("data"), persone, imp));
}

export async function nuovaPrenotazione(request, env) {
  const corpo = await leggiJson(request);
  if (corpo.sito) return json({ id: crypto.randomUUID(), codice: codiceCasuale(), token: tokenCasuale(), stato: "in_attesa" }, 201);

  const imp = await leggiImpostazioni(env);
  const persone = Number(corpo.persone);
  if (!Number.isInteger(persone) || persone < 1) throw new ErroreRichiesta("Indica il numero di persone.");
  if (persone > imp.max_persone_online) {
    throw new ErroreRichiesta(`Per gruppi di più di ${imp.max_persone_online} persone chiama il ristorante.`);
  }
  const nome = testo(corpo.nome, 80, { min: 2, campo: "Il nome" });
  const telefono = testo(corpo.telefono, 30, { min: 1, campo: "Il telefono" });
  if (!normalizzaTelefono(telefono)) throw new ErroreRichiesta("Scrivi un numero di telefono valido.");
  const email = testo(corpo.email, 254, { campo: "L'email" });
  if (email && !emailValida(email)) throw new ErroreRichiesta("Scrivi un'email valida o lascia il campo vuoto.");
  const occasione = OCCASIONI.includes(corpo.occasione ?? "") ? corpo.occasione ?? "" : "";
  const note = testo(corpo.note, 300, { campo: "Le note" });
  if (corpo.privacy !== true) throw new ErroreRichiesta("Per prenotare devi accettare l'uso dei dati.");
  if (!oraValida(corpo.ora)) throw new ErroreRichiesta("Scegli un orario.");

  const disp = await calcolaDisponibilita(env, corpo.data, persone, imp);
  const slot = disp.slot.find((s) => s.ora === corpo.ora);
  if (!slot || !slot.disponibile) throw new ErroreRichiesta("Questo orario non è più disponibile. Scegline un altro.", 409);

  const chiave = `prenota:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 10, 60)) {
    throw new ErroreRichiesta("Troppe prenotazioni in poco tempo. Riprova tra un'ora.", 429);
  }

  const { tavoli } = await caricaGiorno(env, corpo.data);
  const tavoliIds = candidati(tavoli, persone, true).map((t) => t.id);
  const token = tokenCasuale();
  const riga = {
    id: crypto.randomUUID(),
    codice: codiceCasuale(),
    token_hash: await sha256(token),
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
    cliente_id: await trovaOCreaCliente(env, { nome, telefono, email }),
    sconto: slot.sconto,
  };
  const tavolo = await inserisciPrenotazione(env, riga, tavoliIds);
  if (tavolo === false) throw new ErroreRichiesta("Questo orario non è più disponibile. Scegline un altro.", 409);

  await registraTentativo(env, chiave);
  return json({ id: riga.id, codice: riga.codice, token, stato: riga.stato, sconto: riga.sconto }, 201);
}

async function prenotazioneConToken(request, env, id) {
  const token = request.headers.get("x-prenotazione-token") ?? "";
  const p = await env.DB.prepare(
    `SELECT id, codice, token_hash, data, ora, inizio_min, persone, nome, occasione, note, stato, sconto
     FROM prenotazioni_v2 WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!p || !p.token_hash || !token || !uguali(await sha256(token), p.token_hash)) {
    throw new ErroreRichiesta("Prenotazione non trovata. Controlla il link ricevuto.", 404);
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
  return json({
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
    ristorante: { nome: imp.nome, indirizzo: imp.indirizzo, telefono: imp.telefono },
  });
}

export async function annullaPrenotazione(request, env, id) {
  const p = await prenotazioneConToken(request, env, id);
  if (!annullabile(p)) throw new ErroreRichiesta("Questa prenotazione non si può più annullare online. Chiama il ristorante.", 409);
  await env.DB.prepare("UPDATE prenotazioni_v2 SET stato = 'annullata', aggiornata_il = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
  return json({ ok: true, stato: "annullata" });
}

export { scontoPer, slotDelGiorno, giornoSettimana, errore };
