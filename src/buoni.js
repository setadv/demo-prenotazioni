import { linkPubblico } from "./ristoranti.js";
import { dataIn, erroreIn, linguaRichiesta, linguaValida, LINGUE, modelloIn } from "./lingue.js";
import { consegna, formatoEuro, testoModello, tokenPer, tokenPerValido } from "./notifiche.js";
import { creaPagamento, stripeAttivo } from "./pagamenti.js";
import {
  ErroreRichiesta,
  codiceCasuale,
  emailValida,
  impronta,
  intero,
  json,
  leggiImpostazioni,
  leggiJson,
  limiteSuperato,
  oraRoma,
  registraTentativo,
  testo,
} from "./util.js";

const CODICE = /^(GC|PR)-[A-Z0-9-]{6,14}$/;

export const importiGift = (imp) =>
  String(imp.gift_importi ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

function scadenzaMesi(mesi) {
  const d = new Date(`${oraRoma().data}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + mesi);
  return d.toISOString().slice(0, 10);
}

export async function linkGift(env, origine, id, lingua = "it") {
  const l = lingua !== "it" ? `&l=${lingua}` : "";
  return linkPubblico(env, "/buono", { origine, frammento: `tipo=gift&id=${id}&t=${await tokenPer(env, "gift", id)}${l}` });
}

async function nuovoCodice(env) {
  for (let i = 0; i < 5; i += 1) {
    const codice = `GC-${codiceCasuale()}`;
    if (!(await env.DB.prepare("SELECT 1 FROM gift_card WHERE codice = ?").bind(codice).first())) return codice;
  }
  throw new Error("Codice non generato");
}

async function valoriGift(env, imp, g, origine) {
  const lingua = linguaValida(g.lingua);
  return {
    destinatario: g.destinatario_nome || g.acquirente_nome,
    mittente: g.acquirente_nome || imp.nome,
    importo: formatoEuro(lingua, g.importo),
    ristorante: imp.nome,
    codice: g.codice,
    scadenza: dataIn(lingua, g.scade_il),
    link: await linkGift(env, origine, g.id, lingua),
  };
}

/** Messaggio della gift card a chi la riceve (o a chi l'ha comprata, se manca il destinatario). */
async function inviaGift(env, imp, g, origine) {
  const lingua = linguaValida(g.lingua);
  const valori = await valoriGift(env, imp, g, origine);
  const email = g.destinatario_email || g.acquirente_email;
  const telefono = g.destinatario_telefono || g.acquirente_telefono;
  if (!email && !telefono) return;
  await consegna(env, imp, {
    rif: g.id,
    tipo: "gift",
    canale: email ? "email" : "whatsapp",
    telefono,
    email,
    lingua,
    valori,
    testo: testoModello(imp, "messaggio_gift", lingua, valori),
  });
}

/** Attiva una gift card pagata: il saldo diventa spendibile e parte il messaggio. Idempotente. */
export async function attivaGift(env, id, origine, pagamentoId = null) {
  const adesso = new Date().toISOString();
  const r = await env.DB.prepare(
    "UPDATE gift_card SET stato = 'attiva', attivata_il = ?, pagamento_id = COALESCE(?, pagamento_id) WHERE id = ? AND ristorante_id = ? AND stato = 'in_attesa_pagamento'",
  )
    .bind(adesso, pagamentoId, id, env.RID)
    .run();
  if (!r.meta.changes) return false;
  const g = await env.DB.prepare("SELECT * FROM gift_card WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  await env.DB.prepare("INSERT INTO gift_card_movimenti (gift_card_id, importo, nota, creato_il) VALUES (?, ?, 'Acquisto online', ?)")
    .bind(id, g.importo, adesso)
    .run();
  await inviaGift(env, await leggiImpostazioni(env), g, origine);
  return true;
}

function datiGift(corpo, lingua, perGestore) {
  const errore = (chiave) => new ErroreRichiesta(perGestore ? erroreIn("it", chiave) : erroreIn(lingua, chiave));
  const campo = (v, max) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > max) throw errore("lungo");
    return t;
  };
  const d = {
    acquirente_nome: campo(corpo.acquirente_nome, 80),
    acquirente_email: campo(corpo.acquirente_email, 254),
    acquirente_telefono: campo(corpo.acquirente_telefono, 30),
    destinatario_nome: campo(corpo.destinatario_nome, 80),
    destinatario_email: campo(corpo.destinatario_email, 254),
    destinatario_telefono: campo(corpo.destinatario_telefono, 30),
    messaggio: campo(corpo.messaggio, 300),
  };
  for (const k of ["acquirente_email", "destinatario_email"]) if (d[k] && !emailValida(d[k])) throw errore("email");
  if (!d.destinatario_nome) throw errore("destinatario");
  return d;
}

/** Dati per la pagina pubblica di acquisto. */
export async function infoGift(env) {
  const imp = await leggiImpostazioni(env);
  return json({
    attive: Boolean(imp.gift_attive),
    online: Boolean(imp.gift_attive) && stripeAttivo(env),
    importi: importiGift(imp),
    validita_mesi: imp.gift_validita_mesi,
    ristorante: { nome: imp.nome, telefono: imp.telefono, indirizzo: imp.indirizzo },
  });
}

/** Acquisto online: crea la gift card in attesa di pagamento e rimanda a Stripe. */
export async function acquistaGift(request, env) {
  const corpo = await leggiJson(request);
  const lingua = linguaRichiesta(request, null, corpo);
  const imp = await leggiImpostazioni(env);
  if (!imp.gift_attive || !stripeAttivo(env)) throw new ErroreRichiesta(erroreIn(lingua, "gift_chiuse"), 409);
  const euro = Number(corpo.importo);
  if (!importiGift(imp).includes(euro)) throw new ErroreRichiesta(erroreIn(lingua, "importo"));
  const d = datiGift(corpo, lingua, false);
  if (!d.acquirente_nome || d.acquirente_nome.length < 2) throw new ErroreRichiesta(erroreIn(lingua, "nome"));
  if (!d.acquirente_email) throw new ErroreRichiesta(erroreIn(lingua, "email_canale"));
  if (corpo.privacy !== true) throw new ErroreRichiesta(erroreIn(lingua, "privacy"));
  const chiave = `gift:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 10, 60)) throw new ErroreRichiesta(erroreIn(lingua, "limite"), 429);
  await registraTentativo(env, chiave);

  const id = crypto.randomUUID();
  const codice = await nuovoCodice(env);
  const importo = euro * 100;
  await env.DB.prepare(
    `INSERT INTO gift_card (id, codice, importo, saldo, acquirente_nome, acquirente_email, acquirente_telefono, destinatario_nome,
       destinatario_email, destinatario_telefono, messaggio, lingua, stato, origine, creata_il, scade_il, ristorante_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_attesa_pagamento', 'online', ?, ?, ?)`,
  )
    .bind(id, codice, importo, importo, d.acquirente_nome, d.acquirente_email, d.acquirente_telefono, d.destinatario_nome, d.destinatario_email,
      d.destinatario_telefono, d.messaggio, lingua, new Date().toISOString(), scadenzaMesi(imp.gift_validita_mesi), env.RID)
    .run();
  const origine = new URL(request.url).origin;
  const token = await tokenPer(env, "gift", id);
  const pagamento = await creaPagamento(env, {
    descrizione: `Gift card ${imp.nome} ${formatoEuro(lingua, importo)}`,
    importo,
    email: d.acquirente_email,
    lingua,
    successo: linkPubblico(env, "/buono", { origine, query: `tipo=gift&id=${id}&t=${token}&l=${lingua}&pagato=1` }),
    annullato: linkPubblico(env, "/regalo", { origine, query: `lang=${lingua}` }),
    metadati: { tipo: "gift", id, ristorante: env.RID },
  });
  await env.DB.prepare("UPDATE gift_card SET pagamento_id = ? WHERE id = ? AND ristorante_id = ?").bind(pagamento.id, id, env.RID).run();
  return json({ id, url_pagamento: pagamento.url }, 201);
}

