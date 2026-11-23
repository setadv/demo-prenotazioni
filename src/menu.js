import qrcode from "qrcode-generator";
import { ALTRE_LINGUE, LINGUE } from "./lingue.js";
import { ErroreRichiesta, intero, json, leggiImpostazioni, leggiJson, salvaImpostazione, testo } from "./util.js";
import { linkPubblico } from "./ristoranti.js";
import { tipoImmagine } from "./gestione.js";

/** I 14 allergeni da dichiarare secondo il Regolamento UE 1169/2011. */
export const ALLERGENI = [
  "glutine",
  "crostacei",
  "uova",
  "pesce",
  "arachidi",
  "soia",
  "latte",
  "frutta_guscio",
  "sedano",
  "senape",
  "sesamo",
  "solfiti",
  "lupini",
  "molluschi",
];
export const TAG = ["vegetariano", "vegano", "senza_glutine", "piccante", "novita"];

const ID = /^[A-Za-z0-9_-]{1,40}$/;

function leggiTraduzioni(valore) {
  try {
    const t = JSON.parse(valore || "{}");
    return t && typeof t === "object" && !Array.isArray(t) ? t : {};
  } catch {
    return {};
  }
}

async function caricaMenu(env) {
  const [categorie, piatti, foto] = await env.DB.batch([
    env.DB.prepare("SELECT id, nome, traduzioni FROM menu_categorie WHERE ristorante_id = ? ORDER BY ordine, nome").bind(env.RID),
    env.DB.prepare(
      "SELECT id, categoria_id, nome, descrizione, prezzo, allergeni, tag, traduzioni, disponibile, asporto FROM menu_piatti WHERE ristorante_id = ? ORDER BY ordine, nome",
    ).bind(env.RID),
    env.DB.prepare("SELECT piatto_id, aggiornato_il FROM menu_foto WHERE ristorante_id = ?").bind(env.RID),
  ]);
  // Versione della foto (data di caricamento) o null: senza foto la pagina non mostra nulla.
  const versioni = new Map(foto.results.map((f) => [f.piatto_id, f.aggiornato_il]));
  return categorie.results.map((c) => ({
    id: c.id,
    nome: c.nome,
    traduzioni: leggiTraduzioni(c.traduzioni),
    piatti: piatti.results
      .filter((p) => p.categoria_id === c.id)
      .map((p) => ({
        id: p.id,
        nome: p.nome,
        descrizione: p.descrizione,
        prezzo: p.prezzo,
        allergeni: p.allergeni ? p.allergeni.split(",") : [],
        tag: p.tag ? p.tag.split(",") : [],
        traduzioni: leggiTraduzioni(p.traduzioni),
        disponibile: Boolean(p.disponibile),
        asporto: Boolean(p.asporto),
        foto: versioni.get(p.id) ?? null,
      })),
  }));
}

const noteMenu = (imp) => Object.fromEntries(LINGUE.map((l) => [l, (l === "it" ? imp.menu_nota : imp[`menu_nota_${l}`]) ?? ""]));

/** Menù pubblico con tutte le traduzioni: la pagina cambia lingua senza ricaricare. */
export async function menuPubblico(url, env) {
  const imp = await leggiImpostazioni(env);
  const t = url.searchParams.get("t");
  let tavolo = null;
  if (t && ID.test(t)) {
    tavolo = (await env.DB.prepare("SELECT nome FROM tavoli WHERE id = ? AND ristorante_id = ? AND attivo = 1").bind(t, env.RID).first())?.nome ?? null;
  }
  const logo = await env.DB.prepare("SELECT aggiornato_il FROM media_r WHERE ristorante_id = ? AND chiave = 'logo'").bind(env.RID).first();
  const categorie = (await caricaMenu(env)).filter((c) => c.piatti.length);
  return json({
    ristorante: { nome: imp.nome, indirizzo: imp.indirizzo, telefono: imp.telefono, logo: logo?.aggiornato_il ?? null },
    nota: noteMenu(imp),
    tavolo,
    categorie,
  });
}

export async function leggiMenu(env) {
  const imp = await leggiImpostazioni(env);
  return json({ categorie: await caricaMenu(env), nota: noteMenu(imp), allergeni: ALLERGENI, tag: TAG });
}

function traduzioniValide(valore, campi) {
  const risultato = {};
  if (valore == null) return risultato;
  if (typeof valore !== "object" || Array.isArray(valore)) throw new ErroreRichiesta("Traduzioni non valide.");
  for (const lingua of ALTRE_LINGUE) {
    const voce = valore[lingua];
    if (!voce || typeof voce !== "object") continue;
    const pulita = {};
    for (const [campo, max] of campi) {
      const t = testo(voce[campo], max, { campo: `La traduzione (${lingua})` });
      if (t) pulita[campo] = t;
    }
    if (Object.keys(pulita).length) risultato[lingua] = pulita;
  }
  return risultato;
}

function prezzoValido(valore, nome) {
  if (valore === null || valore === undefined || valore === "") return null;
  return intero(valore, 0, 100000, `Prezzo di ${nome} (in centesimi)`);
}

