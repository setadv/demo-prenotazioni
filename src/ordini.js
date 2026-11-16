import { accreditaPunti, stornaPunti } from "./fidelity.js";
import { attivaGift } from "./buoni.js";
import { slotDelGiorno, trovaOCreaCliente } from "./disponibilita.js";
import { dataIn, erroreIn, linguaRichiesta, linguaValida, tipoOrdineIn } from "./lingue.js";
import { CANALI, consegna, formatoEuro, registraInvioManuale, testoModello, tokenPer, tokenPerValido } from "./notifiche.js";
import { creaPagamento, eventoStripe, stripeAttivo } from "./pagamenti.js";
import {
  ErroreRichiesta,
  codiceCasuale,
  dataValida,
  emailValida,
  giornoSettimana,
  impronta,
  json,
  leggiImpostazioni,
  leggiJson,
  limiteSuperato,
  normalizzaTelefono,
  oraRoma,
  registraTentativo,
  spostaData,
} from "./util.js";

export const STATI_ORDINE = ["in_attesa_pagamento", "nuovo", "in_preparazione", "pronto", "in_consegna", "completato", "annullato"];
const GIORNI_ORDINABILI = 7;
const capConsentiti = (imp) =>
  String(imp.consegna_cap ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

/** Ordini che occupano una fascia: tutti tranne gli annullati e i pagamenti online abbandonati da più di 30 minuti. */
const OCCUPA = `stato <> 'annullato' AND (stato <> 'in_attesa_pagamento' OR creato_il > ?)`;
const trentaMinutiFa = () => new Date(Date.now() - 30 * 60000).toISOString();

export async function linkOrdine(env, origine, id, lingua = "it") {
  const l = lingua !== "it" ? `&l=${lingua}` : "";
  return `${origine}/ordine#id=${id}&t=${await tokenPer(env, "ordine", id)}${l}`;
}

function metodiPagamento(env, imp) {
  return { alla_consegna: Boolean(imp.pagamento_alla_consegna), online: stripeAttivo(env) };
}

export async function infoOrdini(env) {
  const imp = await leggiImpostazioni(env);
  const pagamenti = metodiPagamento(env, imp);
  const attivi = Boolean(imp.ordini_attivi) && (imp.asporto_attivo || imp.consegna_attiva) && (pagamenti.alla_consegna || pagamenti.online);
  const oggi = oraRoma().data;
  const [orari, chiusure] = await env.DB.batch([
    env.DB.prepare("SELECT DISTINCT giorno FROM orari"),
    env.DB.prepare("SELECT data FROM chiusure WHERE data BETWEEN ? AND ?").bind(oggi, spostaData(oggi, GIORNI_ORDINABILI - 1)),
  ]);
  const aperti = new Set(orari.results.map((o) => o.giorno));
  const chiusi = new Set(chiusure.results.map((c) => c.data));
  const giorni = [];
  for (let i = 0; i < GIORNI_ORDINABILI; i += 1) {
    const d = spostaData(oggi, i);
    if (aperti.has(giornoSettimana(d)) && !chiusi.has(d)) giorni.push(d);
  }
  return json({
    attivi,
    asporto: Boolean(imp.asporto_attivo),
    consegna: Boolean(imp.consegna_attiva),
    preparazione: imp.ordini_preparazione,
    consegna_costo: imp.consegna_costo,
    consegna_minimo: imp.consegna_minimo,
    consegna_gratis_da: imp.consegna_gratis_da,
    cap: capConsentiti(imp),
    pagamenti,
    fidelity: Boolean(imp.fidelity_attiva),
    giorni,
    ristorante: { nome: imp.nome, indirizzo: imp.indirizzo, telefono: imp.telefono },
  });
}

/** Orari di ritiro o consegna ancora liberi: servizi del giorno, tempo di preparazione e ordini massimi per fascia. */
async function fasceLibere(env, imp, data) {
  const oggi = oraRoma();
  const distanza = Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${oggi.data}T00:00:00Z`)) / 86400000);
  if (distanza < 0 || distanza >= GIORNI_ORDINABILI) return [];
  const [chiusura, orari, occupate] = await env.DB.batch([
    env.DB.prepare("SELECT 1 FROM chiusure WHERE data = ?").bind(data),
    env.DB.prepare("SELECT servizio, inizio, fine FROM orari WHERE giorno = ? ORDER BY inizio").bind(giornoSettimana(data)),
    env.DB.prepare(`SELECT ora, COUNT(*) AS n FROM ordini WHERE data = ? AND ${OCCUPA} GROUP BY ora`).bind(data, trentaMinutiFa()),
  ]);
  if (chiusura.results.length) return [];
  const piene = new Map(occupate.results.map((o) => [o.ora, o.n]));
  const minimo = distanza === 0 ? oggi.minuti + imp.ordini_preparazione : -1;
  return slotDelGiorno(orari.results, imp.intervallo)
    .filter((s) => s.minuti >= minimo && (piene.get(s.ora) ?? 0) < imp.ordini_max_fascia)
    .map((s) => ({ ora: s.ora, servizio: s.servizio }));
}

export async function fasceOrdini(request, url, env) {
  const lingua = linguaRichiesta(request, url);
  const data = url.searchParams.get("data");
  if (!dataValida(data)) throw new ErroreRichiesta(erroreIn(lingua, "data"));
  return json({ data, fasce: await fasceLibere(env, await leggiImpostazioni(env), data) });
}

export async function nuovoOrdine(request, env) {
  const corpo = await leggiJson(request);
  if (corpo.sito) return json({ id: crypto.randomUUID(), codice: codiceCasuale(), token: "x", stato: "nuovo" }, 201);
  const lingua = linguaRichiesta(request, null, corpo);
  const errore = (chiave, valori, status = 400) => new ErroreRichiesta(erroreIn(lingua, chiave, valori), status);
  const imp = await leggiImpostazioni(env);
  const pagamenti = metodiPagamento(env, imp);
  if (!imp.ordini_attivi) throw errore("ordini_chiusi", {}, 409);
  const tipo = corpo.tipo === "consegna" ? "consegna" : "asporto";
  if ((tipo === "consegna" && !imp.consegna_attiva) || (tipo === "asporto" && !imp.asporto_attivo)) throw errore("tipo_ordine");

  const campo = (v, max, chiaveVuoto, min = 1) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (chiaveVuoto && t.length < min) throw errore(chiaveVuoto);
    if (t.length > max) throw errore("lungo");
    return t;
  };
  const nome = campo(corpo.nome, 80, "nome", 2);
  const telefono = campo(corpo.telefono, 30, "telefono");
  if (!normalizzaTelefono(telefono)) throw errore("telefono");
  const email = campo(corpo.email, 254);
  if (email && !emailValida(email)) throw errore("email");
  const note = campo(corpo.note, 300);
  const canale = CANALI.includes(corpo.canale) ? corpo.canale : email ? "email" : "sms";
  if (canale === "email" && !email) throw errore("email_canale");
  if (corpo.privacy !== true) throw errore("privacy");

  let indirizzo = "";
  let cap = "";
  if (tipo === "consegna") {
    indirizzo = campo(corpo.indirizzo, 160, "indirizzo", 5);
    cap = campo(corpo.cap, 5, "cap");
    if (!/^\d{5}$/.test(cap)) throw errore("cap");
    const consentiti = capConsentiti(imp);
    if (consentiti.length && !consentiti.includes(cap)) throw errore("cap_fuori");
  }

  if (!Array.isArray(corpo.righe) || !corpo.righe.length) throw errore("carrello_vuoto");
  if (corpo.righe.length > 50) throw errore("lungo");
  const ids = [...new Set(corpo.righe.map((r) => String(r.id ?? "")))];
  const { results: piatti } = await env.DB.prepare(
    `SELECT id, nome, prezzo FROM menu_piatti WHERE disponibile = 1 AND asporto = 1 AND prezzo IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all();
  const perId = new Map(piatti.map((p) => [p.id, p]));
  const quantita = new Map();
  for (const r of corpo.righe) {
    const p = perId.get(String(r.id));
    const q = Number(r.quantita);
    if (!p || !Number.isInteger(q) || q < 1 || q > 20) throw errore("piatto", {}, 409);
    quantita.set(p.id, (quantita.get(p.id) ?? 0) + q);
  }
  const righe = [...quantita].map(([id, q]) => ({ ...perId.get(id), quantita: Math.min(q, 50) }));
  const subtotale = righe.reduce((s, r) => s + r.prezzo * r.quantita, 0);
  let spese = 0;
  if (tipo === "consegna") {
    if (subtotale < imp.consegna_minimo) throw errore("minimo", { minimo: formatoEuro(lingua, imp.consegna_minimo) });
    spese = imp.consegna_gratis_da > 0 && subtotale >= imp.consegna_gratis_da ? 0 : imp.consegna_costo;
  }
  const totale = subtotale + spese;

  const pagamento = corpo.pagamento === "online" ? "online" : "alla_consegna";
  if (!pagamenti[pagamento]) throw errore("pagamento");
  if (!dataValida(corpo.data) || !(await fasceLibere(env, imp, corpo.data)).some((f) => f.ora === corpo.ora)) throw errore("fascia", {}, 409);

  const chiave = `ordine:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 10, 60)) throw errore("limite", {}, 429);

  const id = crypto.randomUUID();
  const codice = codiceCasuale();
  const adesso = new Date().toISOString();
  const clienteId = await trovaOCreaCliente(env, { nome, telefono, email, lingua, marketing: corpo.marketing === true, fidelity: corpo.fidelity === true });
  // Inserimento e controllo della fascia nella stessa istruzione: due ordini simultanei non superano il massimo.
  const inserito = await env.DB.prepare(
    `INSERT INTO ordini (id, codice, tipo, data, ora, nome, telefono, email, indirizzo, cap, note, subtotale, spese_consegna, totale,
       pagamento, pagato, stato, cliente_id, lingua, canale, creato_il, aggiornato_il)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, ?16, ?17, ?18, ?19, ?20, ?20
     WHERE (SELECT COUNT(*) FROM ordini WHERE data = ?4 AND ora = ?5 AND stato <> 'annullato'
            AND (stato <> 'in_attesa_pagamento' OR creato_il > ?21)) < ?22`,
  )
    .bind(id, codice, tipo, corpo.data, corpo.ora, nome, telefono, email, indirizzo, cap, note, subtotale, spese, totale, pagamento,
      pagamento === "online" ? "in_attesa_pagamento" : "nuovo", clienteId, lingua, canale, adesso, trentaMinutiFa(), imp.ordini_max_fascia)
    .run();
  if (!inserito.meta.changes) throw errore("fascia", {}, 409);
  await env.DB.batch(
    righe.map((r) =>
      env.DB.prepare("INSERT INTO ordini_righe (ordine_id, piatto_id, nome, prezzo, quantita) VALUES (?, ?, ?, ?, ?)").bind(id, r.id, r.nome, r.prezzo, r.quantita),
    ),
  );
  await registraTentativo(env, chiave);

  const origine = new URL(request.url).origin;
  const token = await tokenPer(env, "ordine", id);
  if (pagamento === "online") {
    try {
      const p = await creaPagamento(env, {
        descrizione: `${imp.nome}, ordine ${codice}`,
        importo: totale,
        email,
        lingua,
        successo: `${origine}/ordine?id=${id}&t=${token}&l=${lingua}`,
        annullato: `${origine}/ordina?lang=${lingua}`,
        metadati: { tipo: "ordine", id },
      });
      await env.DB.prepare("UPDATE ordini SET pagamento_id = ? WHERE id = ?").bind(p.id, id).run();
      return json({ id, codice, token, stato: "in_attesa_pagamento", url_pagamento: p.url }, 201);
    } catch (e) {
      await env.DB.prepare("UPDATE ordini SET stato = 'annullato' WHERE id = ?").bind(id).run();
      throw e;
    }
  }
  return json({ id, codice, token, stato: "nuovo", totale }, 201);
}

async function righeDi(env, ids) {
  if (!ids.length) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT r.ordine_id, r.nome, r.prezzo, r.quantita, m.traduzioni
     FROM ordini_righe r LEFT JOIN menu_piatti m ON m.id = r.piatto_id
     WHERE r.ordine_id IN (${ids.map(() => "?").join(",")}) ORDER BY r.id`,
  )
    .bind(...ids)
    .all();
  const mappa = new Map();
  for (const r of results) {
    if (!mappa.has(r.ordine_id)) mappa.set(r.ordine_id, []);
    let traduzioni = {};
    try {
      traduzioni = JSON.parse(r.traduzioni || "{}");
    } catch {}
    mappa.get(r.ordine_id).push({ nome: r.nome, prezzo: r.prezzo, quantita: r.quantita, traduzioni });
  }
  return mappa;
}