/** Pagina pubblica del buono: gift card o premio fedeltà, solo con il link personale. */
export async function leggiBuono(request, env, tipo, id) {
  const lingua = linguaRichiesta(request);
  const token = request.headers.get("x-buono-token") ?? "";
  if (!(await tokenPerValido(env, tipo, id, token))) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
  const imp = await leggiImpostazioni(env);
  const ristorante = { nome: imp.nome, indirizzo: imp.indirizzo, telefono: imp.telefono };
  const oggi = oraRoma().data;
  if (tipo === "gift") {
    const g = await env.DB.prepare(
      "SELECT codice, importo, saldo, acquirente_nome, destinatario_nome, messaggio, stato, scade_il FROM gift_card WHERE id = ? AND ristorante_id = ?",
    )
      .bind(id, env.RID)
      .first();
    if (!g) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
    return json({ tipo, ...g, scaduto: g.scade_il < oggi, ristorante });
  }
  const p = await env.DB.prepare(
    "SELECT p.codice, p.stato, p.scade_il, p.punti, c.nome, c.lingua FROM premi p JOIN clienti c ON c.id = p.cliente_id WHERE p.id = ? AND p.ristorante_id = ?",
  )
    .bind(id, env.RID)
    .first();
  if (!p) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
  const descrizioni = Object.fromEntries(LINGUE.map((l) => [l, modelloIn(imp, "premio_descrizione", l)]));
  return json({ tipo, codice: p.codice, stato: p.stato, scade_il: p.scade_il, scaduto: p.scade_il < oggi, punti: p.punti, nome: p.nome, descrizioni, ristorante });
}

