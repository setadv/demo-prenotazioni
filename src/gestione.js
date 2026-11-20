import { candidati, caricaGiorno, inserisciPrenotazione, trovaOCreaCliente } from "./disponibilita.js";
import { accreditaPunti, stornaPunti } from "./fidelity.js";
import { ALTRE_LINGUE, LINGUE } from "./lingue.js";
import {
  CANALI,
  TIPI,
  canaliAttivi,
  componiMessaggio,
  elaboraRecensioni,
  inviaConferma,
  messaggioDopoVisita,
  linkPrenotazione,
  registraInvioManuale,
} from "./notifiche.js";
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
  salvaImpostazione,
  oraRoma,
  oraValida,
  spostaData,
  testo,
} from "./util.js";

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const FORME = ["tondo", "quadrato", "rettangolo"];

const CAMPI_PRENOTAZIONE = `p.id, p.codice, p.data, p.ora, p.inizio_min, p.durata, p.persone, p.nome, p.telefono,
  p.email, p.occasione, p.note, p.note_interne, p.stato, p.origine, p.tavolo_id, p.cliente_id, p.sconto, p.creata_il, p.canale, p.lingua`;

const separa = (riga) => {
  if (!riga) return null;
  const [esito, canale, ...resto] = riga.split("|");
  return { esito, canale, dettaglio: resto.join("|") };
};

function richiediData(valore) {
  if (!dataValida(valore)) throw new ErroreRichiesta("Scegli una data valida.");
  return valore;
}

