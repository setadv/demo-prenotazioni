import { creaUtente, elencoUtenti, modificaUtente, nuovoInvito, NOMI_RUOLI } from "./accesso.js";
import { MODULI, ORARI_INIZIALI, PIANI, TAVOLI_INIZIALI } from "./predefiniti.js";
import {
  CHIAVI_INTEGRAZIONI,
  SLUG,
  STATI_RISTORANTE,
  cifra,
  decifra,
  moduliDi,
  operativo,
  predefinito,
  registra,
  ristorantePerId,
  statoEffettivo,
} from "./ristoranti.js";
import { ErroreRichiesta, dataValida, emailValida, json, leggiJson, oraRoma, spostaData, testo } from "./util.js";

/** Slug riservati: non possono diventare sottodomini di un ristorante. */
const RISERVATI = new Set(["www", "admin", "api", "app", "piattaforma", "mail", "assistenza", "help", "static", "cdn", "demo-prenotazioni"]);

/** Tabelle con i dati di un ristorante, nell'ordine in cui si possono cancellare. */
const TABELLE_RISTORANTE = [
  "sondaggi",
  "punti_movimenti",
  "premi",
  "whatsapp_messaggi",
  "notifiche",
  "prenotazioni_v2",
  "ordini",
  "gift_card",
  "clienti",
  "menu_piatti",
  "menu_categorie",
  "tavoli",
  "sale",
  "orari",
  "promozioni",
  "impostazioni_r",
  "media_r",
  "menu_foto",
  "chiusure_r",
];

const oggi = () => oraRoma().data;

function centesimi(valore, campo) {
  if (valore === undefined || valore === null || valore === "") return null;
  const n = Math.round(Number(String(valore).replace(",", ".")) * 100);
  if (!Number.isInteger(n) || n < 0 || n > 10000000) throw new ErroreRichiesta(`${campo}: scrivi un importo in euro.`);
  return n;
}

function dataOpzionale(valore, campo) {
  if (valore === undefined) return undefined;
  if (valore === null || valore === "") return null;
  if (!dataValida(valore)) throw new ErroreRichiesta(`${campo}: data non valida.`);
  return valore;
}

function moduliValidi(valore) {
  if (!Array.isArray(valore)) throw new ErroreRichiesta("Moduli non validi.");
  return [...new Set(valore.filter((m) => m in MODULI))].join(",");
}

function slugValido(valore) {
  const s = String(valore ?? "").trim().toLowerCase();
  if (!SLUG.test(s)) throw new ErroreRichiesta("L'indirizzo può contenere solo lettere minuscole, numeri e trattini (2-40 caratteri).");
  if (s.length < 2 || RISERVATI.has(s)) throw new ErroreRichiesta("Questo indirizzo non è disponibile: scegline un altro.");
  return s;
}

/** Stato mostrato e scadenze, per elenco e dettaglio. */
function vista(r) {
  const o = oggi();
  return {
    id: r.id,
    slug: r.slug,
    nome: r.nome,
    stato: r.stato,
    stato_effettivo: statoEffettivo(r),
    operativo: operativo(r),
    piano: r.piano,
    moduli: [...moduliDi(r)],
    prova_fino: r.prova_fino,
    pagato_fino: r.pagato_fino,
    pagamento_scaduto: r.stato === "attivo" && Boolean(r.pagato_fino) && r.pagato_fino < o,
    prezzo_mensile: r.prezzo_mensile,
    motivo_sospensione: r.motivo_sospensione,
    ragione_sociale: r.ragione_sociale,
    partita_iva: r.partita_iva,
    codice_destinatario: r.codice_destinatario,
    pec: r.pec,
    indirizzo_fatturazione: r.indirizzo_fatturazione,
    contatto_nome: r.contatto_nome,
    contatto_email: r.contatto_email,
    contatto_telefono: r.contatto_telefono,
    note: r.note,
    creato_il: r.creato_il,
    aggiornato_il: r.aggiornato_il,
  };
}