// ---------- Pannello ----------

export async function elencoGift(url, env) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const filtro = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.codice, g.importo, g.saldo, g.acquirente_nome, g.destinatario_nome, g.destinatario_email, g.destinatario_telefono,
       g.acquirente_email, g.acquirente_telefono, g.stato, g.origine, g.creata_il, g.scade_il, g.lingua,
       (SELECT n.esito || '|' || n.canale FROM notifiche n WHERE n.prenotazione_id = g.id AND n.tipo = 'gift' ORDER BY n.id DESC LIMIT 1) AS notifica
     FROM gift_card g
     WHERE g.ristorante_id = ?2 AND g.stato <> 'in_attesa_pagamento' AND (?1 = '%%' OR g.codice LIKE ?1 ESCAPE '\\' OR g.acquirente_nome LIKE ?1 ESCAPE '\\' OR g.destinatario_nome LIKE ?1 ESCAPE '\\')
     ORDER BY g.creata_il DESC LIMIT 100`,
  )
    .bind(filtro, env.RID)
    .all();
  const imp = await leggiImpostazioni(env);
  const oggi = oraRoma().data;
  const giftCard = await Promise.all(
    results.map(async (g) => {
      const [esito, canale] = g.notifica ? g.notifica.split("|") : [];
      const valori = await valoriGift(env, imp, g, url.origin);
      return {
        ...g,
        scaduta: g.scade_il < oggi,
        notifica: g.notifica ? { esito, canale } : null,
        link: valori.link,
        messaggio: testoModello(imp, "messaggio_gift", linguaValida(g.lingua), valori),
      };
    }),
  );
  const [totali] = (
    await env.DB.prepare(
      "SELECT COUNT(*) AS emesse, COALESCE(SUM(importo), 0) AS venduto, COALESCE(SUM(CASE WHEN scade_il >= ? THEN saldo END), 0) AS da_spendere FROM gift_card WHERE ristorante_id = ? AND stato = 'attiva'",
    )
      .bind(oggi, env.RID)
      .all()
  ).results;
  return json({ gift_card: giftCard, totali, online: stripeAttivo(env) });
}

/** Il gestore emette una gift card venduta al banco: è subito attiva e il messaggio parte. */
export async function emettiGift(request, env) {
  const corpo = await leggiJson(request);
  const imp = await leggiImpostazioni(env);
  const importo = intero(corpo.importo, 1, 2000, "Importo in euro") * 100;
  const d = datiGift(corpo, "it", true);
  const id = crypto.randomUUID();
  const codice = await nuovoCodice(env);
  const adesso = new Date().toISOString();
  const lingua = LINGUE.includes(corpo.lingua) ? corpo.lingua : "it";
  const scade = corpo.scade_il && /^\d{4}-\d{2}-\d{2}$/.test(corpo.scade_il) ? corpo.scade_il : scadenzaMesi(imp.gift_validita_mesi);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO gift_card (id, codice, importo, saldo, acquirente_nome, acquirente_email, acquirente_telefono, destinatario_nome,
         destinatario_email, destinatario_telefono, messaggio, lingua, stato, origine, creata_il, attivata_il, scade_il, ristorante_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'attiva', 'gestore', ?, ?, ?, ?)`,
    ).bind(id, codice, importo, importo, d.acquirente_nome, d.acquirente_email, d.acquirente_telefono, d.destinatario_nome, d.destinatario_email,
      d.destinatario_telefono, d.messaggio, lingua, adesso, adesso, scade, env.RID),
    env.DB.prepare("INSERT INTO gift_card_movimenti (gift_card_id, importo, nota, creato_il) VALUES (?, ?, 'Venduta al ristorante', ?)").bind(id, importo, adesso),
  ]);
  const g = await env.DB.prepare("SELECT * FROM gift_card WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  await inviaGift(env, imp, g, new URL(request.url).origin);
  return json({ id, codice, link: await linkGift(env, new URL(request.url).origin, id, lingua) }, 201);
}

