import {
  agenda,
  eliminaMedia,
  elencoClienti,
  invioManuale,
  mostraMedia,
  periodo,
  salvaMedia,
  leggiConfigurazione,
  leggiSala,
  modificaCliente,
  modificaPrenotazione,
  nuovaPrenotazioneGestore,
  salvaConfigurazione,
  salvaSala,
  statistiche,
} from "./gestione.js";
import { annullaPrenotazione, disponibilita, infoRistorante, leggiPrenotazione, nuovaPrenotazione } from "./pubblico.js";
import {
  ErroreRichiesta,
  base64url,
  errore,
  hmac,
  impronta,
  json,
  leggiImpostazioni,
  leggiJson,
  limiteSuperato,
  registraTentativo,
  uguali,
} from "./util.js";

const SESSIONE_ORE = 8;

async function creaToken(env) {
  const scadenza = String(Date.now() + SESSIONE_ORE * 3600000);
  return `${scadenza}.${base64url(await hmac(env.SESSION_SECRET, scadenza))}`;
}

async function autenticato(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie.match(/(?:^|;\s*)__Host-sessione=([^;]+)/)?.[1];
  if (!token) return false;
  const [scadenza, firma] = token.split(".");
  if (!/^\d+$/.test(scadenza ?? "") || !firma || Number(scadenza) < Date.now()) return false;
  return uguali(firma, base64url(await hmac(env.SESSION_SECRET, scadenza)));
}

const cookieSessione = (valore, secondi) =>
  `__Host-sessione=${valore}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${secondi}`;

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return errore("Accesso non configurato: mancano i secret dell'app.", 503);
  const corpo = await leggiJson(request);
  if (typeof corpo.password !== "string") return errore("Scrivi la password.");
  const chiave = `login:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 5, 15)) return errore("Troppi tentativi. Riprova tra 15 minuti.", 429);
  const corretta = uguali(await hmac(env.SESSION_SECRET, corpo.password), await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD));
  if (!corretta) {
    await registraTentativo(env, chiave);
    return errore("Password errata.", 401);
  }
  return json({ ok: true }, 200, { "set-cookie": cookieSessione(await creaToken(env), SESSIONE_ORE * 3600) });
}

async function gestisciApi(request, env, url, ctx) {
  const { pathname: p } = url;
  const m = request.method;

  if (m !== "GET" && m !== "HEAD") {
    const origine = request.headers.get("origin");
    if (!origine || new URL(origine).host !== url.host) return errore("Origine non consentita.", 403);
  }

  if (p === "/api/ristorante" && m === "GET") return infoRistorante(env);
  if (p === "/api/disponibilita" && m === "GET") return disponibilita(url, env);
  if (p === "/api/prenotazioni" && m === "POST") return nuovaPrenotazione(request, env, ctx);
  const media = p.match(/^\/api\/media\/(logo|foto)$/);
  if (media && m === "GET") return mostraMedia(env, media[1]);
  const pubblica = p.match(/^\/api\/prenotazioni\/([0-9a-f-]{36})(\/annulla)?$/);
  if (pubblica && m === "GET" && !pubblica[2]) return leggiPrenotazione(request, env, pubblica[1]);
  if (pubblica && m === "POST" && pubblica[2]) return annullaPrenotazione(request, env, pubblica[1]);
  if (p === "/api/admin/login" && m === "POST") return login(request, env);

  if (p.startsWith("/api/admin/")) {
    if (!(await autenticato(request, env))) return errore("Accedi per continuare.", 401);
    if (p === "/api/admin/sessione" && m === "GET") {
      const imp = await leggiImpostazioni(env);
      return json({ ok: true, ambiente: env.APP_ENV, nome: imp.nome });
    }
    if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": cookieSessione("", 0) });
    if (p === "/api/admin/agenda" && m === "GET") return agenda(url, env);
    if (p === "/api/admin/periodo" && m === "GET") return periodo(url, env);
    if (p === "/api/admin/prenotazioni" && m === "POST") return nuovaPrenotazioneGestore(request, env, ctx);
    const pren = p.match(/^\/api\/admin\/prenotazioni\/([0-9a-f-]{36})(\/notifica)?$/);
    if (pren && !pren[2] && m === "PATCH") return modificaPrenotazione(request, env, pren[1], ctx);
    if (pren && pren[2] && m === "POST") return invioManuale(request, env, pren[1]);
    if (p === "/api/admin/sala" && m === "GET") return leggiSala(env);
    if (p === "/api/admin/sala" && m === "PUT") return salvaSala(request, env);
    if (p === "/api/admin/configurazione" && m === "GET") return leggiConfigurazione(env);
    if (p === "/api/admin/configurazione" && m === "PUT") return salvaConfigurazione(request, env);
    if (p === "/api/admin/clienti" && m === "GET") return elencoClienti(url, env);
    const cliente = p.match(/^\/api\/admin\/clienti\/([0-9a-f-]{36})$/);
    if (cliente && m === "PATCH") return modificaCliente(request, env, cliente[1]);
    if (p === "/api/admin/statistiche" && m === "GET") return statistiche(url, env);
    const mediaAdmin = p.match(/^\/api\/admin\/media\/(logo|foto)$/);
    if (mediaAdmin && m === "PUT") return salvaMedia(request, env, mediaAdmin[1]);
    if (mediaAdmin && m === "DELETE") return eliminaMedia(env, mediaAdmin[1]);
  }
  return errore("Percorso non trovato.", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await gestisciApi(request, env, url, ctx);
    } catch (e) {
      if (e instanceof ErroreRichiesta) return errore(e.message, e.status);
      console.error(e);
      return errore("Si è verificato un errore. Riprova tra poco.", 500);
    }
  },
};