export function indirizzoRistorante(env, r, origine) {
  if (env.DOMINIO_BASE) return `https://${r.slug}.${env.DOMINIO_BASE}`;
  return predefinito(env, r) ? `${origine}/` : `${origine}/?r=${r.slug}`;
}

async function richiedi(env, id) {
  const r = await ristorantePerId(env, id);
  if (!r) throw new ErroreRichiesta("Ristorante non trovato.", 404);
  return r;
}

// ---------- Cruscotto ----------

export async function riepilogo(env) {
  const o = oggi();
  const tra7 = spostaData(o, 7);
  const { results } = await env.DB.prepare("SELECT * FROM ristoranti ORDER BY nome").all();
  const conteggi = { prova: 0, prova_scaduta: 0, attivo: 0, sospeso: 0, disattivato: 0 };
  let mrr = 0;
  const scadenze = [];
  for (const r of results) {
    const s = statoEffettivo(r);
    conteggi[s] = (conteggi[s] ?? 0) + 1;
    if (r.stato === "attivo") mrr += r.prezzo_mensile;
    if (r.stato === "prova" && r.prova_fino && r.prova_fino <= tra7) {
      scadenze.push({ id: r.id, nome: r.nome, tipo: r.prova_fino < o ? "prova_scaduta" : "prova", data: r.prova_fino });
    }
    if (r.stato === "attivo" && r.pagato_fino && r.pagato_fino <= tra7) {
      scadenze.push({ id: r.id, nome: r.nome, tipo: r.pagato_fino < o ? "pagamento_scaduto" : "pagamento", data: r.pagato_fino });
    }
  }
  scadenze.sort((a, b) => a.data.localeCompare(b.data));
  const da = spostaData(o, -29);
  const [attivita, registro] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS prenotazioni, COALESCE(SUM(persone), 0) AS coperti FROM prenotazioni_v2
       WHERE data BETWEEN ? AND ? AND stato IN ('confermata', 'arrivata', 'in_attesa')`,
    ).bind(da, o),
    env.DB.prepare(
      `SELECT g.creato_il, g.autore, g.azione, g.dettaglio, r.nome AS ristorante, g.ristorante_id
       FROM registro g LEFT JOIN ristoranti r ON r.id = g.ristorante_id ORDER BY g.id DESC LIMIT 15`,
    ),
  ]);
  return json({
    totale: results.length,
    conteggi,
    mrr,
    arr: mrr * 12,
    scadenze,
    attivita_30_giorni: attivita.results[0],
    registro: registro.results,
    piani: PIANI,
    moduli: MODULI,
  });
}

// ---------- Ristoranti ----------

export async function elencoRistoranti(url, env) {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const stato = url.searchParams.get("stato") ?? "";
  const da = spostaData(oggi(), -29);
  const { results } = await env.DB.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM prenotazioni_v2 p WHERE p.ristorante_id = r.id AND p.data >= ?1) AS prenotazioni_30,
       (SELECT MAX(u.ultimo_accesso) FROM utenti u WHERE u.ristorante_id = r.id) AS ultimo_accesso,
       (SELECT COUNT(*) FROM utenti u WHERE u.ristorante_id = r.id AND u.attivo = 1) AS utenti
     FROM ristoranti r ORDER BY r.creato_il DESC`,
  )
    .bind(da)
    .all();
  const elenco = results
    .map((r) => ({ ...vista(r), prenotazioni_30: r.prenotazioni_30, ultimo_accesso: r.ultimo_accesso, utenti: r.utenti }))
    .filter((r) => !stato || r.stato_effettivo === stato || (stato === "da_pagare" && r.pagamento_scaduto))
    .filter((r) => !q || [r.nome, r.slug, r.ragione_sociale, r.contatto_email, r.partita_iva].some((v) => String(v ?? "").toLowerCase().includes(q)));
  return json({ ristoranti: elenco });
}

