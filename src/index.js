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
  novita,
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
import { ErroreRichiesta, errore, json, leggiImpostazioni } from "./util.js";
import {
  cambiaPassword,
  cookieSessione,
  creaSessione,
  creaUtente,
  elencoUtenti,
  impostaPassword,
  leggiSessione,
  loginGestione,
  loginPiattaforma,
  modificaUtente,
  nuovoInvito,
  permesso,
  recuperaPassword,
  sessionePiattaforma,
  verificaUtenteSessione,
} from "./accesso.js";
import {
  cambiaStato,
  creaRistorante,
  dettaglioRistorante,
  elencoAmministratori,
  elencoRistoranti,
  eliminaRistorante,
  esportaRistorante,
  indirizzoRistorante,
  invitoAmministratore,
  invitoUtenteRistorante,
  modificaAmministratore,
  modificaRistorante,
  modificaUtenteRistorante,
  nuovoAmministratore,
  nuovoUtenteRistorante,
  registroCompleto,
  riepilogo,
  salvaIntegrazioni,
} from "./piattaforma.js";
import {
  SLUG,
  contesto,
  operativo,
  registra,
  ristorantePerId,
  ristorantePerSlug,
  ristoranteRichiesta,
  slugRichiesta,
  statoEffettivo,
} from "./ristoranti.js";
import { MODULI, PIANI } from "./predefiniti.js";
import { infoIscrizione, iscriviRistorante } from "./iscrizione.js";

const ID = "[0-9a-f-]{36}";

/** Ristorante dei percorsi con link personale: lo indica il record stesso, non l'indirizzo. */
const TABELLA_DEL_LINK = [
  [new RegExp(`^/api/prenotazioni/(${ID})(?:/annulla)?$`), "prenotazioni_v2"],
  [new RegExp(`^/api/sondaggio/(${ID})$`), "prenotazioni_v2"],
  [new RegExp(`^/api/ordini/(${ID})$`), "ordini"],
  [new RegExp(`^/api/buoni/gift/(${ID})$`), "gift_card"],
  [new RegExp(`^/api/buoni/premio/(${ID})$`), "premi"],
];

async function ristoranteDelLink(env, percorso) {
  for (const [re, tabella] of TABELLA_DEL_LINK) {
    const m = percorso.match(re);
    if (m) {
      const riga = await env.DB.prepare(`SELECT ristorante_id FROM ${tabella} WHERE id = ?`).bind(m[1]).first();
      return riga ? ristorantePerId(env, riga.ristorante_id) : null;
    }
  }
  return undefined;
}

/** Ristorante delle pagine pubbliche: sottodominio, ?r=, header, ristorante di chi è collegato, cookie, predefinito. */
async function ristorantePubblico(request, url, env) {
  const base = String(env.DOMINIO_BASE ?? "").toLowerCase();
  const daIndirizzo = (base && url.hostname.toLowerCase().endsWith(`.${base}`)) || url.searchParams.get("r") || request.headers.get("x-ristorante");
  if (!daIndirizzo) {
    const s = await leggiSessione(request, env, "gestione");
    if (s) return ristorantePerId(env, s.r);
  }
  return ristoranteRichiesta(request, url, env);
}

async function gestisciApi(request, env, url, ctx) {
  const { pathname: p } = url;
  const m = request.method;
  const origine = url.origin;

  // Webhook da altri siti: protetti dalla firma, non dal controllo di origine. Ogni ristorante ha il suo indirizzo.
  const wa = p.match(/^\/api\/whatsapp\/webhook(?:\/([a-z0-9-]{1,40}))?$/);
  if (wa) {
    const r = wa[1] ? await ristorantePerSlug(env, wa[1]) : await ristoranteRichiesta(request, new URL(origine), env);
    if (!r) return new Response("Ristorante non trovato", { status: 404 });
    const c = await contesto(env, r, origine);
    if (m === "GET") return verificaWebhook(url, c);
    if (m === "POST") return riceviWebhook(request, c);
  }
  const st = p.match(/^\/api\/stripe\/webhook(?:\/([0-9a-f-]{36}|demo))?$/);
  if (st && m === "POST") {
    const r = st[1] ? await ristorantePerId(env, st[1]) : await ristoranteRichiesta(request, new URL(origine), env);
    if (!r) return new Response("Ristorante non trovato", { status: 404 });
    return webhookStripe(request, await contesto(env, r, origine));
  }

  if (m !== "GET" && m !== "HEAD") {
    const o = request.headers.get("origin");
    if (!o || new URL(o).host !== url.host) return errore("Origine non consentita.", 403);
  }

  // Account: scelta della password e recupero.
  if (p === "/api/accesso/imposta" && m === "POST") return impostaPassword(request, env);
  if (p === "/api/accesso/recupera" && m === "POST") return recuperaPassword(request, env);
  if (p === "/api/registrati" && m === "GET") return infoIscrizione(env);
  if (p === "/api/registrati" && m === "POST") return iscriviRistorante(request, env, ctx);

  if (p.startsWith("/api/piattaforma/")) return apiPiattaforma(request, env, url);

  if (p === "/api/admin/login" && m === "POST") return loginGestione(request, env, await ristoranteRichiesta(request, url, env));
  if (p.startsWith("/api/admin/")) return apiGestione(request, env, url, ctx);

  // Pagine pubbliche del ristorante.
  let r = await ristoranteDelLink(env, p);
  const conLink = r !== undefined;
  if (!r) r = await ristorantePubblico(request, url, env);
  if (!r || r.stato === "disattivato") return errore("Ristorante non trovato.", 404);
  // Un ristorante sospeso non riceve prenotazioni né ordini; chi ha un link personale può ancora consultarlo.
  if (!operativo(r) && !(conLink && m === "GET") && !p.startsWith("/api/media/")) {
    return errore("Le prenotazioni online di questo ristorante non sono disponibili al momento. Contatta direttamente il locale.", 503, {
      sospeso: true,
    });
  }
  const env2 = await contesto(env, r, origine);
  return apiPubblica(request, env2, url, ctx);
}

