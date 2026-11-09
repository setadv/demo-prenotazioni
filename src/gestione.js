import { candidati, caricaGiorno, inserisciPrenotazione, trovaOCreaCliente } from "./disponibilita.js";
import { CANALI, canaliAttivi, componiMessaggio, inviaConferma, linkPrenotazione, registraInvioManuale } from "./notifiche.js";
import {
  ErroreRichiesta,
  ORIGINI,
  SQL_ATTIVI,
  STATI,
  STATI_ATTIVI,
  aMinuti,
  codiceCasuale,
  dataValida,
  emailValida,
  intero,
  json,
  leggiImpostazioni,
  leggiJson,
  oraRoma,
  oraValida,
  spostaData,
  testo,
} from "./util.js";

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const FORME = ["tondo", "quadrato", "rettangolo"];

const CAMPI_PRENOTAZIONE = `p.id, p.codice, p.data, p.ora, p.inizio_min, p.durata, p.persone, p.nome, p.telefono,
  p.email, p.occasione, p.note, p.note_interne, p.stato, p.origine, p.tavolo_id, p.cliente_id, p.sconto, p.creata_il, p.canale`;

function richiediData(valore) {
  if (!dataValida(valore)) throw new ErroreRichiesta("Scegli una data valida.");
  return valore;
}