export async function agenda(url, env, ctx) {
  const data = richiediData(url.searchParams.get("data"));
  // Le richieste di recensione partono anche da qui: funzionano pure dove il Cron Trigger non gira (Preview).
  ctx?.waitUntil(elaboraRecensioni(env, url.origin));
  // L'indirizzo del sito serve ai messaggi che partono dal Cron Trigger, dove la richiesta non c'è.
  ctx?.waitUntil(
    salvaImpostazione(env, "url_sito", url.origin).run(),
  );
  const [prenotazioni, tavoli, sale] = await env.DB.batch([
    env.DB.prepare(
      `SELECT ${CAMPI_PRENOTAZIONE}, t.nome AS tavolo, c.note AS note_cliente, c.etichette, c.compleanno, c.fidelity,
         (SELECT COALESCE(SUM(m.punti), 0) FROM punti_movimenti m WHERE m.cliente_id = p.cliente_id) AS punti,
         (SELECT COUNT(*) FROM premi r WHERE r.cliente_id = p.cliente_id AND r.stato = 'attivo' AND r.scade_il >= p.data) AS premi_attivi,
         (SELECT COUNT(*) FROM prenotazioni_v2 x WHERE x.cliente_id = p.cliente_id AND x.stato = 'arrivata' AND x.id <> p.id) AS visite,
         (SELECT COUNT(*) FROM prenotazioni_v2 x WHERE x.cliente_id = p.cliente_id AND x.stato = 'no_show' AND x.id <> p.id) AS no_show,
         (SELECT n.esito || '|' || n.canale || '|' || n.dettaglio FROM notifiche n
           WHERE n.prenotazione_id = p.id AND n.tipo = 'conferma' ORDER BY n.id DESC LIMIT 1) AS notifica,
         (SELECT n.esito || '|' || n.canale || '|' || n.dettaglio FROM notifiche n
           WHERE n.prenotazione_id = p.id AND n.tipo = 'recensione' ORDER BY n.id DESC LIMIT 1) AS notifica_recensione
       FROM prenotazioni_v2 p
       LEFT JOIN tavoli t ON t.id = p.tavolo_id
       LEFT JOIN clienti c ON c.id = p.cliente_id
       WHERE p.ristorante_id = ? AND p.data = ?
       ORDER BY p.inizio_min, p.creata_il`,
    ).bind(env.RID, data),
    env.DB.prepare(
      `SELECT t.id, t.sala_id, t.nome, t.posti_min, t.posti_max, t.forma, t.x, t.y, t.larghezza, t.altezza, t.online
       FROM tavoli t JOIN sale s ON s.id = t.sala_id WHERE t.ristorante_id = ? AND t.attivo = 1 AND s.attiva = 1 ORDER BY s.ordine, t.nome`,
    ).bind(env.RID),
    env.DB.prepare("SELECT id, nome, larghezza, altezza FROM sale WHERE ristorante_id = ? AND attiva = 1 ORDER BY ordine, nome").bind(env.RID),
  ]);
  const imp = await leggiImpostazioni(env);
  const elenco = await Promise.all(
    prenotazioni.results.map(async (p) => {
      const contattabile = Boolean(p.telefono || p.email);
      const conMessaggio = p.stato === "confermata" && contattabile;
      const dopoVisita = p.stato === "arrivata" && contattabile ? await messaggioDopoVisita(env, imp, p, url.origin) : null;
      return {
        ...p,
        etichette: p.etichette ? p.etichette.split(",") : [],
        notifica: separa(p.notifica),
        notifica_recensione: separa(p.notifica_recensione),
        messaggio: conMessaggio
          ? componiMessaggio("conferma", imp, p, { link: await linkPrenotazione(env, url.origin, p.id, p.lingua) })
          : null,
        fidelity: Boolean(p.fidelity),
        messaggio_recensione: dopoVisita?.testo ?? null,
        tipo_dopo_visita: dopoVisita?.tipo ?? null,
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
    cliente_id: await trovaOCreaCliente(env, { nome, telefono, email, lingua: LINGUE.includes(corpo.lingua) ? corpo.lingua : null }),
    sconto: 0,
    canale: CANALI.includes(corpo.canale) ? corpo.canale : email ? "email" : "sms",
    lingua: LINGUE.includes(corpo.lingua) ? corpo.lingua : "it",
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
  if (riga.stato === "arrivata") ctx.waitUntil(puntiVisita(env, riga, new URL(request.url).origin));
  return json({ id: riga.id, codice: riga.codice, tavolo_id: tavolo || null }, 201);
}

/** Punti fedeltà per una visita: una sola volta per prenotazione. */
async function puntiVisita(env, p, origine) {
  const imp = await leggiImpostazioni(env);
  await accreditaPunti(env, {
    clienteId: p.cliente_id,
    punti: imp.punti_visita,
    motivo: `Visita ${p.codice}`,
    riferimento: `visita:${p.id}`,
    origine,
    canale: p.canale,
  });
}

export async function modificaPrenotazione(request, env, id, ctx) {
  const corpo = await leggiJson(request);
  const attuale = await env.DB.prepare("SELECT id, stato, tavolo_id, note_interne FROM prenotazioni_v2 WHERE id = ? AND ristorante_id = ?")
    .bind(id, env.RID)
    .first();
  if (!attuale) throw new ErroreRichiesta("Prenotazione non trovata.", 404);

  const stato = corpo.stato ?? attuale.stato;
  if (!STATI.includes(stato)) throw new ErroreRichiesta("Stato non valido.");
  let tavolo = attuale.tavolo_id;
  if ("tavolo_id" in corpo) {
    tavolo = corpo.tavolo_id || null;
    if (tavolo) {
      const esiste = await env.DB.prepare("SELECT id FROM tavoli WHERE id = ? AND ristorante_id = ? AND attivo = 1").bind(tavolo, env.RID).first();
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
    const p = await env.DB.prepare("SELECT id, codice, data, ora, persone, nome, telefono, email, canale, lingua FROM prenotazioni_v2 WHERE id = ? AND ristorante_id = ?")
      .bind(id, env.RID)
      .first();
    if (p.telefono || p.email) ctx.waitUntil(inviaConferma(env, await leggiImpostazioni(env), p, new URL(request.url).origin));
  }
  if (stato === "arrivata" && attuale.stato !== "arrivata") {
    const p = await env.DB.prepare("SELECT id, codice, cliente_id, canale FROM prenotazioni_v2 WHERE id = ?").bind(id).first();
    ctx.waitUntil(puntiVisita(env, p, new URL(request.url).origin));
  } else if (attuale.stato === "arrivata" && stato !== "arrivata") ctx.waitUntil(stornaPunti(env, `visita:${id}`));
  return json({ ok: true, stato, tavolo_id: tavolo });
}

export async function leggiSala(env) {
  const [sale, tavoli] = await env.DB.batch([
    env.DB.prepare("SELECT id, nome, larghezza, altezza FROM sale WHERE ristorante_id = ? AND attiva = 1 ORDER BY ordine, nome").bind(env.RID),
    env.DB.prepare(
      `SELECT id, sala_id, nome, posti_min, posti_max, forma, x, y, larghezza, altezza, online
       FROM tavoli WHERE ristorante_id = ? AND attivo = 1 ORDER BY nome`,
    ).bind(env.RID),
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

  // Gli identificativi appartengono a un solo ristorante: chi prova a usare quelli di un altro viene fermato.
  const tuttiIds = [...sale.map((x) => x.id), ...tavoli.map((x) => x.id)];
  const altrui = await env.DB.prepare(
    `SELECT id FROM sale WHERE ristorante_id <> ?1 AND id IN (SELECT value FROM json_each(?2))
     UNION SELECT id FROM tavoli WHERE ristorante_id <> ?1 AND id IN (SELECT value FROM json_each(?2)) LIMIT 1`,
  )
    .bind(env.RID, JSON.stringify(tuttiIds))
    .first();
  if (altrui) throw new ErroreRichiesta("Identificativo di sala o tavolo non valido. Ricarica la pagina.");
  const { results: attivi } = await env.DB.prepare("SELECT id, nome FROM tavoli WHERE ristorante_id = ? AND attivo = 1").bind(env.RID).all();
  const rimossi = attivi.filter((t) => !tavoliIds.has(t.id));
  if (rimossi.length) {
    const segnaposto = rimossi.map(() => "?").join(",");
    const { results: occupati } = await env.DB.prepare(
      `SELECT DISTINCT t.nome FROM prenotazioni_v2 p JOIN tavoli t ON t.id = p.tavolo_id
       WHERE p.tavolo_id IN (${segnaposto}) AND p.data >= ? AND p.stato IN ${SQL_ATTIVI} AND p.ristorante_id = ?`,
    )
      .bind(...rimossi.map((t) => t.id), oraRoma().data, env.RID)
      .all();
    if (occupati.length) {
      throw new ErroreRichiesta(
        `Non puoi eliminare ${occupati.length === 1 ? "il tavolo" : "i tavoli"} ${occupati.map((t) => t.nome).join(", ")}: ci sono prenotazioni future. Spostale prima su un altro tavolo.`,
        409,
      );
    }
  }

  const istruzioni = [
    env.DB.prepare("UPDATE sale SET attiva = 0 WHERE ristorante_id = ?").bind(env.RID),
    env.DB.prepare("UPDATE tavoli SET attivo = 0 WHERE ristorante_id = ?").bind(env.RID),
    ...sale.map((s) =>
      env.DB.prepare(
        `INSERT INTO sale (id, nome, ordine, larghezza, altezza, attiva, ristorante_id) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
         ON CONFLICT (id) DO UPDATE SET nome = ?2, ordine = ?3, larghezza = ?4, altezza = ?5, attiva = 1 WHERE sale.ristorante_id = ?6`,
      ).bind(s.id, s.nome, s.ordine, s.larghezza, s.altezza, env.RID),
    ),
    ...tavoli.map((t) =>
      env.DB.prepare(
        `INSERT INTO tavoli (id, sala_id, nome, posti_min, posti_max, forma, x, y, larghezza, altezza, online, attivo, ristorante_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12)
         ON CONFLICT (id) DO UPDATE SET sala_id = ?2, nome = ?3, posti_min = ?4, posti_max = ?5, forma = ?6,
           x = ?7, y = ?8, larghezza = ?9, altezza = ?10, online = ?11, attivo = 1 WHERE tavoli.ristorante_id = ?12`,
      ).bind(t.id, t.sala_id, t.nome, t.posti_min, t.posti_max, t.forma, t.x, t.y, t.larghezza, t.altezza, t.online, env.RID),
    ),
  ];
  await env.DB.batch(istruzioni);
  return leggiSala(env);
}

export async function leggiConfigurazione(env) {
  const oggi = oraRoma().data;
  const imp = await leggiImpostazioni(env);
  const [orari, chiusure, promozioni] = await env.DB.batch([
    env.DB.prepare("SELECT giorno, servizio, inizio, fine FROM orari WHERE ristorante_id = ? ORDER BY giorno, inizio").bind(env.RID),
    env.DB.prepare("SELECT data, motivo FROM chiusure_r WHERE ristorante_id = ? AND data >= ? ORDER BY data").bind(env.RID, oggi),
    env.DB.prepare("SELECT giorni, ora_da, ora_a, sconto, attiva FROM promozioni WHERE ristorante_id = ? ORDER BY id").bind(env.RID),
  ]);
  return json({
    impostazioni: imp,
    canali: canaliAttivi(env),
    orari: orari.results,
    chiusure: chiusure.results,
    promozioni: promozioni.results.map((p) => ({ ...p, giorni: p.giorni.split(",").map(Number), attiva: Boolean(p.attiva) })),
  });
}

const NOMI_LINGUE = { en: "inglese", de: "tedesco", fr: "francese", es: "spagnolo" };

function linkRecensioni(valore) {
  const t = testo(valore, 400, { campo: "Il link per le recensioni" });
  if (!t) return "";
  let u;
  try {
    u = new URL(t);
  } catch {
    throw new ErroreRichiesta("Il link per le recensioni non è valido: copialo intero, con https://.");
  }
  if (u.protocol !== "https:") throw new ErroreRichiesta("Il link per le recensioni deve iniziare con https://.");
  return u.toString();
}

function messaggioRecensione(valore, lingua) {
  const t = testo(valore, 600, { min: 20, campo: `Il messaggio di recensione ${lingua}` });
  if (!t.includes("{recensione}")) throw new ErroreRichiesta(`Il messaggio di recensione ${lingua} deve contenere {recensione}: è il link che il cliente apre.`);
  return t;
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
    link_recensioni: linkRecensioni(i.link_recensioni),
    recensioni_automatiche: i.recensioni_automatiche ? 1 : 0,
    recensione_dopo_ore: intero(i.recensione_dopo_ore ?? 2, 1, 72, "Ore dopo la visita"),
    messaggio_recensione: messaggioRecensione(i.messaggio_recensione, "in italiano"),
  };
  for (const l of ALTRE_LINGUE) {
    const nome = NOMI_LINGUE[l];
    imp[`descrizione_${l}`] = testo(i[`descrizione_${l}`], 500, { campo: `La descrizione in ${nome}` });
    imp[`messaggio_conferma_${l}`] = testo(i[`messaggio_conferma_${l}`], 600, { min: 20, campo: `Il messaggio di conferma in ${nome}` });
    imp[`messaggio_recensione_${l}`] = messaggioRecensione(i[`messaggio_recensione_${l}`], `in ${nome}`);
  }

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
      salvaImpostazione(env, k, v),
    ),
    env.DB.prepare("DELETE FROM orari WHERE ristorante_id = ?").bind(env.RID),
    ...orari.map((o) =>
      env.DB.prepare("INSERT INTO orari (giorno, servizio, inizio, fine, ristorante_id) VALUES (?, ?, ?, ?, ?)").bind(o.giorno, o.servizio, o.inizio, o.fine, env.RID),
    ),
    env.DB.prepare("DELETE FROM chiusure_r WHERE ristorante_id = ? AND data >= ?").bind(env.RID, oggi),
    ...[...chiusure].map(([data, motivo]) => env.DB.prepare("INSERT INTO chiusure_r (ristorante_id, data, motivo) VALUES (?, ?, ?)").bind(env.RID, data, motivo)),
    env.DB.prepare("DELETE FROM promozioni WHERE ristorante_id = ?").bind(env.RID),
    ...promozioni.map((p) =>
      env.DB.prepare("INSERT INTO promozioni (giorni, ora_da, ora_a, sconto, attiva, ristorante_id) VALUES (?, ?, ?, ?, ?, ?)").bind(p.giorni, p.ora_da, p.ora_a, p.sconto, p.attiva, env.RID),
    ),
  ]);
  return leggiConfigurazione(env);
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
       FROM prenotazioni_v2 WHERE ristorante_id = ? AND data BETWEEN ? AND ? GROUP BY data`,
    ).bind(env.RID, da, oggi),
    env.DB.prepare(
      `SELECT origine, COUNT(*) AS prenotazioni, SUM(persone) AS coperti FROM prenotazioni_v2
       WHERE ristorante_id = ? AND data BETWEEN ? AND ? AND stato <> 'annullata' GROUP BY origine`,
    ).bind(env.RID, da, oggi),
    env.DB.prepare(
      `SELECT COUNT(*) AS prenotazioni, COALESCE(SUM(persone), 0) AS coperti FROM prenotazioni_v2
       WHERE ristorante_id = ? AND data > ? AND data <= ? AND stato IN ${SQL_ATTIVI}`,
    ).bind(env.RID, oggi, spostaData(oggi, 7)),
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
  const tipo = TIPI.includes(corpo.tipo) ? corpo.tipo : "conferma";
  const p = await env.DB.prepare("SELECT id FROM prenotazioni_v2 WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  if (!p) throw new ErroreRichiesta("Prenotazione non trovata.", 404);
  await registraInvioManuale(env, id, corpo.canale, tipo);
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
       WHERE p.ristorante_id = ? AND p.data BETWEEN ? AND ? ORDER BY p.data, p.inizio_min, p.creata_il`,
    ).bind(env.RID, da, a),
    env.DB.prepare("SELECT data, motivo FROM chiusure_r WHERE ristorante_id = ? AND data BETWEEN ? AND ?").bind(env.RID, da, a),
    env.DB.prepare("SELECT DISTINCT giorno FROM orari WHERE ristorante_id = ?").bind(env.RID),
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
    `INSERT INTO media_r (ristorante_id, chiave, tipo, dati, aggiornato_il) VALUES (?5, ?1, ?2, ?3, ?4)
     ON CONFLICT (ristorante_id, chiave) DO UPDATE SET tipo = ?2, dati = ?3, aggiornato_il = ?4`,
  )
    .bind(chiave, tipo, dati.buffer, new Date().toISOString(), env.RID)
    .run();
  return json({ ok: true });
}

export async function eliminaMedia(env, chiave) {
  await env.DB.prepare("DELETE FROM media_r WHERE ristorante_id = ? AND chiave = ?").bind(env.RID, chiave).run();
  return json({ ok: true });
}

export async function mostraMedia(env, chiave) {
  const m = await env.DB.prepare("SELECT tipo, dati FROM media_r WHERE ristorante_id = ? AND chiave = ?").bind(env.RID, chiave).first();
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

/**
 * Prenotazioni online arrivate dopo un certo momento (non annullate), per l'avviso nel pannello.
 * Senza "dopo" restituisce solo l'ora del server, che il pannello usa come punto di partenza.
 */
export async function novita(url, env) {
  const adesso = new Date().toISOString();
  const dopo = url.searchParams.get("dopo") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(dopo)) return json({ adesso, totale: 0, prenotazioni: [] });
  const [elenco, conta] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, codice, data, ora, persone, nome, stato, creata_il FROM prenotazioni_v2
       WHERE ristorante_id = ? AND origine = 'online' AND stato <> 'annullata' AND creata_il > ?
       ORDER BY creata_il DESC LIMIT 20`,
    ).bind(env.RID, dopo),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM prenotazioni_v2 WHERE ristorante_id = ? AND origine = 'online' AND stato <> 'annullata' AND creata_il > ?",
    ).bind(env.RID, dopo),
  ]);
  return json({ adesso, totale: conta.results[0]?.n ?? 0, prenotazioni: elenco.results });
}

export { STATI_ATTIVI, MEDIA };
