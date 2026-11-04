const SESSIONE_ORE = 8;
const MAX_GIORNI = 60;
const MAX_FOTO = 3 * 1024 * 1024;
const STATI = ["in_attesa", "confermata", "annullata"];
const encoder = new TextEncoder();

const json = (dati, status = 200, headers = {}) =>
  new Response(JSON.stringify(dati), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...headers,
    },
  });

const errore = (messaggio, status = 400) => json({ errore: messaggio }, status);

function oraRoma() {
  const parti = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { data: `${parti.year}-${parti.month}-${parti.day}`, ora: `${parti.hour}:${parti.minute}` };
}

function dataValida(valore) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valore ?? "")) return false;
  const d = new Date(`${valore}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valore;
}

function giorniDa(oggi, data) {
  return Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${oggi}T00:00:00Z`)) / 86400000);
}

function dataPrenotabile(data) {
  if (!dataValida(data)) return false;
  const distanza = giorniDa(oraRoma().data, data);
  return distanza >= 0 && distanza <= MAX_GIORNI;
}

function fasciaPassata(data, ora) {
  const adesso = oraRoma();
  return data === adesso.data && ora <= adesso.ora;
}

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

async function hmac(segreto, testo) {
  const chiave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(segreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", chiave, encoder.encode(testo)));
}

function uguali(a, b) {
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

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
  const attesa = base64url(await hmac(env.SESSION_SECRET, scadenza));
  return uguali(encoder.encode(firma), encoder.encode(attesa));
}

function cookieSessione(valore, secondi) {
  return `__Host-sessione=${valore}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${secondi}`;
}

async function impronta(request, env) {
  const ip = request.headers.get("cf-connecting-ip") ?? "locale";
  return base64url(await hmac(env.SESSION_SECRET ?? "demo", ip)).slice(0, 22);
}

async function limiteSuperato(env, chiave, massimo, minuti) {
  const dal = Date.now() - minuti * 60000;
  const riga = await env.DB.prepare(
    "SELECT COUNT(*) AS totale FROM tentativi WHERE chiave = ? AND momento > ?",
  )
    .bind(chiave, dal)
    .first();
  return riga.totale >= massimo;
}

async function registraTentativo(env, chiave) {
  const adesso = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tentativi WHERE momento < ?").bind(adesso - 86400000),
    env.DB.prepare("INSERT INTO tentativi (chiave, momento) VALUES (?, ?)").bind(chiave, adesso),
  ]);
}

async function leggiJson(request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return null;
  try {
    const corpo = await request.json();
    return corpo && typeof corpo === "object" ? corpo : null;
  } catch {
    return null;
  }
}

async function disponibilita(url, env) {
  const data = url.searchParams.get("data");
  if (!dataValida(data)) return errore("Scegli una data valida.");
  const { results } = await env.DB.prepare(
    `SELECT f.ora, f.servizio, f.coperti,
            COALESCE((SELECT SUM(p.persone) FROM prenotazioni p
                      WHERE p.data = ?1 AND p.ora = f.ora AND p.stato <> 'annullata'), 0) AS occupati
     FROM fasce f ORDER BY f.ora`,
  )
    .bind(data)
    .all();
  const prenotabile = dataPrenotabile(data);
  return json({
    fasce: results.map((f) => ({
      ...f,
      liberi: Math.max(f.coperti - f.occupati, 0),
      disponibile: prenotabile && !fasciaPassata(data, f.ora),
    })),
  });
}

