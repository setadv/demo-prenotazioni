import { inviaEmail } from "./notifiche.js";
import { operativo, predefinito, registra, ristorantePerId } from "./ristoranti.js";
import {
  ErroreRichiesta,
  base64url,
  emailValida,
  errore,
  hmac,
  impronta,
  json,
  leggiJson,
  limiteSuperato,
  registraTentativo,
  sha256,
  testo,
  tokenCasuale,
  uguali,
} from "./util.js";

export const RUOLI = ["titolare", "staff", "lettura"];
export const NOMI_RUOLI = { superadmin: "Amministratore piattaforma", titolare: "Titolare", staff: "Staff", lettura: "Sola lettura" };
const SESSIONE_ORE = 8;
const ITERAZIONI = 100000;
const encoder = new TextEncoder();

// ---------- Password ----------

async function derivata(password, sale, iterazioni) {
  const chiave = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sale, iterations: iterazioni }, chiave, 256));
}

const daBase64url = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function hashPassword(password) {
  const sale = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERAZIONI}$${base64url(sale)}$${base64url(await derivata(password, sale, ITERAZIONI))}`;
}

export async function passwordCorretta(password, salvata) {
  const [schema, iterazioni, sale, hash] = String(salvata ?? "").split("$");
  if (schema !== "pbkdf2" || !hash) return false;
  return uguali(await derivata(password, daBase64url(sale), Number(iterazioni)), daBase64url(hash));
}

export function passwordValida(p) {
  if (typeof p !== "string" || p.length < 10) throw new ErroreRichiesta("La password deve avere almeno 10 caratteri.");
  if (p.length > 200) throw new ErroreRichiesta("La password è troppo lunga.");
  return p;
}

// ---------- Sessioni ----------

const NOME_COOKIE = { gestione: "__Host-sessione", piattaforma: "__Host-piattaforma" };

export const cookieSessione = (tipo, valore, secondi) =>
  `${NOME_COOKIE[tipo]}=${valore}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${secondi}`;

/** Sessione firmata: chi è (utente), in quale ristorante, con quale ruolo, fino a quando. */
export async function creaSessione(env, tipo, dati) {
  const corpo = base64url(encoder.encode(JSON.stringify({ ...dati, t: tipo, e: Date.now() + SESSIONE_ORE * 3600000 })));
  return cookieSessione(tipo, `${corpo}.${base64url(await hmac(env.SESSION_SECRET, `${tipo}.${corpo}`))}`, SESSIONE_ORE * 3600);
}

export async function leggiSessione(request, env, tipo) {
  if (!env.SESSION_SECRET) return null;
  const valore = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${NOME_COOKIE[tipo]}=([^;]+)`))?.[1];
  const [corpo, firma] = (valore ?? "").split(".");
  if (!corpo || !firma) return null;
  if (!uguali(firma, base64url(await hmac(env.SESSION_SECRET, `${tipo}.${corpo}`)))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(daBase64url(corpo)));
    if (s.t !== tipo || !(s.e > Date.now())) return null;
    return s;
  } catch {
    return null;
  }
}

/** Una sessione resta valida solo finché l'utente esiste ed è attivo (si può revocare l'accesso subito). */
export async function verificaUtenteSessione(env, s) {
  if (!s.u) return { id: null, nome: s.n ?? "Accesso principale", email: "", ruolo: s.ruolo };
  const u = await env.DB.prepare("SELECT id, nome, email, ruolo, ristorante_id, attivo FROM utenti WHERE id = ?").bind(s.u).first();
  if (!u || !u.attivo) return null;
  if (s.a) return u.ruolo === "superadmin" ? { ...u, ruolo: "titolare" } : null;
  if (u.ristorante_id !== s.r || u.ruolo !== s.ruolo) return null;
  return u;
}

// ---------- Permessi del pannello del ristorante ----------

