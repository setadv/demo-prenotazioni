import {
  agenda,
  eliminaMedia,
  invioManuale,
  mostraMedia,
  periodo,
  salvaMedia,
  leggiConfigurazione,
  leggiSala,
  modificaPrenotazione,
  nuovaPrenotazioneGestore,
  salvaConfigurazione,
  salvaSala,
  statistiche,
} from "./gestione.js";
import { annullaPrenotazione, disponibilita, infoRistorante, leggiPrenotazione, nuovaPrenotazione } from "./pubblico.js";
import { dettaglioCliente, elencoClienti, esportaClienti, modificaCliente } from "./clienti.js";
import { leggiMenu, menuPubblico, qrCode, salvaMenu } from "./menu.js";
import { elaboraRecensioni } from "./notifiche.js";
import { riceviWebhook, statoWhatsApp, verificaWebhook } from "./whatsapp.js";
import { acquistaGift, annullaGift, cercaCodice, dettaglioGift, elencoGift, emettiGift, infoGift, leggiBuono, usaGift } from "./buoni.js";
import { riepilogoFidelity, usaPremio } from "./fidelity.js";
import { leggiModuli, salvaModulo } from "./moduli.js";
import {
  elencoOrdini,
  fasceOrdini,
  infoOrdini,
  leggiOrdine,
  modificaOrdine,
  notificaOrdineManuale,
  nuovoOrdine,
  segnaPagato,
  webhookStripe,
} from "./ordini.js";
import { leggiSondaggio, rispondiSondaggio, risultatiSondaggi, segnaSondaggio } from "./sondaggi.js";
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

  // Il webhook di Meta arriva da un altro sito: è protetto dalla firma, non dal controllo di origine.
  if (p === "/api/whatsapp/webhook" && m === "GET") return verificaWebhook(url, env);
  if (p === "/api/whatsapp/webhook" && m === "POST") return riceviWebhook(request, env);
  if (p === "/api/stripe/webhook" && m === "POST") return webhookStripe(request, env);

  if (m !== "GET" && m !== "HEAD") {
    const origine = request.headers.get("origin");
    if (!origine || new URL(origine).host !== url.host) return errore("Origine non consentita.", 403);
  }

  if (p === "/api/ristorante" && m === "GET") return infoRistorante(env);
  if (p === "/api/disponibilita" && m === "GET") return disponibilita(request, url, env);
  if (p === "/api/menu" && m === "GET") return menuPubblico(url, env);
  if (p === "/api/qr" && m === "GET") return qrCode(url, env);
  if (p === "/api/ordini/info" && m === "GET") return infoOrdini(env);
  if (p === "/api/ordini/fasce" && m === "GET") return fasceOrdini(request, url, env);
  if (p === "/api/ordini" && m === "POST") return nuovoOrdine(request, env);
  const ordine = p.match(/^\/api\/ordini\/([0-9a-f-]{36})$/);
  if (ordine && m === "GET") return leggiOrdine(request, env, ordine[1]);
  if (p === "/api/gift" && m === "GET") return infoGift(env);
  if (p === "/api/gift" && m === "POST") return acquistaGift(request, env);
  const buono = p.match(/^\/api\/buoni\/(gift|premio)\/([0-9a-f-]{36})$/);
  if (buono && m === "GET") return leggiBuono(request, env, buono[1], buono[2]);
  const sondaggio = p.match(/^\/api\/sondaggio\/([0-9a-f-]{36})$/);
  if (sondaggio && m === "GET") return leggiSondaggio(request, env, sondaggio[1]);
  if (sondaggio && m === "POST") return rispondiSondaggio(request, env, sondaggio[1]);
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
    if (p === "/api/admin/agenda" && m === "GET") return agenda(url, env, ctx);
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
    if (p === "/api/admin/clienti.csv" && m === "GET") return esportaClienti(url, env);
    const cliente = p.match(/^\/api\/admin\/clienti\/([0-9a-f-]{36})$/);
    if (cliente && m === "GET") return dettaglioCliente(env, cliente[1]);
    if (cliente && m === "PATCH") return modificaCliente(request, env, cliente[1]);
    if (p === "/api/admin/menu" && m === "GET") return leggiMenu(env);
    if (p === "/api/admin/menu" && m === "PUT") return salvaMenu(request, env);
    if (p === "/api/admin/whatsapp" && m === "GET") return statoWhatsApp(url, env);
    if (p === "/api/admin/moduli" && m === "GET") return leggiModuli(env);
    const modulo = p.match(/^\/api\/admin\/moduli\/(fidelity|gift|sondaggio|ordini)$/);
    if (modulo && m === "PUT") return salvaModulo(request, env, modulo[1]);
    if (p === "/api/admin/ordini" && m === "GET") return elencoOrdini(url, env);
    const ordineAdmin = p.match(/^\/api\/admin\/ordini\/([0-9a-f-]{36})(\/notifica|\/pagato)?$/);
    if (ordineAdmin && !ordineAdmin[2] && m === "PATCH") return modificaOrdine(request, env, ordineAdmin[1], ctx);
    if (ordineAdmin && ordineAdmin[2] === "/notifica" && m === "POST") return notificaOrdineManuale(request, env, ordineAdmin[1]);
    if (ordineAdmin && ordineAdmin[2] === "/pagato" && m === "PATCH") return segnaPagato(request, env, ordineAdmin[1]);
    if (p === "/api/admin/fidelity" && m === "GET") return riepilogoFidelity(url, env);
    const premio = p.match(/^\/api\/admin\/premi\/([0-9a-f-]{36})\/usa$/);
    if (premio && m === "POST") return usaPremio(env, premio[1]);
    if (p === "/api/admin/gift" && m === "GET") return elencoGift(url, env);
    if (p === "/api/admin/gift" && m === "POST") return emettiGift(request, env);
    const gift = p.match(/^\/api\/admin\/gift\/([0-9a-f-]{36})(\/usa|\/annulla)?$/);
    if (gift && !gift[2] && m === "GET") return dettaglioGift(env, gift[1]);
    if (gift && gift[2] === "/usa" && m === "POST") return usaGift(request, env, gift[1]);
    if (gift && gift[2] === "/annulla" && m === "POST") return annullaGift(env, gift[1]);
    if (p === "/api/admin/codice" && m === "GET") return cercaCodice(url, env);
    if (p === "/api/admin/sondaggi" && m === "GET") return risultatiSondaggi(url, env);
    const risposta = p.match(/^\/api\/admin\/sondaggi\/([0-9a-f-]{36})$/);
    if (risposta && m === "PATCH") return segnaSondaggio(request, env, risposta[1]);
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

  /** Cron Trigger: ogni 15 minuti invia le richieste di recensione maturate. */
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(elaboraRecensioni(env));
  },
};