export async function leggiOrdine(request, env, id) {
  const lingua = linguaRichiesta(request);
  const token = request.headers.get("x-ordine-token") ?? "";
  if (!(await tokenPerValido(env, "ordine", id, token))) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
  const o = await env.DB.prepare(
    "SELECT codice, tipo, data, ora, nome, indirizzo, cap, note, subtotale, spese_consegna, totale, pagamento, pagato, stato, lingua FROM ordini WHERE id = ?",
  )
    .bind(id)
    .first();
  if (!o) throw new ErroreRichiesta(erroreIn(lingua, "non_trovato"), 404);
  const imp = await leggiImpostazioni(env);
  return json({ ...o, righe: (await righeDi(env, [id])).get(id) ?? [], ristorante: { nome: imp.nome, indirizzo: imp.indirizzo, telefono: imp.telefono } });
}

// ---------- Pannello ----------

async function valoriOrdine(env, imp, o, origine) {
  const lingua = linguaValida(o.lingua);
  return {
    nome: o.nome.split(" ")[0],
    codice: o.codice,
    ristorante: imp.nome,
    tipo: tipoOrdineIn(lingua, o.tipo),
    data: dataIn(lingua, o.data),
    ora: o.ora,
    totale: formatoEuro(lingua, o.totale),
    link: await linkOrdine(env, origine, o.id, lingua),
  };
}