async function nuovaPrenotazione(request, env) {
  const corpo = await leggiJson(request);
  if (!corpo) return errore("Richiesta non valida.");
  if (corpo.sito) return json({ id: crypto.randomUUID(), stato: "in_attesa" }, 201);

  const nome = String(corpo.nome ?? "").trim();
  const contatto = String(corpo.contatto ?? "").trim();
  const note = String(corpo.note ?? "").trim();
  const persone = Number(corpo.persone);

  if (!dataPrenotabile(corpo.data)) return errore("Questa data non si può prenotare.");
  if (!Number.isInteger(persone) || persone < 1 || persone > 12)
    return errore("Indica da 1 a 12 persone.");
  if (nome.length < 2 || nome.length > 80) return errore("Scrivi un nome di almeno 2 caratteri.");
  if (contatto.length < 5 || contatto.length > 120) return errore("Scrivi un telefono o un'email.");
  if (note.length > 300) return errore("Le note possono avere al massimo 300 caratteri.");
  if (!/^\d{2}:\d{2}$/.test(corpo.ora ?? "") || fasciaPassata(corpo.data, corpo.ora))
    return errore("Questa fascia oraria non è più disponibile.");

  const chiave = `prenota:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 10, 60))
    return errore("Troppe prenotazioni in poco tempo. Riprova tra un'ora.", 429);

  const id = crypto.randomUUID();
  const esito = await env.DB.prepare(
    `INSERT INTO prenotazioni (id, data, ora, persone, nome, contatto, note, creata_il)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
     FROM fasce f
     WHERE f.ora = ?3
       AND f.coperti >= ?4 + COALESCE((SELECT SUM(p.persone) FROM prenotazioni p
                                       WHERE p.data = ?2 AND p.ora = ?3 AND p.stato <> 'annullata'), 0)`,
  )
    .bind(id, corpo.data, corpo.ora, persone, nome, contatto, note, new Date().toISOString())
    .run();

  if (!esito.meta.changes)
    return errore("In questa fascia non ci sono più abbastanza posti. Scegline un'altra.", 409);
  await registraTentativo(env, chiave);
  return json({ id, stato: "in_attesa" }, 201);
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET)
    return errore("Accesso non configurato: mancano i secret dell'app.", 503);
  const corpo = await leggiJson(request);
  if (!corpo || typeof corpo.password !== "string") return errore("Scrivi la password.");

  const chiave = `login:${await impronta(request, env)}`;
  if (await limiteSuperato(env, chiave, 5, 15))
    return errore("Troppi tentativi. Riprova tra 15 minuti.", 429);

  const corretta = uguali(
    await hmac(env.SESSION_SECRET, corpo.password),
    await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD),
  );
  if (!corretta) {
    await registraTentativo(env, chiave);
    return errore("Password errata.", 401);
  }
  return json({ ok: true }, 200, {
    "set-cookie": cookieSessione(await creaToken(env), SESSIONE_ORE * 3600),
  });
}

async function elencoPrenotazioni(url, env) {
  const data = url.searchParams.get("data");
  if (!dataValida(data)) return errore("Scegli una data valida.");
  const { results } = await env.DB.prepare(
    "SELECT id, data, ora, persone, nome, contatto, note, stato FROM prenotazioni WHERE data = ? ORDER BY ora, creata_il",
  )
    .bind(data)
    .all();
  return json({ prenotazioni: results });
}

async function cambiaStato(request, env, id) {
  const corpo = await leggiJson(request);
  if (!corpo || !STATI.includes(corpo.stato)) return errore("Stato non valido.");
  const esistente = await env.DB.prepare("SELECT id FROM prenotazioni WHERE id = ?").bind(id).first();
  if (!esistente) return errore("Prenotazione non trovata.", 404);

  const esito = await env.DB.prepare(
    `UPDATE prenotazioni AS p SET stato = ?1
     WHERE p.id = ?2
       AND (p.stato <> 'annullata' OR ?1 = 'annullata'
            OR (SELECT f.coperti FROM fasce f WHERE f.ora = p.ora) >= p.persone + COALESCE(
                 (SELECT SUM(a.persone) FROM prenotazioni a
                  WHERE a.data = p.data AND a.ora = p.ora AND a.stato <> 'annullata'), 0))`,
  )
    .bind(corpo.stato, id)
    .run();
  if (!esito.meta.changes) return errore("Non ci sono posti per riattivare questa prenotazione.", 409);
  return json({ ok: true });
}

function tipoImmagine(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP")
    return "image/webp";
  return null;
}

async function caricaFoto(request, env) {
  if (!env.FOTO) return errore("Lo spazio per le foto non è ancora attivo.", 503);
  const corpo = new Uint8Array(await request.arrayBuffer());
  if (!corpo.byteLength || corpo.byteLength > MAX_FOTO) return errore("Carica un'immagine fino a 3 MB.", 413);
  const tipo = tipoImmagine(corpo);
  if (!tipo) return errore("Carica un'immagine JPG, PNG o WebP.", 415);
  await env.FOTO.put("locale", corpo, { httpMetadata: { contentType: tipo } });
  return json({ ok: true });
}

async function mostraFoto(env) {
  if (!env.FOTO) return new Response(null, { status: 404 });
  const foto = await env.FOTO.get("locale");
  if (!foto) return new Response(null, { status: 404 });
  return new Response(foto.body, {
    headers: {
      "content-type": foto.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

async function gestisciApi(request, env, url) {
  const { pathname } = url;
  const metodo = request.method;

  if (metodo !== "GET" && metodo !== "HEAD") {
    const origine = request.headers.get("origin");
    if (!origine || new URL(origine).host !== url.host) return errore("Origine non consentita.", 403);
  }

  if (pathname === "/api/disponibilita" && metodo === "GET") return disponibilita(url, env);
  if (pathname === "/api/prenotazioni" && metodo === "POST") return nuovaPrenotazione(request, env);
  if (pathname === "/api/foto" && metodo === "GET") return mostraFoto(env);
  if (pathname === "/api/admin/login" && metodo === "POST") return login(request, env);

  if (pathname.startsWith("/api/admin/")) {
    if (!(await autenticato(request, env))) return errore("Accedi per continuare.", 401);
    if (pathname === "/api/admin/sessione" && metodo === "GET")
      return json({ ok: true, foto: Boolean(env.FOTO), ambiente: env.APP_ENV });
    if (pathname === "/api/admin/logout" && metodo === "POST")
      return json({ ok: true }, 200, { "set-cookie": cookieSessione("", 0) });
    if (pathname === "/api/admin/prenotazioni" && metodo === "GET") return elencoPrenotazioni(url, env);
    if (pathname === "/api/admin/foto" && metodo === "PUT") return caricaFoto(request, env);
    const riga = pathname.match(/^\/api\/admin\/prenotazioni\/([0-9a-f-]{36})$/);
    if (riga && metodo === "PATCH") return cambiaStato(request, env, riga[1]);
  }

  return errore("Percorso non trovato.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await gestisciApi(request, env, url);
    } catch (e) {
      console.error(e);
      return errore("Si è verificato un errore. Riprova tra poco.", 500);
    }
  },
};
