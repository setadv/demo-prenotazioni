import {
  ErroreRichiesta,
  SQL_ATTIVI,
  STATI_ATTIVI,
  aMinuti,
  codiceCasuale,
  daMinuti,
  dataValida,
  giornoSettimana,
  giorniDa,
  normalizzaTelefono,
  oraRoma,
} from "./util.js";

export async function caricaGiorno(env, data) {
  const [tavoli, prenotazioni] = await env.DB.batch([
    env.DB.prepare(
      `SELECT t.id, t.sala_id, t.nome, t.posti_min, t.posti_max, t.online
       FROM tavoli t JOIN sale s ON s.id = t.sala_id
       WHERE t.attivo = 1 AND s.attiva = 1
       ORDER BY t.posti_max, t.posti_min DESC, t.nome`,
    ),
    env.DB.prepare(
      `SELECT id, tavolo_id, inizio_min, durata FROM prenotazioni_v2
       WHERE data = ? AND stato IN ${SQL_ATTIVI} AND tavolo_id IS NOT NULL`,
    ).bind(data),
  ]);
  return { tavoli: tavoli.results, prenotazioni: prenotazioni.results };
}

export function tavoloLibero(tavoloId, inizio, fine, prenotazioni, escludiId = null) {
  return !prenotazioni.some(
    (p) => p.tavolo_id === tavoloId && p.id !== escludiId && p.inizio_min < fine && inizio < p.inizio_min + p.durata,
  );
}

export function candidati(tavoli, persone, soloOnline) {
  return tavoli.filter((t) => (!soloOnline || t.online) && t.posti_min <= persone && persone <= t.posti_max);
}

export function slotDelGiorno(orari, intervallo) {
  const visti = new Map();
  for (const o of orari) {
    for (let m = aMinuti(o.inizio); m <= aMinuti(o.fine); m += intervallo) {
      if (!visti.has(m)) visti.set(m, { ora: daMinuti(m), minuti: m, servizio: o.servizio });
    }
  }
  return [...visti.values()].sort((a, b) => a.minuti - b.minuti);
}

export function scontoPer(promozioni, giorno, minuti) {
  let migliore = 0;
  for (const p of promozioni) {
    if (!p.attiva) continue;
    if (!p.giorni.split(",").map(Number).includes(giorno)) continue;
    if (minuti < aMinuti(p.ora_da) || minuti > aMinuti(p.ora_a)) continue;
    migliore = Math.max(migliore, p.sconto);
  }
  return migliore;
}

export async function calcolaDisponibilita(env, data, persone, imp) {
  if (!dataValida(data)) throw new ErroreRichiesta("Scegli una data valida.");
  const adesso = oraRoma();
  const distanza = giorniDa(adesso.data, data);
  const giorno = giornoSettimana(data);

  const [chiusura, orari, promozioni] = await env.DB.batch([
    env.DB.prepare("SELECT motivo FROM chiusure WHERE data = ?").bind(data),
    env.DB.prepare("SELECT servizio, inizio, fine FROM orari WHERE giorno = ? ORDER BY inizio").bind(giorno),
    env.DB.prepare("SELECT giorni, ora_da, ora_a, sconto, attiva FROM promozioni"),
  ]);
  if (chiusura.results.length) {
    return { chiuso: true, motivo: chiusura.results[0].motivo || "Il ristorante è chiuso in questa data.", slot: [] };
  }

  const { tavoli, prenotazioni } = await caricaGiorno(env, data);
  const adatti = candidati(tavoli, persone, true);
  const fuoriFinestra = distanza < 0 || distanza > imp.giorni_prenotabili;

  const slot = slotDelGiorno(orari.results, imp.intervallo).map((s) => {
    const passato = fuoriFinestra || (distanza === 0 && s.minuti < adesso.minuti + imp.anticipo);
    const libero = adatti.some((t) => tavoloLibero(t.id, s.minuti, s.minuti + imp.durata, prenotazioni));
    return {
      ora: s.ora,
      servizio: s.servizio,
      disponibile: !passato && libero,
      sconto: scontoPer(promozioni.results, giorno, s.minuti),
    };
  });
  return { chiuso: orari.results.length === 0, motivo: orari.results.length ? "" : "Il ristorante è chiuso in questo giorno.", slot };
}