export async function elencoOrdini(url, env) {
  const data = url.searchParams.get("data");
  if (!dataValida(data)) throw new ErroreRichiesta("Scegli una data valida.");
  const { results } = await env.DB.prepare(
    `SELECT o.*, (SELECT n.esito || '|' || n.canale FROM notifiche n WHERE n.prenotazione_id = o.id AND n.tipo = 'ordine' ORDER BY n.id DESC LIMIT 1) AS notifica
     FROM ordini o WHERE o.data = ? AND o.stato <> 'in_attesa_pagamento' ORDER BY o.ora, o.creato_il`,
  )
    .bind(data)
    .all();
  const righe = await righeDi(env, results.map((o) => o.id));
  const imp = await leggiImpostazioni(env);
  const ordini = await Promise.all(
    results.map(async (o) => {
      const [esito, canale] = o.notifica ? o.notifica.split("|") : [];
      return {
        ...o,
        pagato: Boolean(o.pagato),
        righe: righe.get(o.id) ?? [],
        notifica: o.notifica ? { esito, canale } : null,
        messaggio: testoModello(imp, "messaggio_ordine", linguaValida(o.lingua), await valoriOrdine(env, imp, o, url.origin)),
      };
    }),
  );
  return json({ data, ordini, pagamento_online: stripeAttivo(env) });
}