/** Operazioni riservate al titolare (lo staff vede e lavora sul servizio, ma non cambia la configurazione). */
const SOLO_TITOLARE = [
  ["PUT", /^\/api\/admin\/(configurazione|sala)$/],
  ["PUT", /^\/api\/admin\/moduli\//],
  ["GET", /^\/api\/admin\/clienti\.csv$/],
  [null, /^\/api\/admin\/media\//],
  [null, /^\/api\/admin\/utenti/],
  ["POST", /^\/api\/admin\/gift\/[^/]+\/annulla$/],
];

export function permesso(ruolo, metodo, percorso) {
  if (ruolo === "titolare") return true;
  const lettura = metodo === "GET" || metodo === "HEAD";
  if (/^\/api\/admin\/(sessione|logout|password)$/.test(percorso)) return true;
  if (ruolo === "lettura") return lettura && !/^\/api\/admin\/(clienti\.csv|utenti)/.test(percorso);
  if (ruolo === "staff") return !SOLO_TITOLARE.some(([m, re]) => (m === null || m === metodo) && re.test(percorso));
  return false;
}

// ---------- Inviti e reimpostazione della password ----------

/** Crea un link monouso per scegliere la password: valido 7 giorni per un invito, 2 ore per un recupero. */
export async function creaLinkAccesso(env, utente, tipo, origine) {
  const token = tokenCasuale();
  const adesso = new Date();
  const ore = tipo === "invito" ? 24 * 7 : 2;
  await env.DB.batch([
    env.DB.prepare("UPDATE token_accesso SET usato_il = ? WHERE utente_id = ? AND usato_il IS NULL").bind(adesso.toISOString(), utente.id),
    env.DB.prepare("INSERT INTO token_accesso (id, utente_id, tipo, token_hash, scade_il, creato_il) VALUES (?, ?, ?, ?, ?, ?)").bind(
      crypto.randomUUID(),
      utente.id,
      tipo,
      await sha256(token),
      new Date(adesso.getTime() + ore * 3600000).toISOString(),
      adesso.toISOString(),
    ),
  ]);
  const link = `${origine}/accesso#t=${token}`;
  let inviata = false;
  if (env.RESEND_API_KEY && env.EMAIL_MITTENTE) {
    const nomeRistorante = utente.ristorante_id ? (await ristorantePerId(env, utente.ristorante_id))?.nome : null;
    const dove = nomeRistorante ? `il pannello di ${nomeRistorante}` : "il pannello della piattaforma";
    const testoEmail =
      tipo === "invito"
        ? `Ciao${utente.nome ? ` ${utente.nome}` : ""},\n\nsei stato invitato a usare ${dove}.\nScegli la tua password da questo link (valido 7 giorni):\n${link}\n\nIl tuo nome utente è ${utente.email}.`
        : `Ciao${utente.nome ? ` ${utente.nome}` : ""},\n\nabbiamo ricevuto una richiesta per reimpostare la password di ${dove}.\nScegline una nuova da questo link (valido 2 ore):\n${link}\n\nSe non sei stato tu, ignora questa email: la password resta quella di prima.`;
    try {
      await inviaEmail(env, utente.email, tipo === "invito" ? "Il tuo accesso al pannello" : "Reimposta la password", testoEmail);
      inviata = true;
    } catch (e) {
      console.error("Email di accesso non inviata", e);
    }
  }
  return { link, inviata };
}

/** Pagina /accesso: chi apre il link sceglie la password. */
export async function impostaPassword(request, env) {
  const corpo = await leggiJson(request);
  const password = passwordValida(corpo.password);
  const t = typeof corpo.token === "string" ? corpo.token : "";
  const chiave = `accesso:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 10, 15)) return errore("Troppi tentativi. Riprova tra 15 minuti.", 429);
  const riga = t
    ? await env.DB.prepare(
        `SELECT k.id, k.tipo, k.scade_il, k.usato_il, u.id AS utente_id, u.email, u.ruolo, u.ristorante_id, u.attivo
         FROM token_accesso k JOIN utenti u ON u.id = k.utente_id WHERE k.token_hash = ?`,
      )
        .bind(await sha256(t))
        .first()
    : null;
  if (!riga || riga.usato_il || riga.scade_il < new Date().toISOString() || !riga.attivo) {
    await registraTentativo(env, chiave);
    return errore("Il link non è valido o è scaduto. Chiedi un nuovo invito o usa «Password dimenticata».", 400);
  }
  const usato = await env.DB.prepare("UPDATE token_accesso SET usato_il = ? WHERE id = ? AND usato_il IS NULL").bind(new Date().toISOString(), riga.id).run();
  if (!usato.meta.changes) return errore("Il link è già stato usato.", 400);
  await env.DB.prepare("UPDATE utenti SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), riga.utente_id).run();
  await registra(env, { ristorante: riga.ristorante_id, autore: riga.email, azione: riga.tipo === "invito" ? "account_attivato" : "password_reimpostata" });
  return json({ ok: true, email: riga.email, destinazione: riga.ruolo === "superadmin" ? "/piattaforma" : "/admin" });
}

/** «Password dimenticata»: risponde sempre allo stesso modo, così non rivela quali email esistono. */
export async function recuperaPassword(request, env) {
  const corpo = await leggiJson(request);
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const chiave = `recupero:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 5, 60)) return errore("Troppe richieste. Riprova più tardi.", 429);
  await registraTentativo(env, chiave);
  if (emailValida(email)) {
    const u = await env.DB.prepare("SELECT id, email, nome, ristorante_id FROM utenti WHERE email = ? AND attivo = 1").bind(email).first();
    if (u) await creaLinkAccesso(env, u, "reset", new URL(request.url).origin);
  }
  return json({ ok: true });
}

