import { creaSessione, hashPassword, passwordValida } from "./accesso.js";
import { inviaEmail } from "./notifiche.js";
import { indirizzoRistorante, inserisciRistorante, slugLibero } from "./piattaforma.js";
import { MODULI, PIANI } from "./predefiniti.js";
import { registra, ristorantePerId } from "./ristoranti.js";
import { ErroreRichiesta, emailValida, errore, impronta, json, leggiJson, limiteSuperato, registraTentativo, testo } from "./util.js";

const giorniProva = (env) => {
  const n = Number(env.GIORNI_PROVA ?? 14);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : 14;
};
const aperte = (env) => String(env.ISCRIZIONI ?? "aperte").toLowerCase() !== "chiuse";

/** Dati per la pagina di iscrizione: piani (senza prezzi), prova gratuita e link ai termini. */
export function infoIscrizione(env) {
  return json({
    aperte: aperte(env),
    giorni_prova: giorniProva(env),
    piani: Object.fromEntries(Object.entries(PIANI).map(([k, p]) => [k, { nome: p.nome, moduli: p.moduli.map((m) => MODULI[m]) }])),
    termini: env.LINK_TERMINI || null,
    privacy: env.LINK_PRIVACY || null,
  });
}

/**
 * Iscrizione dal sito: crea il ristorante in prova con il piano scelto e l'account del titolare,
 * poi lo fa entrare subito nel pannello. Il super amministratore riceve un avviso.
 */
export async function iscriviRistorante(request, env, ctx) {
  if (!aperte(env)) return errore("Le iscrizioni sono chiuse. Scrivici per attivare il servizio.", 403);
  if (!env.SESSION_SECRET) return errore("Iscrizione non disponibile: mancano i secret dell'app.", 503);
  const corpo = await leggiJson(request);
  // Campo nascosto: lo riempiono solo i programmi automatici.
  if (corpo.sito) return json({ ok: true }, 201);
  const chiave = `iscrizione:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 3, 60)) return errore("Troppe iscrizioni da questa connessione. Riprova tra un'ora.", 429);

  const nomeLocale = testo(corpo.nome_locale, 80, { min: 2, campo: "Il nome del locale" });
  const nome = testo(corpo.nome, 80, { min: 2, campo: "Il tuo nome" });
  const email = String(corpo.email ?? "").trim().toLowerCase();
  if (!emailValida(email)) throw new ErroreRichiesta("Scrivi un'email valida.");
  const telefono = testo(corpo.telefono, 30, { campo: "Il telefono" });
  const password = passwordValida(corpo.password);
  if (corpo.consenso !== true) throw new ErroreRichiesta("Per continuare accetta le condizioni del servizio.");
  const piano = PIANI[corpo.piano] ? corpo.piano : "base";
  if (await env.DB.prepare("SELECT 1 FROM utenti WHERE email = ?").bind(email).first()) {
    throw new ErroreRichiesta("Esiste già un account con questa email. Accedi dal pannello o usa «Password dimenticata».", 409);
  }

  await registraTentativo(env, chiave);
  const giorni = giorniProva(env);
  const id = await inserisciRistorante(env, {
    slug: await slugLibero(env, nomeLocale),
    nome: nomeLocale,
    piano,
    moduli: PIANI[piano].moduli.join(","),
    giorniProva: giorni,
    prezzo: PIANI[piano].prezzo,
    contattoNome: nome,
    email,
    telefono,
    note: "Iscritto dal sito.",
  });
  const utenteId = crypto.randomUUID();
  const adesso = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO utenti (id, ristorante_id, email, nome, ruolo, password_hash, attivo, creato_il, ultimo_accesso) VALUES (?, ?, ?, ?, 'titolare', ?, 1, ?, ?)",
  )
    .bind(utenteId, id, email, nome, await hashPassword(password), adesso, adesso)
    .run();
  await registra(env, { ristorante: id, autore: email, azione: "iscrizione", dettaglio: `${nomeLocale}, piano ${PIANI[piano].nome}, prova ${giorni} giorni` });

  const r = await ristorantePerId(env, id);
  const origine = new URL(request.url).origin;
  const indirizzo = indirizzoRistorante(env, r, origine);
  ctx.waitUntil(avvisi(env, { r, nome, email, telefono, piano, giorni, origine, indirizzo }));
  const cookie = await creaSessione(env, "gestione", { u: utenteId, r: id, ruolo: "titolare" });
  return json({ ok: true, url: "/admin", indirizzo, prova_fino: r.prova_fino }, 201, { "set-cookie": cookie });
}

async function avvisi(env, { r, nome, email, telefono, piano, giorni, origine, indirizzo }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_MITTENTE) return;
  const invii = [
    inviaEmail(
      env,
      email,
      `Benvenuto: ${r.nome} è pronto`,
      `Ciao ${nome},\n\nil tuo ristorante è attivo in prova gratuita per ${giorni} giorni, fino al ${r.prova_fino}.\n\n` +
        `Pannello di gestione: ${origine}/admin (entra con ${email} e la password che hai scelto)\n` +
        `Pagina di prenotazione per i clienti: ${indirizzo}\n\n` +
        `Primi passi consigliati:\n1. Impostazioni: indirizzo, telefono, orari e chiusure\n2. Mappa tavoli: disegna la tua sala\n3. Menù: inserisci i piatti e stampa i QR per i tavoli\n\n` +
        `Rispondi a questa email per qualsiasi domanda.`,
    ),
  ];
  if (env.SUPERADMIN_EMAIL) {
    invii.push(
      inviaEmail(
        env,
        env.SUPERADMIN_EMAIL,
        `Nuova iscrizione: ${r.nome}`,
        `Nuovo ristorante iscritto dal sito.\n\nLocale: ${r.nome}\nPiano: ${PIANI[piano].nome}\nTitolare: ${nome}\nEmail: ${email}\nTelefono: ${telefono || "–"}\nProva fino al: ${r.prova_fino}\n\nScheda: ${origine}/piattaforma#ristorante/${r.id}`,
      ),
    );
  }
  const esiti = await Promise.allSettled(invii);
  for (const e of esiti) if (e.status === "rejected") console.error("Email di iscrizione non inviata", e.reason);
}