const PASSAGGI = {
  nuovo: ["in_preparazione", "annullato"],
  in_preparazione: ["pronto", "in_consegna", "annullato"],
  pronto: ["completato", "in_preparazione", "annullato"],
  in_consegna: ["completato", "in_preparazione", "annullato"],
  completato: ["pronto", "in_consegna"],
  annullato: ["nuovo"],
};

/** Cambio di stato dal pannello. All'accettazione parte la conferma; al completamento si accreditano i punti. */
export async function modificaOrdine(request, env, id, ctx) {
  const corpo = await leggiJson(request);
  const o = await env.DB.prepare("SELECT * FROM ordini WHERE id = ?").bind(id).first();
  if (!o) throw new ErroreRichiesta("Ordine non trovato.", 404);
  const stato = corpo.stato;
  if (!PASSAGGI[o.stato]?.includes(stato)) throw new ErroreRichiesta("Questo cambio di stato non è possibile.", 409);
  if (stato === "in_consegna" && o.tipo !== "consegna") throw new ErroreRichiesta("Solo gli ordini a domicilio vanno in consegna.", 409);
  if (stato === "pronto" && o.tipo !== "asporto") throw new ErroreRichiesta("Gli ordini a domicilio passano a In consegna.", 409);
  const r = await env.DB.prepare("UPDATE ordini SET stato = ?, aggiornato_il = ? WHERE id = ? AND stato = ?")
    .bind(stato, new Date().toISOString(), id, o.stato)
    .run();
  if (!r.meta.changes) throw new ErroreRichiesta("L'ordine è appena cambiato. Ricarica la pagina.", 409);
  const origine = new URL(request.url).origin;
  const imp = await leggiImpostazioni(env);
  const lavori = [];
  if (o.stato === "nuovo" && stato === "in_preparazione") {
    const gia = await env.DB.prepare("SELECT 1 FROM notifiche WHERE prenotazione_id = ? AND tipo = 'ordine' AND esito IN ('inviata', 'manuale')").bind(id).first();
    if (!gia) {
      const valori = await valoriOrdine(env, imp, o, origine);
      lavori.push(
        consegna(env, imp, {
          rif: id,
          tipo: "ordine",
          canale: o.canale,
          telefono: o.telefono,
          email: o.email,
          lingua: linguaValida(o.lingua),
          valori,
          testo: testoModello(imp, "messaggio_ordine", linguaValida(o.lingua), valori),
        }),
      );
    }
  }
  if (stato === "completato") {
    lavori.push(
      accreditaPunti(env, {
        clienteId: o.cliente_id,
        punti: Math.floor(o.subtotale / 100) * imp.punti_euro,
        motivo: `Ordine ${o.codice}`,
        riferimento: `ordine:${id}`,
        origine,
        canale: o.canale,
      }),
    );
  } else if (o.stato === "completato") lavori.push(stornaPunti(env, `ordine:${id}`));
  if (lavori.length) ctx.waitUntil(Promise.all(lavori));
  return json({ ok: true, stato, rimborso: stato === "annullato" && o.pagato ? "Ordine pagato online: fai il rimborso dalla dashboard di Stripe." : null });
}