async function apiPubblica(request, env, url, ctx) {
  const { pathname: p } = url;
  const m = request.method;
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
  return errore("Percorso non trovato.", 404);
}

/** Pannello del ristorante: il ristorante è quello della sessione, mai quello dell'indirizzo. */
async function apiGestione(request, env, url, ctx) {
  const { pathname: p } = url;
  const m = request.method;
  const s = await leggiSessione(request, env, "gestione");
  const esci = { "set-cookie": cookieSessione("gestione", "", 0) };
  if (!s) return errore("Accedi per continuare.", 401);
  const utente = await verificaUtenteSessione(env, s);
  const r = utente ? await ristorantePerId(env, s.r) : null;
  if (!utente || !r) return errore("Accedi per continuare.", 401, {}, esci);
  if (r.stato === "disattivato" && !s.a) return json({ errore: "Questo account è disattivato. Contatta l'assistenza." }, 403, esci);
  if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, esci);
  const ruolo = s.a ? "titolare" : s.ruolo;
  if (!permesso(ruolo, m, p)) return errore("Il tuo ruolo non permette questa operazione. Chiedi al titolare.", 403);
  // Account sospeso o prova finita: si può consultare tutto ma non modificare (l'assistenza sì).
  const sola = !operativo(r) && !s.a;
  if (sola && m !== "GET" && m !== "HEAD" && p !== "/api/admin/password") {
    return errore("L'account è sospeso: puoi consultare i dati ma non modificarli. Contatta l'assistenza per riattivarlo.", 403);
  }
  const env2 = await contesto(env, r, url.origin);
  const autore = s.a ? `Assistenza (${utente.nome || utente.email})` : utente.email || utente.nome;

  if (p === "/api/admin/sessione" && m === "GET") {
    const imp = await leggiImpostazioni(env2);
    return json({
      ok: true,
      ambiente: env.APP_ENV,
      nome: imp.nome,
      utente: { id: utente.id, nome: utente.nome, email: utente.email, ruolo },
      assistenza: Boolean(s.a),
      ristorante: {
        slug: r.slug,
        stato: statoEffettivo(r),
        motivo: r.motivo_sospensione,
        prova_fino: r.prova_fino,
        piano: PIANI[r.piano]?.nome ?? r.piano,
        moduli: [...env2.MODULI],
        indirizzo: indirizzoRistorante(env, r, url.origin),
      },
    });
  }
  if (p === "/api/admin/password" && m === "POST") return cambiaPassword(request, env, utente);
  if (p === "/api/admin/utenti" && m === "GET") return json({ utenti: await elencoUtenti(env, r.id), io: utente.id });
  if (p === "/api/admin/utenti" && m === "POST") {
    const corpo = await request.json().catch(() => ({}));
    const esito = await creaUtente(env, { ristoranteId: r.id, email: corpo.email, nome: corpo.nome, ruolo: corpo.ruolo, origine: url.origin, autore });
    return json(esito, 201);
  }
  const ut = p.match(/^\/api\/admin\/utenti\/([0-9a-f-]{36})(\/invito)?$/);
  if (ut && !ut[2] && m === "PATCH") {
    const corpo = await request.json().catch(() => ({}));
    return json({ utente: await modificaUtente(env, { ristoranteId: r.id, id: ut[1], ruolo: corpo.ruolo, attivo: corpo.attivo, autore, ioId: utente.id }) });
  }
  if (ut && ut[2] && m === "POST") return json(await nuovoInvito(env, { ristoranteId: r.id, id: ut[1], origine: url.origin, autore }));
  return rotteGestione(request, env2, url, ctx, p, m);
}

async function rotteGestione(request, env, url, ctx, p, m) {
  if (p === "/api/admin/agenda" && m === "GET") return agenda(url, env, ctx);
  if (p === "/api/admin/periodo" && m === "GET") return periodo(url, env);
  if (p === "/api/admin/novita" && m === "GET") return novita(url, env);
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
  return errore("Percorso non trovato.", 404);
}