// ---------- Login ----------

async function controllaLimite(request, env) {
  const chiave = `login:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 5, 15)) throw new ErroreRichiesta("Troppi tentativi. Riprova tra 15 minuti.", 429);
  return chiave;
}

/** Accesso al pannello del ristorante: email e password, oppure la sola password principale per il ristorante predefinito. */
export async function loginGestione(request, env, ristoranteRichiesta) {
  if (!env.SESSION_SECRET) return errore("Accesso non configurato: mancano i secret dell'app.", 503);
  const corpo = await leggiJson(request);
  if (typeof corpo.password !== "string" || !corpo.password) return errore("Scrivi la password.");
  const chiave = await controllaLimite(request, env);
  const email = String(corpo.email ?? "").trim().toLowerCase();

  let utente = null;
  let ristorante = null;
  if (email) {
    const u = await env.DB.prepare("SELECT * FROM utenti WHERE email = ?").bind(email).first();
    if (u && u.attivo && u.password_hash && (await passwordCorretta(corpo.password, u.password_hash))) utente = u;
    if (utente?.ruolo === "superadmin") return errore("Questo è un account della piattaforma: accedi da /piattaforma.", 403);
    if (utente) ristorante = await ristorantePerId(env, utente.ristorante_id);
  } else if (env.ADMIN_PASSWORD && predefinito(env, ristoranteRichiesta)) {
    // Password principale: vale solo per il ristorante predefinito (la demo), come prima dell'arrivo degli account.
    const ok = uguali(await hmac(env.SESSION_SECRET, corpo.password), await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD));
    if (ok) ristorante = ristoranteRichiesta;
  }
  if (!ristorante) {
    await registraTentativo(env, chiave);
    return errore(email ? "Email o password errate." : "Password errata. Se hai un account, scrivi anche l'email.", 401);
  }
  if (ristorante.stato === "disattivato") return errore("Questo account è disattivato. Contatta l'assistenza.", 403);
  if (utente) {
    await env.DB.prepare("UPDATE utenti SET ultimo_accesso = ? WHERE id = ?").bind(new Date().toISOString(), utente.id).run();
  }
  const cookie = await creaSessione(env, "gestione", { u: utente?.id ?? null, r: ristorante.id, ruolo: utente?.ruolo ?? "titolare" });
  return json({ ok: true }, 200, { "set-cookie": cookie });
}

/** Accesso alla piattaforma: utenti superadmin, oppure SUPERADMIN_EMAIL con la password principale. */
export async function loginPiattaforma(request, env) {
  if (!env.SESSION_SECRET) return errore("Accesso non configurato: mancano i secret dell'app.", 503);
  const corpo = await leggiJson(request);
  const email = String(corpo.email ?? "").trim().toLowerCase();
  if (!email || typeof corpo.password !== "string" || !corpo.password) return errore("Scrivi email e password.");
  const chiave = await controllaLimite(request, env);
  let sessione = null;
  const u = await env.DB.prepare("SELECT * FROM utenti WHERE email = ? AND ruolo = 'superadmin'").bind(email).first();
  if (u && u.attivo && u.password_hash && (await passwordCorretta(corpo.password, u.password_hash))) {
    sessione = { u: u.id, n: u.nome || u.email };
    await env.DB.prepare("UPDATE utenti SET ultimo_accesso = ? WHERE id = ?").bind(new Date().toISOString(), u.id).run();
  } else if (
    env.SUPERADMIN_EMAIL &&
    env.ADMIN_PASSWORD &&
    email === env.SUPERADMIN_EMAIL.toLowerCase() &&
    uguali(await hmac(env.SESSION_SECRET, corpo.password), await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD))
  ) {
    sessione = { u: null, n: email };
  }
  if (!sessione) {
    await registraTentativo(env, chiave);
    return errore("Email o password errate.", 401);
  }
  return json({ ok: true }, 200, { "set-cookie": await creaSessione(env, "piattaforma", sessione) });
}

export async function sessionePiattaforma(request, env) {
  const s = await leggiSessione(request, env, "piattaforma");
  if (!s) return null;
  if (s.u) {
    const u = await env.DB.prepare("SELECT id, nome, email FROM utenti WHERE id = ? AND ruolo = 'superadmin' AND attivo = 1").bind(s.u).first();
    if (!u) return null;
    return { id: u.id, nome: u.nome || u.email, email: u.email };
  }
  return { id: null, nome: s.n, email: s.n };
}

// ---------- Utenti del ristorante (gestiti dal titolare) ----------

const pulisciUtente = (u) => ({
  id: u.id,
  email: u.email,
  nome: u.nome,
  ruolo: u.ruolo,
  attivo: Boolean(u.attivo),
  attivato: Boolean(u.password_hash),
  creato_il: u.creato_il,
  ultimo_accesso: u.ultimo_accesso,
});

export async function elencoUtenti(env, ristoranteId) {
  const { results } = await env.DB.prepare("SELECT * FROM utenti WHERE ristorante_id = ? ORDER BY ruolo = 'titolare' DESC, nome, email")
    .bind(ristoranteId)
    .all();
  return results.map(pulisciUtente);
}

/** Crea un utente e il suo invito. Usato dal titolare e dalla piattaforma. */
export async function creaUtente(env, { ristoranteId, email, nome, ruolo, origine, autore }) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!emailValida(e)) throw new ErroreRichiesta("Scrivi un'email valida.");
  const r = ruolo === "superadmin" && !ristoranteId ? "superadmin" : ruolo;
  if (r !== "superadmin" && !RUOLI.includes(r)) throw new ErroreRichiesta("Ruolo non valido.");
  const n = testo(nome, 80, { campo: "Il nome" });
  if (await env.DB.prepare("SELECT 1 FROM utenti WHERE email = ?").bind(e).first()) {
    throw new ErroreRichiesta("Esiste già un account con questa email. Ogni persona può appartenere a un solo ristorante.", 409);
  }
  const utente = { id: crypto.randomUUID(), email: e, nome: n, ruolo: r, ristorante_id: ristoranteId ?? null };
  await env.DB.prepare("INSERT INTO utenti (id, ristorante_id, email, nome, ruolo, attivo, creato_il) VALUES (?, ?, ?, ?, ?, 1, ?)")
    .bind(utente.id, utente.ristorante_id, e, n, r, new Date().toISOString())
    .run();
  const invito = await creaLinkAccesso(env, utente, "invito", origine);
  await registra(env, { ristorante: ristoranteId ?? null, autore, azione: "utente_creato", dettaglio: `${e} (${NOMI_RUOLI[r]})` });
  return { utente: { ...pulisciUtente({ ...utente, attivo: 1, creato_il: new Date().toISOString() }) }, ...invito };
}

/** Modifica ruolo o stato di un utente, evitando di lasciare il ristorante senza un titolare attivo. */
export async function modificaUtente(env, { ristoranteId, id, ruolo, attivo, autore, ioId = null }) {
  const u = await env.DB.prepare("SELECT * FROM utenti WHERE id = ? AND ristorante_id IS ?").bind(id, ristoranteId ?? null).first();
  if (!u) throw new ErroreRichiesta("Utente non trovato.", 404);
  const nuovoRuolo = ruolo === undefined ? u.ruolo : ruolo;
  if (u.ruolo !== "superadmin" && !RUOLI.includes(nuovoRuolo)) throw new ErroreRichiesta("Ruolo non valido.");
  if (u.ruolo === "superadmin" && nuovoRuolo !== "superadmin") throw new ErroreRichiesta("Ruolo non valido.");
  const nuovoAttivo = attivo === undefined ? u.attivo : attivo ? 1 : 0;
  if (ioId && id === ioId && (nuovoRuolo !== u.ruolo || !nuovoAttivo)) throw new ErroreRichiesta("Non puoi cambiare il tuo ruolo o disattivarti da solo.");
  const restaTitolare = u.ruolo !== "titolare" || (nuovoRuolo === "titolare" && nuovoAttivo);
  if (ristoranteId && !restaTitolare) {
    const altri = await env.DB.prepare("SELECT COUNT(*) AS n FROM utenti WHERE ristorante_id = ? AND ruolo = 'titolare' AND attivo = 1 AND id <> ?")
      .bind(ristoranteId, id)
      .first();
    if (!altri.n) throw new ErroreRichiesta("Serve almeno un titolare attivo: nomina prima un altro titolare.", 409);
  }
  await env.DB.prepare("UPDATE utenti SET ruolo = ?, attivo = ? WHERE id = ?").bind(nuovoRuolo, nuovoAttivo, id).run();
  await registra(env, {
    ristorante: ristoranteId ?? null,
    autore,
    azione: "utente_modificato",
    dettaglio: `${u.email}: ${NOMI_RUOLI[nuovoRuolo]}, ${nuovoAttivo ? "attivo" : "disattivato"}`,
  });
  return pulisciUtente({ ...u, ruolo: nuovoRuolo, attivo: nuovoAttivo });
}

export async function nuovoInvito(env, { ristoranteId, id, origine, autore }) {
  const u = await env.DB.prepare("SELECT * FROM utenti WHERE id = ? AND ristorante_id IS ? AND attivo = 1").bind(id, ristoranteId ?? null).first();
  if (!u) throw new ErroreRichiesta("Utente non trovato o disattivato.", 404);
  const invito = await creaLinkAccesso(env, u, u.password_hash ? "reset" : "invito", origine);
  await registra(env, { ristorante: ristoranteId ?? null, autore, azione: "invito_inviato", dettaglio: u.email });
  return invito;
}

/** Cambio password dal pannello, per chi ha già un account. */
export async function cambiaPassword(request, env, utente) {
  if (!utente.id) throw new ErroreRichiesta("Con l'accesso principale non c'è una password personale da cambiare.");
  const corpo = await leggiJson(request);
  const u = await env.DB.prepare("SELECT password_hash FROM utenti WHERE id = ?").bind(utente.id).first();
  if (!u?.password_hash || !(await passwordCorretta(String(corpo.attuale ?? ""), u.password_hash))) {
    throw new ErroreRichiesta("La password attuale non è corretta.", 401);
  }
  await env.DB.prepare("UPDATE utenti SET password_hash = ? WHERE id = ?").bind(await hashPassword(passwordValida(corpo.nuova)), utente.id).run();
  return json({ ok: true });
}

export { operativo };