export async function segnaPagato(request, env, id) {
  const corpo = await leggiJson(request);
  const r = await env.DB.prepare("UPDATE ordini SET pagato = ? WHERE id = ?").bind(corpo.pagato ? 1 : 0, id).run();
  if (!r.meta.changes) throw new ErroreRichiesta("Ordine non trovato.", 404);
  return json({ ok: true });
}

export async function notificaOrdineManuale(request, env, id) {
  const corpo = await leggiJson(request);
  if (!CANALI.includes(corpo.canale)) throw new ErroreRichiesta("Canale non valido.");
  await registraInvioManuale(env, id, corpo.canale, "ordine");
  return json({ ok: true });
}

/** Webhook di Stripe: attiva le gift card pagate e passa gli ordini pagati a Nuovo. */
export async function webhookStripe(request, env) {
  if (!stripeAttivo(env)) return new Response("Pagamenti non configurati", { status: 503 });
  const evento = await eventoStripe(request, env);
  if (!evento) return new Response("Firma non valida", { status: 400 });
  const sessione = evento.data?.object ?? {};
  const { tipo, id } = sessione.metadata ?? {};
  const origine = new URL(request.url).origin;
  if (evento.type === "checkout.session.completed" && sessione.payment_status === "paid") {
    if (tipo === "gift") await attivaGift(env, id, origine, sessione.id);
    if (tipo === "ordine") {
      await env.DB.prepare("UPDATE ordini SET pagato = 1, stato = 'nuovo', aggiornato_il = ? WHERE id = ? AND stato IN ('in_attesa_pagamento', 'annullato')")
        .bind(new Date().toISOString(), id)
        .run();
    }
  }
  if (evento.type === "checkout.session.expired" && tipo === "ordine") {
    await env.DB.prepare("UPDATE ordini SET stato = 'annullato', aggiornato_il = ? WHERE id = ? AND stato = 'in_attesa_pagamento'")
      .bind(new Date().toISOString(), id)
      .run();
  }
  return json({ ricevuto: true });
}