export async function agenda(url, env) {
  const data = richiediData(url.searchParams.get("data"));
  const [prenotazioni, tavoli, sale] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${CAMPI_PRENOTAZIONE}, t.nome AS tavolo, c.note AS note_cliente,
         (SELECT COUNT(*) FROM prenotazioni_v2 x WHERE x.cliente_id = p.cliente_id AND x.stato = 'arrivata' AND x.id <> p.id) AS visite,
         (SELECT COUNT(*) FROM prenotazioni_v2 x WHERE x.cliente_id = p.cliente_id AND x.stato = 'no_show' AND x.id <> p.id) AS no_show,
         (SELECT n.esito || '|' || n.canale || '|' || n.dettaglio FROM notifiche n WHERE n.prenotazione_id = p.id ORDER BY n.id DESC LIMIT 1) AS notifica
       FROM prenotazioni_v2 p
       LEFT JOIN tavoli t ON t.id = p.tavolo_id
       LEFT JOIN clienti c ON c.id = p.cliente_id
       WHERE p.data = ?
       ORDER BY p.inizio_min, p.creata_il`,
    ).bind(data),
    env.DB.prepare(
      `SELECT t.id, t.sala_id, t.nome, t.posti_min, t.posti_max, t.forma, t.x, t.y, t.larghezza, t.altezza, t.online
       FROM tavoli t JOIN sale s ON s.id = t.sala_id WHERE t.attivo = 1 AND s.attiva = 1 ORDER BY s.ordine, t.nome`,
    ),
    env.DB.prepare("SELECT id, nome, larghezza, altezza FROM sale WHERE attiva = 1 ORDER BY ordine, nome"),
  ]);
  const imp = await leggiImpostazioni(env);
  const elenco = await Promise.all(
    prenotazioni.results.map(async (p) => {
      const [esito, canale, dettaglio] = p.notifica ? p.notifica.split("|") : [];
      const conMessaggio = p.stato === "confermata" && (p.telefono || p.email);
      return {
        ...p,
        notifica: p.notifica ? { esito, canale, dettaglio } : null,
        messaggio: conMessaggio ? componiMessaggio(imp.messaggio_conferma, imp, p, await linkPrenotazione(env, url.origin, p.id)) : null,
      };
    }),
  );
  return json({
    data,
    durata: imp.durata,
    prenotazioni: elenco,
    tavoli: tavoli.results,
    sale: sale.results,
  });
}

export async function nuovaPrenotazioneGestore(request, env, ctx) {
  const corpo = await leggiJson(request);
  const imp = await leggiImpostazioni(env);
  const data = richiediData(corpo.data);
  if (!oraValida(corpo.ora)) throw new ErroreRichiesta("Scegli un orario valido.");
  const persone = intero(corpo.persone, 1, 50, "Persone");
  const nome = testo(corpo.nome, 80, { min: 2, campo: "Il nome" });
  const telefono = testo(corpo.telefono, 30, { campo: "Il telefono" });
  const email = testo(corpo.email, 254, { campo: "L'email" });
  if (email && !emailValida(email)) throw new ErroreRichiesta("Scrivi un'email valida o lascia il campo vuoto.");
  const note = testo(corpo.note, 300, { campo: "Le note" });
  const origine = ORIGINI.includes(corpo.origine) && corpo.origine !== "online" ? corpo.origine : "telefono";
  const durata = corpo.durata ? intero(corpo.durata, 15, 360, "Durata") : imp.durata;

  const { tavoli } = await caricaGiorno(env, data);
  let daProvare;
  if (corpo.tavolo_id) {
    if (!tavoli.some((t) => t.id === corpo.tavolo_id)) throw new ErroreRichiesta("Tavolo non trovato.", 404);
    daProvare = [corpo.tavolo_id];
  } else {
    daProvare = candidati(tavoli, persone, false).map((t) => t.id);
  }

  const riga = {
    id: crypto.randomUUID(),
    codice: codiceCasuale(),
    token_hash: null,
    data,
    ora: corpo.ora,
    inizio_min: aMinuti(corpo.ora),
    durata,
    persone,
    nome,
    telefono,
    email,
    occasione: "",
    note,
    stato: origine === "walk_in" ? "arrivata" : "confermata",
    origine,
    cliente_id: await trovaOCreaCliente(env, { nome, telefono, email }),
    sconto: 0,
    canale: CANALI.includes(corpo.canale) ? corpo.canale : email ? "email" : "sms",
  };

  let tavolo = daProvare.length ? await inserisciPrenotazione(env, riga, daProvare) : false;
  if (tavolo === false) {
    if (corpo.forza !== true) {
      const motivo = corpo.tavolo_id ? "Il tavolo scelto è occupato in quell'orario." : "Nessun tavolo adatto è libero in quell'orario.";
      throw new ErroreRichiesta(`${motivo} Puoi salvarla comunque senza tavolo.`, 409);
    }
    tavolo = await inserisciPrenotazione(env, riga, []);
  }
  if (riga.stato === "confermata" && (telefono || email)) {
    ctx.waitUntil(inviaConferma(env, imp, riga, new URL(request.url).origin));
  }
  return json({ id: riga.id, codice: riga.codice, tavolo_id: tavolo || null }, 201);
}

export async function modificaPrenotazione(request, env, id, ctx) {
  const corpo = await leggiJson(request);
  const attuale = await env.DB.prepare("SELECT id, stato, tavolo_id, note_interne FROM prenotazioni_v2 WHERE id = ?")
    .bind(id)
    .first();
  if (!attuale) throw new ErroreRichiesta("Prenotazione non trovata.", 404);

  const stato = corpo.stato ?? attuale.stato;
  if (!STATI.includes(stato)) throw new ErroreRichiesta("Stato non valido.");
  let tavolo = attuale.tavolo_id;
  if ("tavolo_id" in corpo) {
    tavolo = corpo.tavolo_id || null;
    if (tavolo) {
      const esiste = await env.DB.prepare("SELECT id FROM tavoli WHERE id = ? AND attivo = 1").bind(tavolo).first();
      if (!esiste) throw new ErroreRichiesta("Tavolo non trovato.", 404);
    }
  }
  const noteInterne = "note_interne" in corpo ? testo(corpo.note_interne, 500, { campo: "Le note interne" }) : attuale.note_interne;

  const esito = await env.DB.prepare(
    `UPDATE prenotazioni_v2 AS p SET stato = ?2, tavolo_id = ?3, note_interne = ?4, aggiornata_il = ?5
     WHERE p.id = ?1 AND (?3 IS NULL OR ?2 NOT IN ${SQL_ATTIVI} OR NOT EXISTS (
       SELECT 1 FROM prenotazioni_v2 o
       WHERE o.id <> p.id AND o.tavolo_id = ?3 AND o.data = p.data AND o.stato IN ${SQL_ATTIVI}
         AND o.inizio_min < p.inizio_min + p.durata AND p.inizio_min < o.inizio_min + o.durata))`,
  )
    .bind(id, stato, tavolo, noteInterne, new Date().toISOString())
    .run();
  if (!esito.meta.changes) {
    throw new ErroreRichiesta("Il tavolo è già occupato in quell'orario da un'altra prenotazione.", 409);
  }
  if (stato === "confermata" && ["in_attesa", "annullata", "no_show"].includes(attuale.stato)) {
    const p = await env.DB.prepare("SELECT id, codice, data, ora, persone, nome, telefono, email, canale FROM prenotazioni_v2 WHERE id = ?")
      .bind(id)
      .first();
    if (p.telefono || p.email) ctx.waitUntil(inviaConferma(env, await leggiImpostazioni(env), p, new URL(request.url).origin));
  }
  return json({ ok: true, stato, tavolo_id: tavolo });
}

export async function leggiSala(env) {
  const [sale, tavoli] = await env.DB.batch([
    env.DB.prepare("SELECT id, nome, larghezza, altezza FROM sale WHERE attiva = 1 ORDER BY ordine, nome"),
    env.DB.prepare(
      `SELECT id, sala_id, nome, posti_min, posti_max, forma, x, y, larghezza, altezza, online
       FROM tavoli WHERE attivo = 1 ORDER BY nome`,
    ),
  ]);
  return json({ sale: sale.results, tavoli: tavoli.results });
}

export async function salvaSala(request, env) {
  const corpo = await leggiJson(request);
  if (!Array.isArray(corpo.sale) || !Array.isArray(corpo.tavoli)) throw new ErroreRichiesta("Mappa non valida.");
  if (corpo.sale.length < 1 || corpo.sale.length > 10) throw new ErroreRichiesta("Serve almeno una sala, al massimo 10.");
  if (corpo.tavoli.length > 200) throw new ErroreRichiesta("Puoi avere al massimo 200 tavoli.");

  const sale = corpo.sale.map((s, i) => {
    if (!ID.test(s.id ?? "")) throw new ErroreRichiesta("Sala non valida.");
    return {
      id: s.id,
      nome: testo(s.nome, 40, { min: 1, campo: "Il nome della sala" }),
      ordine: i,
      larghezza: intero(s.larghezza ?? 1000, 400, 3000, "Larghezza sala"),
      altezza: intero(s.altezza ?? 600, 300, 3000, "Altezza sala"),
    };
  });
  const saleIds = new Map(sale.map((s) => [s.id, s]));
  if (saleIds.size !== sale.length) throw new ErroreRichiesta("Due sale hanno lo stesso identificativo.");

  const nomi = new Set();
  const tavoli = corpo.tavoli.map((t) => {
    if (!ID.test(t.id ?? "")) throw new ErroreRichiesta("Tavolo non valido.");
    const sala = saleIds.get(t.sala_id);
    if (!sala) throw new ErroreRichiesta("Un tavolo è in una sala che non esiste.");
    const nome = testo(t.nome, 12, { min: 1, campo: "Il nome del tavolo" });
    const chiaveNome = nome.toLowerCase();
    if (nomi.has(chiaveNome)) throw new ErroreRichiesta(`Ci sono due tavoli chiamati ${nome}. Dai un nome diverso a ciascuno.`);
    nomi.add(chiaveNome);
    const postiMin = intero(t.posti_min, 1, 30, `Posti minimi del tavolo ${nome}`);
    const postiMax = intero(t.posti_max, 1, 30, `Posti massimi del tavolo ${nome}`);
    if (postiMin > postiMax) throw new ErroreRichiesta(`Tavolo ${nome}: i posti minimi superano i massimi.`);
    if (!FORME.includes(t.forma)) throw new ErroreRichiesta(`Tavolo ${nome}: forma non valida.`);
    const larghezza = intero(t.larghezza, 40, 600, `Larghezza del tavolo ${nome}`);
    const altezza = intero(t.altezza, 40, 600, `Profondità del tavolo ${nome}`);
    return {
      id: t.id,
      sala_id: t.sala_id,
      nome,
      posti_min: postiMin,
      posti_max: postiMax,
      forma: t.forma,
      x: intero(Math.round(t.x), 0, sala.larghezza - larghezza, `Posizione del tavolo ${nome}`),
      y: intero(Math.round(t.y), 0, sala.altezza - altezza, `Posizione del tavolo ${nome}`),
      larghezza,
      altezza,
      online: t.online ? 1 : 0,
    };
  });
  const tavoliIds = new Set(tavoli.map((t) => t.id));
  if (tavoliIds.size !== tavoli.length) throw new ErroreRichiesta("Due tavoli hanno lo stesso identificativo.");

  const { results: attivi } = await env.DB.prepare("SELECT id, nome FROM tavoli WHERE attivo = 1").all();
  const rimossi = attivi.filter((t) => !tavoliIds.has(t.id));
  if (rimossi.length) {
    const segnaposto = rimossi.map(() => "?").join(",");
    const { results: occupati } = await env.DB.prepare(
      `SELECT DISTINCT t.nome FROM prenotazioni_v2 p JOIN tavoli t ON t.id = p.tavolo_id
       WHERE p.tavolo_id IN (${segnaposto}) AND p.data >= ? AND p.stato IN ${SQL_ATTIVI}`,
    )
      .bind(...rimossi.map((t) => t.id), oraRoma().data)
      .all();
    if (occupati.length) {
      throw new ErroreRichiesta(
        `Non puoi eliminare ${occupati.length === 1 ? "il tavolo" : "i tavoli"} ${occupati.map((t) => t.nome).join(", ")}: ci sono prenotazioni future. Spostale prima su un altro tavolo.`,
        409,
      );
    }
  }

  const istruzioni = [
    env.DB.prepare("UPDATE sale SET attiva = 0"),
    env.DB.prepare("UPDATE tavoli SET attivo = 0"),
    ...sale.map((s) =>
      env.DB.prepare(
        `INSERT INTO sale (id, nome, ordine, larghezza, altezza, attiva) VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT (id) DO UPDATE SET nome = ?2, ordine = ?3, larghezza = ?4, altezza = ?5, attiva = 1`,
      ).bind(s.id, s.nome, s.ordine, s.larghezza, s.altezza),
    ),
    ...tavoli.map((t) =>
      env.DB.prepare(
        `INSERT INTO tavoli (id, sala_id, nome, posti_min, posti_max, forma, x, y, larghezza, altezza, online, attivo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)
         ON CONFLICT (id) DO UPDATE SET sala_id = ?2, nome = ?3, posti_min = ?4, posti_max = ?5, forma = ?6,
           x = ?7, y = ?8, larghezza = ?9, altezza = ?10, online = ?11, attivo = 1`,
      ).bind(t.id, t.sala_id, t.nome, t.posti_min, t.posti_max, t.forma, t.x, t.y, t.larghezza, t.altezza, t.online),
    ),
  ];
  await env.DB.batch(istruzioni);
  return leggiSala(env);
}

export async function leggiConfigurazione(env) {
  const oggi = oraRoma().data;
  const imp = await leggiImpostazioni(env);
  const [orari, chiusure, promozioni] = await env.DB.batch([
    env.DB.prepare("SELECT giorno, servizio, inizio, fine FROM orari ORDER BY giorno, inizio"),
    env.DB.prepare("SELECT data, motivo FROM chiusure WHERE data >= ? ORDER BY data").bind(oggi),
    env.DB.prepare("SELECT giorni, ora_da, ora_a, sconto, attiva FROM promozioni ORDER BY id"),
  ]);
  return json({
    impostazioni: imp,
    canali: canaliAttivi(env),
    orari: orari.results,
    chiusure: chiusure.results,
    promozioni: promozioni.results.map((p) => ({ ...p, giorni: p.giorni.split(",").map(Number), attiva: Boolean(p.attiva) })),
  });
}

export async function salvaConfigurazione(request, env) {
  const corpo = await leggiJson(request);
  const i = corpo.impostazioni ?? {};
  const imp = {
    nome: testo(i.nome, 60, { min: 2, campo: "Il nome del ristorante" }),
    indirizzo: testo(i.indirizzo, 120, { campo: "L'indirizzo" }),
    telefono: testo(i.telefono, 30, { campo: "Il telefono" }),
    descrizione: testo(i.descrizione, 500, { campo: "La descrizione" }),
    prezzo_medio: intero(i.prezzo_medio, 0, 500, "Prezzo medio"),
    durata: intero(i.durata, 30, 300, "Durata del tavolo"),
    intervallo: [15, 30, 60].includes(Number(i.intervallo)) ? Number(i.intervallo) : 15,
    anticipo: intero(i.anticipo, 0, 1440, "Anticipo minimo"),
    giorni_prenotabili: intero(i.giorni_prenotabili, 1, 365, "Giorni prenotabili"),
    max_persone_online: intero(i.max_persone_online, 1, 30, "Persone massime online"),
    conferma_automatica: i.conferma_automatica ? 1 : 0,
    messaggio_conferma: testo(i.messaggio_conferma, 600, { min: 20, campo: "Il messaggio di conferma" }),
  };

  if (!Array.isArray(corpo.orari) || corpo.orari.length > 40) throw new ErroreRichiesta("Orari non validi.");
  const orari = corpo.orari.map((o) => {
    const giorno = intero(o.giorno, 0, 6, "Giorno");
    const servizio = testo(o.servizio, 30, { min: 1, campo: "Il nome del servizio" });
    if (!oraValida(o.inizio) || !oraValida(o.fine)) throw new ErroreRichiesta(`${servizio}: scegli orari validi.`);
    if (o.inizio > o.fine) throw new ErroreRichiesta(`${servizio}: l'ultimo orario prenotabile è prima del primo.`);
    return { giorno, servizio, inizio: o.inizio, fine: o.fine };
  });

  const oggi = oraRoma().data;
  if (!Array.isArray(corpo.chiusure) || corpo.chiusure.length > 120) throw new ErroreRichiesta("Chiusure non valide.");
  const chiusure = new Map();
  for (const c of corpo.chiusure) {
    if (!dataValida(c.data) || c.data < oggi) throw new ErroreRichiesta("Le chiusure devono avere una data da oggi in poi.");
    chiusure.set(c.data, testo(c.motivo, 80, { campo: "Il motivo" }));
  }

  if (!Array.isArray(corpo.promozioni) || corpo.promozioni.length > 30) throw new ErroreRichiesta("Promozioni non valide.");
  const promozioni = corpo.promozioni.map((p) => {
    if (!Array.isArray(p.giorni) || !p.giorni.length) throw new ErroreRichiesta("Ogni promozione deve avere almeno un giorno.");
    const giorni = [...new Set(p.giorni.map((g) => intero(g, 0, 6, "Giorno")))].sort().join(",");
    if (!oraValida(p.ora_da) || !oraValida(p.ora_a) || p.ora_da > p.ora_a) throw new ErroreRichiesta("Promozione: scegli una fascia oraria valida.");
    return { giorni, ora_da: p.ora_da, ora_a: p.ora_a, sconto: intero(p.sconto, 5, 50, "Sconto"), attiva: p.attiva ? 1 : 0 };
  });

  await env.DB.batch([
    ...Object.entries(imp).map(([k, v]) =>
      env.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES (?1, ?2) ON CONFLICT (chiave) DO UPDATE SET valore = ?2").bind(k, String(v)),
    ),
    env.DB.prepare("DELETE FROM orari"),
    ...orari.map((o) => env.DB.prepare("INSERT INTO orari (giorno, servizio, inizio, fine) VALUES (?, ?, ?, ?)").bind(o.giorno, o.servizio, o.inizio, o.fine)),
    env.DB.prepare("DELETE FROM chiusure WHERE data >= ?").bind(oggi),
    ...[...chiusure].map(([data, motivo]) => env.DB.prepare("INSERT INTO chiusure (data, motivo) VALUES (?, ?)").bind(data, motivo)),
    env.DB.prepare("DELETE FROM promozioni"),
    ...promozioni.map((p) =>
      env.DB.prepare("INSERT INTO promozioni (giorni, ora_da, ora_a, sconto, attiva) VALUES (?, ?, ?, ?, ?)").bind(p.giorni, p.ora_da, p.ora_a, p.sconto, p.attiva),
    ),
  ]);
  return leggiConfigurazione(env);
}