export async function dettaglioGift(env, id) {
  const [g, movimenti] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM gift_card WHERE id = ? AND ristorante_id = ?").bind(id, env.RID),
    env.DB.prepare("SELECT importo, nota, creato_il FROM gift_card_movimenti WHERE gift_card_id = ? ORDER BY id DESC").bind(id),
  ]);
  if (!g.results.length) throw new ErroreRichiesta("Gift card non trovata.", 404);
  return json({ gift_card: g.results[0], movimenti: movimenti.results });
}

/** Utilizzo al banco: scala l'importo dal saldo in un'unica istruzione, senza andare sotto zero. */
export async function usaGift(request, env, id) {
  const corpo = await leggiJson(request);
  const importo = Math.round(Number(String(corpo.importo ?? "").replace(",", ".")) * 100);
  if (!Number.isInteger(importo) || importo <= 0) throw new ErroreRichiesta("Scrivi l'importo da scalare, in euro.");
  const nota = testo(corpo.nota, 120, { campo: "La nota" });
  const g = await env.DB.prepare("SELECT stato, saldo, scade_il FROM gift_card WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  if (!g) throw new ErroreRichiesta("Gift card non trovata.", 404);
  if (g.stato !== "attiva") throw new ErroreRichiesta("Questa gift card non è attiva.", 409);
  if (g.scade_il < oraRoma().data) throw new ErroreRichiesta("Questa gift card è scaduta.", 409);
  const r = await env.DB.prepare("UPDATE gift_card SET saldo = saldo - ?1 WHERE id = ?2 AND stato = 'attiva' AND saldo >= ?1")
    .bind(importo, id)
    .run();
  if (!r.meta.changes) throw new ErroreRichiesta(`Il saldo è di ${formatoEuro("it", g.saldo)}: non basta per questo importo.`, 409);
  await env.DB.prepare("INSERT INTO gift_card_movimenti (gift_card_id, importo, nota, creato_il) VALUES (?, ?, ?, ?)")
    .bind(id, -importo, nota || "Utilizzo al ristorante", new Date().toISOString())
    .run();
  return dettaglioGift(env, id);
}

export async function annullaGift(env, id) {
  const r = await env.DB.prepare("UPDATE gift_card SET stato = 'annullata' WHERE id = ? AND ristorante_id = ? AND stato = 'attiva'").bind(id, env.RID).run();
  if (!r.meta.changes) throw new ErroreRichiesta("Gift card non trovata o già annullata.", 404);
  return dettaglioGift(env, id);
}

/** Cerca un codice detto dal cliente o letto dal QR: gift card o premio fedeltà. */
export async function cercaCodice(url, env) {
  const codice = (url.searchParams.get("c") ?? "").trim().toUpperCase();
  if (!CODICE.test(codice)) throw new ErroreRichiesta("Scrivi un codice come GC-ABC123 o PR-ABC123.");
  const oggi = oraRoma().data;
  if (codice.startsWith("GC-")) {
    const g = await env.DB.prepare("SELECT id, codice, importo, saldo, stato, scade_il, destinatario_nome FROM gift_card WHERE codice = ? AND ristorante_id = ?").bind(codice, env.RID).first();
    if (!g || g.stato === "in_attesa_pagamento") throw new ErroreRichiesta("Nessuna gift card con questo codice.", 404);
    return json({ tipo: "gift", ...g, scaduto: g.scade_il < oggi });
  }
  const p = await env.DB.prepare(
    "SELECT p.id, p.codice, p.descrizione, p.stato, p.scade_il, c.nome FROM premi p JOIN clienti c ON c.id = p.cliente_id WHERE p.codice = ? AND p.ristorante_id = ?",
  )
    .bind(codice, env.RID)
    .first();
  if (!p) throw new ErroreRichiesta("Nessun premio con questo codice.", 404);
  return json({ tipo: "premio", ...p, scaduto: p.scade_il < oggi });
}