/** Nuovo ristorante: dati, piano, prova, sala e orari di partenza, invito al titolare. */
export async function creaRistorante(request, env, superadmin) {
  const corpo = await leggiJson(request);
  const nome = testo(corpo.nome, 80, { min: 2, campo: "Il nome del ristorante" });
  const slug = slugValido(corpo.slug);
  if (await env.DB.prepare("SELECT 1 FROM ristoranti WHERE slug = ?").bind(slug).first()) {
    throw new ErroreRichiesta("Questo indirizzo è già usato da un altro ristorante.", 409);
  }
  const piano = PIANI[corpo.piano] ? corpo.piano : "base";
  const moduli = Array.isArray(corpo.moduli) ? moduliValidi(corpo.moduli) : PIANI[piano].moduli.join(",");
  const prezzo = centesimi(corpo.prezzo_mensile, "Prezzo") ?? PIANI[piano].prezzo;
  const giorniProva = Number(corpo.giorni_prova ?? 14);
  if (!Number.isInteger(giorniProva) || giorniProva < 0 || giorniProva > 90) throw new ErroreRichiesta("Giorni di prova: da 0 a 90.");
  const email = String(corpo.email_titolare ?? "").trim().toLowerCase();
  if (email && !emailValida(email)) throw new ErroreRichiesta("Scrivi un'email valida per il titolare.");
  if (email && (await env.DB.prepare("SELECT 1 FROM utenti WHERE email = ?").bind(email).first())) {
    throw new ErroreRichiesta("Esiste già un account con l'email del titolare.", 409);
  }

  const id = await inserisciRistorante(env, {
    slug,
    nome,
    piano,
    moduli,
    giorniProva,
    prezzo,
    contattoNome: testo(corpo.nome_titolare, 80, { campo: "Il nome del titolare" }),
    email,
    telefono: testo(corpo.telefono, 30, { campo: "Il telefono" }),
    note: testo(corpo.note, 2000, { campo: "Le note" }),
  });
  await registra(env, { ristorante: id, autore: superadmin.nome, azione: "ristorante_creato", dettaglio: `${nome} (${PIANI[piano].nome})` });
  const origine = new URL(request.url).origin;
  let invito = null;
  if (email) {
    invito = await creaUtente(env, {
      ristoranteId: id,
      email,
      nome: corpo.nome_titolare,
      ruolo: "titolare",
      origine,
      autore: superadmin.nome,
    });
  }
  const r = await ristorantePerId(env, id);
  return json({ ristorante: vista(r), indirizzo: indirizzoRistorante(env, r, origine), invito: invito && { link: invito.link, inviata: invito.inviata } }, 201);
}