export async function elencoClienti(url, env) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const filtro = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.nome, c.telefono, c.email, c.note,
       COUNT(p.id) AS prenotazioni,
       SUM(p.stato = 'arrivata') AS visite,
       SUM(p.stato = 'no_show') AS no_show,
       MAX(CASE WHEN p.stato = 'arrivata' THEN p.data END) AS ultima_visita,
       MIN(CASE WHEN p.stato IN ${SQL_ATTIVI} AND p.data >= ?2 THEN p.data END) AS prossima
     FROM clienti c LEFT JOIN prenotazioni_v2 p ON p.cliente_id = c.id
     WHERE ?1 = '%%' OR c.nome LIKE ?1 ESCAPE '\\' OR c.telefono LIKE ?1 ESCAPE '\\' OR c.email LIKE ?1 ESCAPE '\\'
     GROUP BY c.id
     ORDER BY COALESCE(ultima_visita, prossima, c.creato_il) DESC
     LIMIT 100`,
  )
    .bind(filtro, oraRoma().data)
    .all();
  return json({ clienti: results });
}

export async function modificaCliente(request, env, id) {
  const corpo = await leggiJson(request);
  const note = testo(corpo.note, 500, { campo: "Le note" });
  const esito = await env.DB.prepare("UPDATE clienti SET note = ? WHERE id = ?").bind(note, id).run();
  if (!esito.meta.changes) throw new ErroreRichiesta("Cliente non trovato.", 404);
  return json({ ok: true });
}

export async function statistiche(url, env) {
  const giorni = intero(url.searchParams.get("giorni") ?? "30", 7, 365, "Periodo");
  const oggi = oraRoma().data;
  const da = spostaData(oggi, -(giorni - 1));
  const [perGiorno, perOrigine, prossimi] = await env.DB.batch([
    env.DB.prepare(
      `SELECT data,
         COUNT(*) AS prenotazioni,
         SUM(CASE WHEN stato IN ('arrivata', 'confermata', 'in_attesa') THEN persone ELSE 0 END) AS coperti,
         SUM(stato = 'arrivata') AS arrivate,
         SUM(stato = 'no_show') AS no_show,
         SUM(stato = 'annullata') AS annullate
       FROM prenotazioni_v2 WHERE data BETWEEN ? AND ? GROUP BY data`,
    ).bind(da, oggi),
    env.DB.prepare(
      `SELECT origine, COUNT(*) AS prenotazioni, SUM(persone) AS coperti FROM prenotazioni_v2
       WHERE data BETWEEN ? AND ? AND stato <> 'annullata' GROUP BY origine`,
    ).bind(da, oggi),
    env.DB.prepare(
      `SELECT COUNT(*) AS prenotazioni, COALESCE(SUM(persone), 0) AS coperti FROM prenotazioni_v2
       WHERE data > ? AND data <= ? AND stato IN ${SQL_ATTIVI}`,
    ).bind(oggi, spostaData(oggi, 7)),
  ]);
  const mappa = new Map(perGiorno.results.map((r) => [r.data, r]));
  const serie = [];
  for (let i = 0; i < giorni; i += 1) {
    const data = spostaData(da, i);
    const r = mappa.get(data);
    serie.push({
      data,
      prenotazioni: r?.prenotazioni ?? 0,
      coperti: r?.coperti ?? 0,
      arrivate: r?.arrivate ?? 0,
      no_show: r?.no_show ?? 0,
      annullate: r?.annullate ?? 0,
    });
  }
  return json({ da, a: oggi, serie, origini: perOrigine.results, prossimi_7_giorni: prossimi.results[0] });
}

export async function invioManuale(request, env, id) {
  const corpo = await leggiJson(request);
  if (!CANALI.includes(corpo.canale)) throw new ErroreRichiesta("Canale non valido.");
  const p = await env.DB.prepare("SELECT id FROM prenotazioni_v2 WHERE id = ?").bind(id).first();
  if (!p) throw new ErroreRichiesta("Prenotazione non trovata.", 404);
  await registraInvioManuale(env, id, corpo.canale);
  return json({ ok: true });
}

export async function periodo(url, env) {
  const da = richiediData(url.searchParams.get("da"));
  const a = richiediData(url.searchParams.get("a"));
  if (a < da || Date.parse(a) - Date.parse(da) > 42 * 86400000) throw new ErroreRichiesta("Scegli un periodo fino a 6 settimane.");
  const [prenotazioni, chiusure, orari] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.data, p.ora, p.inizio_min, p.persone, p.nome, p.stato, p.origine, t.nome AS tavolo
       FROM prenotazioni_v2 p LEFT JOIN tavoli t ON t.id = p.tavolo_id
       WHERE p.data BETWEEN ? AND ? ORDER BY p.data, p.inizio_min, p.creata_il`,
    ).bind(da, a),
    env.DB.prepare("SELECT data, motivo FROM chiusure WHERE data BETWEEN ? AND ?").bind(da, a),
    env.DB.prepare("SELECT DISTINCT giorno FROM orari"),
  ]);
  return json({
    da,
    a,
    prenotazioni: prenotazioni.results,
    chiusure: chiusure.results,
    giorni_aperti: orari.results.map((o) => o.giorno),
  });
}