/** Pannello della piattaforma (super amministratore). */
async function apiPiattaforma(request, env, url) {
  const { pathname: p } = url;
  const m = request.method;
  if (p === "/api/piattaforma/login" && m === "POST") return loginPiattaforma(request, env);
  const esci = { "set-cookie": cookieSessione("piattaforma", "", 0) };
  if (p === "/api/piattaforma/logout" && m === "POST") return json({ ok: true }, 200, esci);
  const chi = await sessionePiattaforma(request, env);
  if (!chi) return json({ errore: "Accedi per continuare." }, 401, esci);

  if (p === "/api/piattaforma/sessione" && m === "GET") {
    return json({ ok: true, ambiente: env.APP_ENV, utente: chi, dominio: env.DOMINIO_BASE ?? null, piani: PIANI, moduli: MODULI });
  }
  if (p === "/api/piattaforma/riepilogo" && m === "GET") return riepilogo(env);
  if (p === "/api/piattaforma/registro" && m === "GET") return registroCompleto(url, env);
  if (p === "/api/piattaforma/ristoranti" && m === "GET") return elencoRistoranti(url, env);
  if (p === "/api/piattaforma/ristoranti" && m === "POST") return creaRistorante(request, env, chi);
  const rist = p.match(/^\/api\/piattaforma\/ristoranti\/([0-9a-f-]{36}|demo)(\/[a-z]+)?(?:\/([0-9a-f-]{36})(\/invito)?)?$/);
  if (rist) {
    const [, id, azione, utenteId, invito] = rist;
    if (!azione && m === "GET") return dettaglioRistorante(request, env, id);
    if (!azione && m === "PATCH") return modificaRistorante(request, env, id, chi);
    if (!azione && m === "DELETE") return eliminaRistorante(request, env, id, chi);
    if (azione === "/stato" && m === "POST") return cambiaStato(request, env, id, chi);
    if (azione === "/integrazioni" && m === "PUT") return salvaIntegrazioni(request, env, id, chi);
    if (azione === "/esporta" && m === "GET") return esportaRistorante(env, id, chi);
    if (azione === "/utenti" && !utenteId && m === "POST") return nuovoUtenteRistorante(request, env, id, chi);
    if (azione === "/utenti" && utenteId && !invito && m === "PATCH") return modificaUtenteRistorante(request, env, id, utenteId, chi);
    if (azione === "/utenti" && utenteId && invito && m === "POST") return invitoUtenteRistorante(request, env, id, utenteId, chi);
    if (azione === "/assistenza" && m === "POST") {
      // Entra nel pannello del ristorante come titolare, con un segno visibile e una riga nel registro.
      const r = await ristorantePerId(env, id);
      if (!r) return errore("Ristorante non trovato.", 404);
      await registra(env, { ristorante: id, autore: chi.nome, azione: "accesso_assistenza", dettaglio: `Accesso come assistenza a ${r.nome}` });
      const cookie = await creaSessione(env, "gestione", { u: chi.id, r: id, ruolo: "titolare", a: 1, n: `Assistenza: ${chi.nome}` });
      return json({ ok: true, url: "/admin" }, 200, { "set-cookie": cookie });
    }
  }
  if (p === "/api/piattaforma/amministratori" && m === "GET") return elencoAmministratori(env);
  if (p === "/api/piattaforma/amministratori" && m === "POST") return nuovoAmministratore(request, env, chi);
  const amm = p.match(/^\/api\/piattaforma\/amministratori\/([0-9a-f-]{36})(\/invito)?$/);
  if (amm && !amm[2] && m === "PATCH") return modificaAmministratore(request, env, amm[1], chi);
  if (amm && amm[2] && m === "POST") return invitoAmministratore(request, env, amm[1], chi);
  return errore("Percorso non trovato.", 404);
}

/** Pagine e file: chi arriva con ?r=slug riceve un cookie, così le pagine successive restano su quel ristorante. */
async function servi(request, env, url) {
  const risposta = await env.ASSETS.fetch(request);
  const r = url.searchParams.get("r");
  if (!r || !SLUG.test(r) || (env.DOMINIO_BASE && url.hostname.endsWith(`.${env.DOMINIO_BASE}`))) return risposta;
  const nuova = new Response(risposta.body, risposta);
  nuova.headers.append("set-cookie", `r=${r}; Path=/; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  return nuova;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith("/api/")) return await servi(request, env, url);
      return await gestisciApi(request, env, url, ctx);
    } catch (e) {
      if (e instanceof ErroreRichiesta) return errore(e.message, e.status);
      console.error(e);
      return errore("Si è verificato un errore. Riprova tra poco.", 500);
    }
  },

  /** Cron Trigger ogni 15 minuti: messaggi dopo la visita, ristorante per ristorante. */
  async scheduled(evento, env, ctx) {
    const { results } = await env.DB.prepare("SELECT * FROM ristoranti WHERE stato IN ('attivo', 'prova')").all();
    for (const r of results.filter(operativo)) {
      ctx.waitUntil(contesto(env, r, null).then((c) => elaboraRecensioni(c)));
    }
  },
};