/** Scrive un ristorante nuovo con sala, tavoli e orari di partenza. Usato dalla piattaforma e dall'iscrizione. */
export async function inserisciRistorante(env, { slug, nome, piano, moduli, giorniProva, prezzo, contattoNome = "", email = "", telefono = "", note = "" }) {
  const id = crypto.randomUUID();
  const adesso = new Date().toISOString();
  const salaId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ristoranti (id, slug, nome, stato, piano, moduli, prova_fino, prezzo_mensile, contatto_nome, contatto_email,
         contatto_telefono, note, creato_il, aggiornato_il)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      slug,
      nome,
      giorniProva > 0 ? "prova" : "attivo",
      piano,
      moduli,
      giorniProva > 0 ? spostaData(oggi(), giorniProva) : null,
      prezzo,
      contattoNome,
      email,
      telefono,
      note,
      adesso,
      adesso,
    ),
    env.DB.prepare("INSERT INTO impostazioni_r (ristorante_id, chiave, valore) VALUES (?, 'nome', ?)").bind(id, nome),
    env.DB.prepare("INSERT INTO sale (id, nome, ordine, larghezza, altezza, attiva, ristorante_id) VALUES (?, 'Sala', 0, 900, 520, 1, ?)").bind(salaId, id),
    ...TAVOLI_INIZIALI.map(([n, min, max, forma, x, y, w, hh]) =>
      env.DB.prepare(
        `INSERT INTO tavoli (id, sala_id, nome, posti_min, posti_max, forma, x, y, larghezza, altezza, online, attivo, ristorante_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      ).bind(crypto.randomUUID(), salaId, n, min, max, forma, x, y, w, hh, id),
    ),
    ...ORARI_INIZIALI.map(([g, servizio, inizio, fine]) =>
      env.DB.prepare("INSERT INTO orari (giorno, servizio, inizio, fine, ristorante_id) VALUES (?, ?, ?, ?, ?)").bind(g, servizio, inizio, fine, id),
    ),
  ]);
  return id;
}

/** Indirizzo libero derivato dal nome: se è già preso aggiunge un numero. */
export async function slugLibero(env, nome) {
  let base = String(nome)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/, "");
  if (base.length < 2) base = "ristorante";
  if (RISERVATI.has(base)) base = `${base}-locale`;
  for (let n = 1; n <= 30; n += 1) {
    const s = n === 1 ? base : `${base}-${n}`;
    if (!(await env.DB.prepare("SELECT 1 FROM ristoranti WHERE slug = ?").bind(s).first())) return s;
  }
  return `${base}-${crypto.randomUUID().slice(0, 4)}`;
}

export async function dettaglioRistorante(request, env, id) {
  const r = await richiedi(env, id);
  const da = spostaData(oggi(), -29);
  const [prenotazioni, ordini, messaggi, clienti, registro] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS totale, COALESCE(SUM(persone), 0) AS coperti, COALESCE(SUM(stato = 'no_show'), 0) AS no_show,
         COALESCE(SUM(origine = 'online'), 0) AS online
       FROM prenotazioni_v2 WHERE ristorante_id = ? AND data >= ? AND stato <> 'annullata'`,
    ).bind(id, da),
    env.DB.prepare(
      `SELECT COUNT(*) AS totale, COALESCE(SUM(totale), 0) AS incasso FROM ordini
       WHERE ristorante_id = ? AND data >= ? AND stato NOT IN ('annullato', 'in_attesa_pagamento')`,
    ).bind(id, da),
    env.DB.prepare(
      `SELECT canale, COUNT(*) AS n FROM notifiche WHERE ristorante_id = ? AND creata_il >= ? AND esito = 'inviata' GROUP BY canale`,
    ).bind(id, `${da}T00:00:00`),
    env.DB.prepare("SELECT COUNT(*) AS n FROM clienti WHERE ristorante_id = ?").bind(id),
    env.DB.prepare("SELECT creato_il, autore, azione, dettaglio FROM registro WHERE ristorante_id = ? ORDER BY id DESC LIMIT 50").bind(id),
  ]);
  const integrazioni = await decifra(env, r.integrazioni);
  return json({
    ristorante: vista(r),
    indirizzo: indirizzoRistorante(env, r, new URL(request.url).origin),
    webhook: {
      stripe: `${new URL(request.url).origin}/api/stripe/webhook/${r.id}`,
      whatsapp: `${new URL(request.url).origin}/api/whatsapp/webhook/${r.slug}`,
    },
    utenti: await elencoUtenti(env, id),
    uso: {
      prenotazioni: prenotazioni.results[0],
      ordini: ordini.results[0],
      messaggi: Object.fromEntries(messaggi.results.map((m) => [m.canale, m.n])),
      clienti: clienti.results[0].n,
    },
    integrazioni: Object.fromEntries(CHIAVI_INTEGRAZIONI.map((k) => [k, integrazioni[k] ? mascherato(k, integrazioni[k]) : null])),
    registro: registro.results,
    piani: PIANI,
    moduli: MODULI,
  });
}

/** Le chiavi segrete non tornano mai al browser: se ne mostra solo la parte finale. */
function mascherato(chiave, valore) {
  const v = String(valore);
  if (/MODELLO|LINGUE|PHONE_ID/.test(chiave)) return v;
  return v.length > 8 ? `••••${v.slice(-4)}` : "••••";
}

const CAMPI_TESTO = {
  nome: [80, "Il nome"],
  ragione_sociale: [120, "La ragione sociale"],
  partita_iva: [20, "La partita IVA"],
  codice_destinatario: [7, "Il codice destinatario"],
  pec: [120, "La PEC"],
  indirizzo_fatturazione: [200, "L'indirizzo di fatturazione"],
  contatto_nome: [80, "Il nome del referente"],
  contatto_email: [120, "L'email del referente"],
  contatto_telefono: [30, "Il telefono del referente"],
  note: [2000, "Le note"],
};