/** Salva il menù intero: categorie, piatti, ordine e nota finale. Il pannello lo invia a ogni modifica. */
export async function salvaMenu(request, env) {
  const corpo = await leggiJson(request);
  if (!Array.isArray(corpo.categorie) || corpo.categorie.length > 30) throw new ErroreRichiesta("Puoi avere al massimo 30 categorie.");
  const categorie = [];
  const piatti = [];
  const idCategorie = new Set();
  const idPiatti = new Set();
  corpo.categorie.forEach((c, i) => {
    if (!ID.test(c.id ?? "") || idCategorie.has(c.id)) throw new ErroreRichiesta("Categoria non valida.");
    idCategorie.add(c.id);
    const nome = testo(c.nome, 60, { min: 1, campo: "Il nome della categoria" });
    categorie.push({ id: c.id, nome, ordine: i, traduzioni: traduzioniValide(c.traduzioni, [["nome", 60]]) });
    if (!Array.isArray(c.piatti)) throw new ErroreRichiesta(`Categoria ${nome}: piatti non validi.`);
    c.piatti.forEach((p, j) => {
      if (!ID.test(p.id ?? "") || idPiatti.has(p.id)) throw new ErroreRichiesta("Piatto non valido.");
      idPiatti.add(p.id);
      const nomePiatto = testo(p.nome, 80, { min: 1, campo: "Il nome del piatto" });
      const allergeni = Array.isArray(p.allergeni) ? [...new Set(p.allergeni)] : [];
      if (allergeni.some((a) => !ALLERGENI.includes(a))) throw new ErroreRichiesta(`${nomePiatto}: allergene non riconosciuto.`);
      const tag = Array.isArray(p.tag) ? [...new Set(p.tag)] : [];
      if (tag.some((t) => !TAG.includes(t))) throw new ErroreRichiesta(`${nomePiatto}: caratteristica non riconosciuta.`);
      piatti.push({
        id: p.id,
        categoria_id: c.id,
        nome: nomePiatto,
        descrizione: testo(p.descrizione, 300, { campo: `La descrizione di ${nomePiatto}` }),
        prezzo: prezzoValido(p.prezzo, nomePiatto),
        allergeni: ALLERGENI.filter((a) => allergeni.includes(a)).join(","),
        tag: TAG.filter((t) => tag.includes(t)).join(","),
        traduzioni: traduzioniValide(p.traduzioni, [["nome", 80], ["descrizione", 300]]),
        disponibile: p.disponibile === false ? 0 : 1,
        asporto: p.asporto === false ? 0 : 1,
        ordine: j,
      });
    });
  });
  if (piatti.length > 400) throw new ErroreRichiesta("Puoi avere al massimo 400 piatti.");

  const nota = corpo.nota ?? {};
  const note = LINGUE.map((l) => [l === "it" ? "menu_nota" : `menu_nota_${l}`, testo(nota[l], 300, { campo: "La nota del menù" })]);

  // Gli identificativi appartengono a un solo ristorante: quelli di un altro vengono rifiutati.
  const altrui = await env.DB.prepare(
    `SELECT id FROM menu_categorie WHERE ristorante_id <> ?1 AND id IN (SELECT value FROM json_each(?2))
     UNION SELECT id FROM menu_piatti WHERE ristorante_id <> ?1 AND id IN (SELECT value FROM json_each(?2)) LIMIT 1`,
  )
    .bind(env.RID, JSON.stringify([...categorie.map((c) => c.id), ...piatti.map((p) => p.id)]))
    .first();
  if (altrui) throw new ErroreRichiesta("Identificativo di categoria o piatto non valido. Ricarica la pagina.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM menu_piatti WHERE ristorante_id = ?").bind(env.RID),
    env.DB.prepare("DELETE FROM menu_categorie WHERE ristorante_id = ?").bind(env.RID),
    ...categorie.map((c) =>
      env.DB.prepare("INSERT INTO menu_categorie (id, nome, traduzioni, ordine, ristorante_id) VALUES (?, ?, ?, ?, ?)").bind(
        c.id,
        c.nome,
        JSON.stringify(c.traduzioni),
        c.ordine,
        env.RID,
      ),
    ),
    ...piatti.map((p) =>
      env.DB.prepare(
        `INSERT INTO menu_piatti (id, categoria_id, nome, descrizione, prezzo, allergeni, tag, traduzioni, disponibile, asporto, ordine, ristorante_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(p.id, p.categoria_id, p.nome, p.descrizione, p.prezzo, p.allergeni, p.tag, JSON.stringify(p.traduzioni), p.disponibile, p.asporto, p.ordine, env.RID),
    ),
    ...note.map(([k, v]) => salvaImpostazione(env, k, v)),
    // Le foto dei piatti eliminati non servono più.
    env.DB.prepare("DELETE FROM menu_foto WHERE ristorante_id = ? AND piatto_id NOT IN (SELECT value FROM json_each(?))").bind(
      env.RID,
      JSON.stringify(piatti.map((p) => p.id)),
    ),
  ]);
  return leggiMenu(env);
}

// ---------- Foto dei piatti ----------

/** Il pannello riduce la foto prima di caricarla: il limite lascia margine e tiene leggero il database. */
export const MAX_FOTO_PIATTO = 400 * 1024;

async function piattoEsistente(env, id) {
  if (!ID.test(id)) throw new ErroreRichiesta("Piatto non valido.", 404);
  const p = await env.DB.prepare("SELECT nome FROM menu_piatti WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  if (!p) throw new ErroreRichiesta("Piatto non trovato. Salva prima il piatto, poi aggiungi la foto.", 404);
}

export async function salvaFotoPiatto(request, env, id) {
  await piattoEsistente(env, id);
  const dati = new Uint8Array(await request.arrayBuffer());
  if (!dati.byteLength || dati.byteLength > MAX_FOTO_PIATTO) {
    throw new ErroreRichiesta(`Carica una foto fino a ${MAX_FOTO_PIATTO / 1024} KB.`, 413);
  }
  const tipo = tipoImmagine(dati);
  if (!tipo) throw new ErroreRichiesta("Carica una foto JPG, PNG o WebP.", 415);
  const aggiornato = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO menu_foto (ristorante_id, piatto_id, tipo, dati, aggiornato_il) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (ristorante_id, piatto_id) DO UPDATE SET tipo = ?3, dati = ?4, aggiornato_il = ?5`,
  )
    .bind(env.RID, id, tipo, dati.buffer, aggiornato)
    .run();
  return json({ ok: true, foto: aggiornato });
}

export async function eliminaFotoPiatto(env, id) {
  if (!ID.test(id)) throw new ErroreRichiesta("Piatto non valido.", 404);
  await env.DB.prepare("DELETE FROM menu_foto WHERE ristorante_id = ? AND piatto_id = ?").bind(env.RID, id).run();
  return json({ ok: true, foto: null });
}

/** Foto pubblica di un piatto. L'indirizzo contiene la versione (?v=), quindi si può tenere in cache a lungo. */
export async function mostraFotoPiatto(url, env, id) {
  if (!ID.test(id)) return new Response(null, { status: 404 });
  const f = await env.DB.prepare("SELECT tipo, dati FROM menu_foto WHERE ristorante_id = ? AND piatto_id = ?").bind(env.RID, id).first();
  if (!f) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(f.dati), {
    headers: {
      "content-type": f.tipo,
      "cache-control": url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

/**
 * QR code in SVG che apre il menù (anche di un tavolo) o la pagina di prenotazione di questo sito.
 * Codifica solo indirizzi del sito stesso, così non diventa un generatore di QR per altri.
 */
export async function qrCode(url, env) {
  const codiceBuono = url.searchParams.get("codice");
  if (codiceBuono) {
    // Il QR di un buono contiene solo il codice, da leggere alla cassa: non è un link.
    if (!/^(GC|PR)-[A-Z0-9]{6}$/.test(codiceBuono)) throw new ErroreRichiesta("Codice non valido.");
    return rispostaQr(codiceBuono, codiceBuono, url);
  }
  const PAGINE = { prenota: "/", ordina: "/ordina", regalo: "/regalo", menu: "/menu" };
  const pagina = PAGINE[url.searchParams.get("pagina")] ? url.searchParams.get("pagina") : "menu";
  const t = url.searchParams.get("t");
  let query = "";
  let nomeFile = `qr-${pagina}`;
  if (pagina === "menu" && t) {
    if (!ID.test(t)) throw new ErroreRichiesta("Tavolo non valido.");
    const tavolo = await env.DB.prepare("SELECT nome FROM tavoli WHERE id = ? AND ristorante_id = ? AND attivo = 1").bind(t, env.RID).first();
    if (!tavolo) throw new ErroreRichiesta("Tavolo non trovato.", 404);
    query = `t=${encodeURIComponent(t)}`;
    nomeFile += `-tavolo-${tavolo.nome.replace(/[^\w-]/g, "")}`;
  }
  return rispostaQr(linkPubblico(env, PAGINE[pagina], { query }), nomeFile, url);
}

function rispostaQr(destinazione, nomeFile, url) {
  const qr = qrcode(0, "M");
  qr.addData(destinazione);
  qr.make();
  const n = qr.getModuleCount();
  const margine = 4;
  let tracciato = "";
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) tracciato += `M${c + margine} ${r + margine}h1v1h-1z`;
    }
  }
  const lato = n + margine * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lato} ${lato}" shape-rendering="crispEdges" role="img"><title>${destinazione.replace(/&/g, "&amp;")}</title><rect width="${lato}" height="${lato}" fill="#fff"/><path d="${tracciato}" fill="#000"/></svg>`;
  const headers = {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  };
  if (url.searchParams.get("scarica") === "1") headers["content-disposition"] = `attachment; filename="${nomeFile}.svg"`;
  return new Response(svg, { headers });
}
