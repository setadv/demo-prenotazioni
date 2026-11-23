import { ALTRE_LINGUE } from "./lingue.js";
import { ErroreRichiesta, json, leggiJson, testo } from "./util.js";

/** Modello di traduzione di Workers AI (binding AI in wrangler.jsonc). */
const MODELLO = "@cf/meta/m2m100-1.2b";
const CAMPI = { nome: 80, descrizione: 300 };

async function traduciUno(env, frase, lingua) {
  // Nei test locali un server finto prende il posto di Workers AI, come per email e SMS.
  if (env.TRADUZIONE_ENDPOINT) {
    const r = await fetch(env.TRADUZIONE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: frase, source_lang: "it", target_lang: lingua }),
    });
    if (!r.ok) throw new Error(`traduzione ${r.status}`);
    return (await r.json()).translated_text;
  }
  const r = await env.AI.run(MODELLO, { text: frase, source_lang: "it", target_lang: lingua });
  return r?.translated_text;
}

/**
 * Traduce dall'italiano nome e descrizione di un piatto o di una categoria nelle altre quattro lingue.
 * Non salva nulla: il pannello riempie i campi e il gestore rilegge prima di salvare.
 */
export async function traduciMenu(request, env) {
  if (!env.AI && !env.TRADUZIONE_ENDPOINT) throw new ErroreRichiesta("La traduzione automatica non è attiva su questo sito.", 503);
  const corpo = await leggiJson(request);
  const testi = {};
  for (const [campo, max] of Object.entries(CAMPI)) {
    const t = testo(corpo.testi?.[campo], max, { campo: campo === "nome" ? "Il nome" : "La descrizione" });
    if (t) testi[campo] = t;
  }
  if (!Object.keys(testi).length) throw new ErroreRichiesta("Scrivi prima il testo in italiano.");
  const lingue = Array.isArray(corpo.lingue) ? ALTRE_LINGUE.filter((l) => corpo.lingue.includes(l)) : ALTRE_LINGUE;
  if (!lingue.length) throw new ErroreRichiesta("Lingua non valida.");

  const lavori = lingue.flatMap((l) => Object.keys(testi).map((campo) => ({ l, campo })));
  let risultati;
  try {
    risultati = await Promise.all(lavori.map(({ l, campo }) => traduciUno(env, testi[campo], l)));
  } catch (e) {
    console.error("Traduzione non riuscita", e);
    throw new ErroreRichiesta("Il servizio di traduzione non risponde. Riprova tra poco.", 502);
  }
  const traduzioni = {};
  lavori.forEach(({ l, campo }, i) => {
    const t = String(risultati[i] ?? "").trim().slice(0, CAMPI[campo]);
    if (t) (traduzioni[l] ??= {})[campo] = t;
  });
  return json({ traduzioni });
}