export async function modificaRistorante(request, env, id, superadmin) {
  const r = await richiedi(env, id);
  const corpo = await leggiJson(request);
  const campi = [];
  const valori = [];
  const imposta = (k, v) => {
    campi.push(`${k} = ?`);
    valori.push(v);
  };
  for (const [k, [max, campo]] of Object.entries(CAMPI_TESTO)) {
    if (corpo[k] !== undefined) imposta(k, testo(corpo[k], max, { min: k === "nome" ? 2 : 0, campo }));
  }
  if (corpo.slug !== undefined && corpo.slug !== r.slug) {
    const s = slugValido(corpo.slug);
    if (await env.DB.prepare("SELECT 1 FROM ristoranti WHERE slug = ? AND id <> ?").bind(s, id).first()) {
      throw new ErroreRichiesta("Questo indirizzo è già usato da un altro ristorante.", 409);
    }
    imposta("slug", s);
  }
  if (corpo.piano !== undefined) {
    if (!PIANI[corpo.piano]) throw new ErroreRichiesta("Piano non valido.");
    imposta("piano", corpo.piano);
  }
  if (corpo.moduli !== undefined) imposta("moduli", moduliValidi(corpo.moduli));
  if (corpo.prezzo_mensile !== undefined) imposta("prezzo_mensile", centesimi(corpo.prezzo_mensile, "Prezzo") ?? 0);
  const prova = dataOpzionale(corpo.prova_fino, "Fine prova");
  if (prova !== undefined) imposta("prova_fino", prova);
  const pagato = dataOpzionale(corpo.pagato_fino, "Pagato fino al");
  if (pagato !== undefined) imposta("pagato_fino", pagato);
  if (!campi.length) throw new ErroreRichiesta("Niente da salvare.");
  imposta("aggiornato_il", new Date().toISOString());
  await env.DB.prepare(`UPDATE ristoranti SET ${campi.join(", ")} WHERE id = ?`).bind(...valori, id).run();
  if (corpo.nome !== undefined) {
    // Il nome è anche quello mostrato ai clienti, se il ristorante non l'ha cambiato.
    await env.DB.prepare(
      "INSERT INTO impostazioni_r (ristorante_id, chiave, valore) VALUES (?1, 'nome', ?2) ON CONFLICT (ristorante_id, chiave) DO UPDATE SET valore = ?2 WHERE valore = ?3",
    )
      .bind(id, String(corpo.nome).trim(), r.nome)
      .run();
  }
  const cambi = Object.keys(corpo).filter((k) => !["integrazioni"].includes(k));
  await registra(env, { ristorante: id, autore: superadmin.nome, azione: "ristorante_modificato", dettaglio: cambi.join(", ") });
  return dettaglioRistorante(request, env, id);
}

/** Attiva, sospende, riattiva o disattiva un ristorante. */
export async function cambiaStato(request, env, id, superadmin) {
  const r = await richiedi(env, id);
  const corpo = await leggiJson(request);
  if (!STATI_RISTORANTE.includes(corpo.stato)) throw new ErroreRichiesta("Stato non valido.");
  const motivo = testo(corpo.motivo, 300, { campo: "Il motivo" });
  if (corpo.stato === "sospeso" && !motivo) throw new ErroreRichiesta("Scrivi il motivo della sospensione: lo vedrà il ristorante.");
  let provaFino = r.prova_fino;
  if (corpo.stato === "prova") {
    const giorni = Number(corpo.giorni ?? 14);
    if (!Number.isInteger(giorni) || giorni < 1 || giorni > 90) throw new ErroreRichiesta("Giorni di prova: da 1 a 90.");
    provaFino = spostaData(oggi(), giorni);
  }
  await env.DB.prepare("UPDATE ristoranti SET stato = ?, motivo_sospensione = ?, prova_fino = ?, aggiornato_il = ? WHERE id = ?")
    .bind(corpo.stato, corpo.stato === "sospeso" ? motivo : "", provaFino, new Date().toISOString(), id)
    .run();
  const nomi = { prova: "in prova", attivo: "attivato", sospeso: "sospeso", disattivato: "disattivato" };
  await registra(env, {
    ristorante: id,
    autore: superadmin.nome,
    azione: `stato_${corpo.stato}`,
    dettaglio: `${r.nome} ${nomi[corpo.stato]}${corpo.stato === "prova" ? ` fino al ${provaFino}` : ""}${motivo ? `: ${motivo}` : ""}`,
  });
  return dettaglioRistorante(request, env, id);
}