const INSERISCI = `
INSERT INTO prenotazioni_v2 (id, codice, token_hash, data, ora, inizio_min, durata, persone, nome, telefono,
  email, occasione, note, stato, origine, tavolo_id, cliente_id, sconto, creata_il, aggiornata_il)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19
WHERE ?16 IS NULL OR NOT EXISTS (
  SELECT 1 FROM prenotazioni_v2 p
  WHERE p.tavolo_id = ?16 AND p.data = ?4 AND p.stato IN ${SQL_ATTIVI}
    AND p.inizio_min < ?6 + ?7 AND ?6 < p.inizio_min + p.durata)`;

/**
 * Prova i tavoli in ordine e inserisce la prenotazione nel primo libero.
 * Il controllo di sovrapposizione è nella stessa istruzione SQL, quindi due
 * richieste simultanee non possono prendere lo stesso tavolo.
 * Restituisce l'id del tavolo assegnato, null se senza tavolo, o false se nessuno era libero.
 */
export async function inserisciPrenotazione(env, riga, tavoliDaProvare) {
  const tentativi = tavoliDaProvare.length ? tavoliDaProvare : [null];
  for (const tavoloId of tentativi) {
    for (let prova = 0; prova < 3; prova += 1) {
      try {
        const esito = await env.DB.prepare(INSERISCI)
          .bind(
            riga.id,
            riga.codice,
            riga.token_hash,
            riga.data,
            riga.ora,
            riga.inizio_min,
            riga.durata,
            riga.persone,
            riga.nome,
            riga.telefono,
            riga.email,
            riga.occasione,
            riga.note,
            riga.stato,
            riga.origine,
            tavoloId,
            riga.cliente_id,
            riga.sconto,
            new Date().toISOString(),
          )
          .run();
        if (esito.meta.changes) return tavoloId;
        break;
      } catch (e) {
        if (!String(e.message).includes("UNIQUE") || !String(e.message).includes("codice")) throw e;
        riga.codice = codiceCasuale();
      }
    }
  }
  return false;
}

export async function trovaOCreaCliente(env, { nome, telefono, email }) {
  const telNorm = normalizzaTelefono(telefono);
  const emailNorm = email ? email.toLowerCase() : null;
  if (!telNorm && !emailNorm) return null;

  const cerca = async () => {
    if (telNorm) {
      const c = await env.DB.prepare("SELECT id FROM clienti WHERE tel_norm = ?").bind(telNorm).first();
      if (c) return c.id;
    }
    if (emailNorm) {
      const c = await env.DB.prepare("SELECT id FROM clienti WHERE email_norm = ?").bind(emailNorm).first();
      if (c) return c.id;
    }
    return null;
  };

  const esistente = await cerca();
  if (esistente) {
    await env.DB.prepare(
      `UPDATE clienti SET
         telefono = COALESCE(telefono, ?2), tel_norm = COALESCE(tel_norm, ?3),
         email = COALESCE(email, ?4), email_norm = COALESCE(email_norm, ?5)
       WHERE id = ?1
         AND (?3 IS NULL OR NOT EXISTS (SELECT 1 FROM clienti WHERE tel_norm = ?3 AND id <> ?1))
         AND (?5 IS NULL OR NOT EXISTS (SELECT 1 FROM clienti WHERE email_norm = ?5 AND id <> ?1))`,
    )
      .bind(esistente, telefono || null, telNorm, email || null, emailNorm)
      .run();
    return esistente;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO clienti (id, nome, telefono, tel_norm, email, email_norm, creato_il)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, nome, telefono || null, telNorm, email || null, emailNorm, new Date().toISOString())
    .run();
  return (await cerca()) ?? null;
}

export { STATI_ATTIVI };