const MEDIA = { logo: 512 * 1024, foto: 1536 * 1024 };

function tipoImmagine(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function salvaMedia(request, env, chiave) {
  const massimo = MEDIA[chiave];
  const dati = new Uint8Array(await request.arrayBuffer());
  if (!dati.byteLength || dati.byteLength > massimo) {
    throw new ErroreRichiesta(`Carica un'immagine fino a ${Math.round(massimo / 1024)} KB.`, 413);
  }
  const tipo = tipoImmagine(dati);
  if (!tipo) throw new ErroreRichiesta("Carica un'immagine JPG, PNG o WebP.", 415);
  await env.DB.prepare(
    `INSERT INTO media (chiave, tipo, dati, aggiornato_il) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (chiave) DO UPDATE SET tipo = ?2, dati = ?3, aggiornato_il = ?4`,
  )
    .bind(chiave, tipo, dati.buffer, new Date().toISOString())
    .run();
  return json({ ok: true });
}

export async function eliminaMedia(env, chiave) {
  await env.DB.prepare("DELETE FROM media WHERE chiave = ?").bind(chiave).run();
  return json({ ok: true });
}

export async function mostraMedia(env, chiave) {
  const m = await env.DB.prepare("SELECT tipo, dati FROM media WHERE chiave = ?").bind(chiave).first();
  if (!m) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(m.dati), {
    headers: {
      "content-type": m.tipo,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

export { STATI_ATTIVI, MEDIA };