/** Chiavi Stripe e WhatsApp del ristorante: si salvano cifrate; un valore vuoto cancella la chiave. */
export async function salvaIntegrazioni(request, env, id, superadmin) {
  const r = await richiedi(env, id);
  const corpo = await leggiJson(request);
  const attuali = await decifra(env, r.integrazioni);
  for (const [k, v] of Object.entries(corpo.integrazioni ?? {})) {
    if (!CHIAVI_INTEGRAZIONI.includes(k)) throw new ErroreRichiesta(`Chiave sconosciuta: ${k}.`);
    if (v === null || v === "") delete attuali[k];
    else attuali[k] = testo(v, 600, { campo: k });
  }
  await env.DB.prepare("UPDATE ristoranti SET integrazioni = ?, aggiornato_il = ? WHERE id = ?")
    .bind(Object.keys(attuali).length ? await cifra(env, attuali) : "", new Date().toISOString(), id)
    .run();
  await registra(env, { ristorante: id, autore: superadmin.nome, azione: "integrazioni_modificate", dettaglio: Object.keys(corpo.integrazioni ?? {}).join(", ") });
  return dettaglioRistorante(request, env, id);
}

/** Copia di tutti i dati di un ristorante, per restituirli al cliente o archiviarli. */
export async function esportaRistorante(env, id, superadmin) {
  const r = await richiedi(env, id);
  const dati = {};
  for (const t of TABELLE_RISTORANTE.filter((t) => t !== "media_r" && t !== "menu_foto")) {
    dati[t] = (await env.DB.prepare(`SELECT * FROM ${t} WHERE ristorante_id = ?`).bind(id).all()).results;
  }
  const ids = (righe) => JSON.stringify(righe.map((x) => x.id));
  dati.ordini_righe = (
    await env.DB.prepare("SELECT * FROM ordini_righe WHERE ordine_id IN (SELECT value FROM json_each(?))").bind(ids(dati.ordini)).all()
  ).results;
  dati.gift_card_movimenti = (
    await env.DB.prepare("SELECT * FROM gift_card_movimenti WHERE gift_card_id IN (SELECT value FROM json_each(?))").bind(ids(dati.gift_card)).all()
  ).results;
  const { integrazioni, ...anagrafica } = r;
  await registra(env, { ristorante: id, autore: superadmin.nome, azione: "dati_esportati" });
  return new Response(JSON.stringify({ esportato_il: new Date().toISOString(), ristorante: anagrafica, utenti: await elencoUtenti(env, id), dati }, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ristorante-${r.slug}-${oggi()}.json"`,
      "cache-control": "no-store",
    },
  });
}

