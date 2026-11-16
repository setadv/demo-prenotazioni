import qrcode from "qrcode-generator";
import { ALTRE_LINGUE, LINGUE } from "./lingue.js";
import { ErroreRichiesta, intero, json, leggiImpostazioni, leggiJson, testo } from "./util.js";

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
  const [categorie, piatti] = await env.DB.batch([
    env.DB.prepare("SELECT id, nome, traduzioni FROM menu_categorie ORDER BY ordine, nome"),
    env.DB.prepare(
      "SELECT id, categoria_id, nome, descrizione, prezzo, allergeni, tag, traduzioni, disponibile FROM menu_piatti ORDER BY ordine, nome",
    ),
  ]);
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
    tavolo = (await env.DB.prepare("SELECT nome FROM tavoli WHERE id = ? AND attivo = 1").bind(t).first())?.nome ?? null;
  }
  const logo = await env.DB.prepare("SELECT aggiornato_il FROM media WHERE chiave = 'logo'").first();
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
        ordine: j,
      });
    });
  });
  if (piatti.length > 400) throw new ErroreRichiesta("Puoi avere al massimo 400 piatti.");

  const nota = corpo.nota ?? {};
  const note = LINGUE.map((l) => [l === "it" ? "menu_nota" : `menu_nota_${l}`, testo(nota[l], 300, { campo: "La nota del menù" })]);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM menu_piatti"),
    env.DB.prepare("DELETE FROM menu_categorie"),
    ...categorie.map((c) =>
      env.DB.prepare("INSERT INTO menu_categorie (id, nome, traduzioni, ordine) VALUES (?, ?, ?, ?)").bind(c.id, c.nome, JSON.stringify(c.traduzioni), c.ordine),
    ),
    ...piatti.map((p) =>
      env.DB.prepare(
        `INSERT INTO menu_piatti (id, categoria_id, nome, descrizione, prezzo, allergeni, tag, traduzioni, disponibile, ordine)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(p.id, p.categoria_id, p.nome, p.descrizione, p.prezzo, p.allergeni, p.tag, JSON.stringify(p.traduzioni), p.disponibile, p.ordine),
    ),
    ...note.map(([k, v]) =>
      env.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES (?1, ?2) ON CONFLICT (chiave) DO UPDATE SET valore = ?2").bind(k, v),
    ),
  ]);
  return leggiMenu(env);
}

/**
 * QR code in SVG che apre il menù (anche di un tavolo) o la pagina di prenotazione di questo sito.
 * Codifica solo indirizzi del sito stesso, così non diventa un generatore di QR per altri.
 */
export async function qrCode(url, env) {
  const pagina = url.searchParams.get("pagina") === "prenota" ? "prenota" : "menu";
  const t = url.searchParams.get("t");
  let destinazione = pagina === "prenota" ? `${url.origin}/` : `${url.origin}/menu`;
  let nomeFile = pagina === "prenota" ? "qr-prenota" : "qr-menu";
  if (pagina === "menu" && t) {
    if (!ID.test(t)) throw new ErroreRichiesta("Tavolo non valido.");
    const tavolo = await env.DB.prepare("SELECT nome FROM tavoli WHERE id = ? AND attivo = 1").bind(t).first();
    if (!tavolo) throw new ErroreRichiesta("Tavolo non trovato.", 404);
    destinazione += `?t=${encodeURIComponent(t)}`;
    nomeFile += `-tavolo-${tavolo.nome.replace(/[^\w-]/g, "")}`;
  }
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