/** Cancellazione definitiva: solo per ristoranti già disattivati e scrivendo l'indirizzo per conferma. */
export async function eliminaRistorante(request, env, id, superadmin) {
  const r = await richiedi(env, id);
  const corpo = await leggiJson(request);
  if (r.stato !== "disattivato") throw new ErroreRichiesta("Prima disattiva il ristorante, poi potrai cancellarlo.", 409);
  if (corpo.conferma !== r.slug) throw new ErroreRichiesta(`Per confermare scrivi l'indirizzo del ristorante: ${r.slug}`);
  if (id === "demo") throw new ErroreRichiesta("Il ristorante demo non si può cancellare.", 409);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ordini_righe WHERE ordine_id IN (SELECT id FROM ordini WHERE ristorante_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM gift_card_movimenti WHERE gift_card_id IN (SELECT id FROM gift_card WHERE ristorante_id = ?)").bind(id),
    ...TABELLE_RISTORANTE.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE ristorante_id = ?`).bind(id)),
    env.DB.prepare("DELETE FROM token_accesso WHERE utente_id IN (SELECT id FROM utenti WHERE ristorante_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM utenti WHERE ristorante_id = ?").bind(id),
    env.DB.prepare("DELETE FROM ristoranti WHERE id = ?").bind(id),
  ]);
  await registra(env, { ristorante: null, autore: superadmin.nome, azione: "ristorante_cancellato", dettaglio: `${r.nome} (${r.slug})` });
  return json({ ok: true });
}

// ---------- Utenti dei ristoranti e della piattaforma ----------

export async function nuovoUtenteRistorante(request, env, id, superadmin) {
  await richiedi(env, id);
  const corpo = await leggiJson(request);
  const esito = await creaUtente(env, {
    ristoranteId: id,
    email: corpo.email,
    nome: corpo.nome,
    ruolo: corpo.ruolo,
    origine: new URL(request.url).origin,
    autore: superadmin.nome,
  });
  return json(esito, 201);
}

export async function modificaUtenteRistorante(request, env, id, utenteId, superadmin) {
  const corpo = await leggiJson(request);
  const utente = await modificaUtente(env, { ristoranteId: id, id: utenteId, ruolo: corpo.ruolo, attivo: corpo.attivo, autore: superadmin.nome });
  return json({ utente });
}

export async function invitoUtenteRistorante(request, env, id, utenteId, superadmin) {
  return json(await nuovoInvito(env, { ristoranteId: id, id: utenteId, origine: new URL(request.url).origin, autore: superadmin.nome }));
}

async function superadmin(env) {
  const { results } = await env.DB.prepare("SELECT * FROM utenti WHERE ristorante_id IS NULL AND ruolo = 'superadmin' ORDER BY nome, email").all();
  return results.map((u) => ({
    id: u.id,
    email: u.email,
    nome: u.nome,
    ruolo: u.ruolo,
    attivo: Boolean(u.attivo),
    attivato: Boolean(u.password_hash),
    creato_il: u.creato_il,
    ultimo_accesso: u.ultimo_accesso,
  }));
}

export async function elencoAmministratori(env) {
  return json({ utenti: await superadmin(env) });
}

export async function nuovoAmministratore(request, env, chi) {
  const corpo = await leggiJson(request);
  const esito = await creaUtente(env, {
    ristoranteId: null,
    email: corpo.email,
    nome: corpo.nome,
    ruolo: "superadmin",
    origine: new URL(request.url).origin,
    autore: chi.nome,
  });
  return json(esito, 201);
}

export async function modificaAmministratore(request, env, utenteId, chi) {
  const corpo = await leggiJson(request);
  if (chi.id === utenteId && corpo.attivo === false) throw new ErroreRichiesta("Non puoi disattivare il tuo stesso account.");
  if (corpo.attivo === false) {
    const altri = await env.DB.prepare("SELECT COUNT(*) AS n FROM utenti WHERE ruolo = 'superadmin' AND attivo = 1 AND id <> ?").bind(utenteId).first();
    if (!altri.n && !env.SUPERADMIN_EMAIL) throw new ErroreRichiesta("Serve almeno un amministratore attivo.", 409);
  }
  const utente = await modificaUtente(env, { ristoranteId: null, id: utenteId, attivo: corpo.attivo, autore: chi.nome });
  return json({ utente });
}

export async function invitoAmministratore(request, env, utenteId, chi) {
  return json(await nuovoInvito(env, { ristoranteId: null, id: utenteId, origine: new URL(request.url).origin, autore: chi.nome }));
}

export async function registroCompleto(url, env) {
  const id = url.searchParams.get("ristorante");
  const { results } = await env.DB.prepare(
    `SELECT g.creato_il, g.autore, g.azione, g.dettaglio, g.ristorante_id, r.nome AS ristorante
     FROM registro g LEFT JOIN ristoranti r ON r.id = g.ristorante_id
     WHERE (?1 IS NULL OR g.ristorante_id = ?1) ORDER BY g.id DESC LIMIT 300`,
  )
    .bind(id || null)
    .all();
  return json({ registro: results });
}

export { NOMI_RUOLI };
