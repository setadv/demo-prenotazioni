import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const PORTA = 8799;
const BASE = `http://127.0.0.1:${PORTA}`;
const PASSWORD = "password-di-test";
const stato = mkdtempSync(join(tmpdir(), "demo-pren-"));
// Wrangler avviato con node, così funziona anche su Windows (dove node_modules/.bin/wrangler è un .cmd).
const wrangler = process.execPath;
const WRANGLER_JS = "node_modules/wrangler/bin/wrangler.js";
let server;
let cookie = "";
let posta;
const inviati = [];
const PORTA_POSTA = 8798;
const VERIFICA_WA = "verifica-webhook-di-test";
const SEGRETO_WA = "segreto-app-meta-di-test";
const SEGRETO_STRIPE = "whsec_segreto_di_test";

/** Evento Stripe firmato come lo manda Stripe (header Stripe-Signature). */
function eventoStripe(tipo, oggetto) {
  const corpo = JSON.stringify({ id: `evt_${Date.now()}`, type: tipo, data: { object: oggetto } });
  const t = Math.floor(Date.now() / 1000);
  const firma = createHmac("sha256", SEGRETO_STRIPE).update(`${t}.${corpo}`).digest("hex");
  return fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${firma}` }, body: corpo });
}

/** Server finto che riceve le chiamate a Resend, Twilio e WhatsApp (Meta) durante i test. */
function avviaPosta() {
  posta = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      const voce = { percorso: req.url, auth: req.headers.authorization, corpo };
      if (req.url.startsWith("/email") || req.url.startsWith("/wa")) voce.json = JSON.parse(corpo);
      else voce.form = Object.fromEntries(new URLSearchParams(corpo));
      inviati.push(voce);
      const errore = voce.json?.to?.[0] === "errore@esempio.it";
      res.writeHead(errore ? 500 : 200, { "content-type": "application/json" });
      if (req.url.startsWith("/wa")) res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.test${inviati.length}` }] }));
      else if (req.url.startsWith("/stripe")) res.end(JSON.stringify({ id: `cs_test_${inviati.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${inviati.length}` }));
      else res.end(errore ? '{"message":"casella inesistente"}' : '{"id":"finto"}');
    });
  });
  return new Promise((ok) => posta.listen(PORTA_POSTA, "127.0.0.1", ok));
}

async function attendiInvio(filtro) {
  for (let i = 0; i < 40; i += 1) {
    const trovato = inviati.find(filtro);
    if (trovato) return trovato;
    await new Promise((f) => setTimeout(f, 150));
  }
  return null;
}

/** Prossimo giorno con il giorno della settimana indicato, ad almeno `minimo` giorni da oggi. */
function prossimo(giorno, minimo = 2) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minimo);
  while (d.getUTCDay() !== giorno) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const sposta = (data, giorni) => new Date(Date.parse(`${data}T12:00:00Z`) + giorni * 86400000).toISOString().slice(0, 10);

const MARTEDI = prossimo(2);
const LUNEDI = prossimo(1);

function chiama(percorso, { method = "GET", body, headers = {}, grezzo = false } = {}) {
  return fetch(BASE + percorso, {
    method,
    redirect: "manual",
    headers: {
      ...(method === "GET" ? {} : { origin: BASE }),
      ...(body && !grezzo ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: grezzo ? body : body ? JSON.stringify(body) : undefined,
  });
}
const admin = (percorso, opzioni = {}) => chiama(percorso, { ...opzioni, headers: { cookie, ...(opzioni.headers ?? {}) } });

const prenota = (dati, ip = "10.0.0.1") =>
  chiama("/api/prenotazioni", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
    body: { data: MARTEDI, ora: "20:00", persone: 2, nome: "Prova Test", telefono: "333 0000001", privacy: true, ...dati },
  });

before(async () => {
  await avviaPosta();
  execFileSync(wrangler, [WRANGLER_JS, "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.test.jsonc", "--persist-to", stato], {
    env: { ...process.env, CI: "1" },
    stdio: "pipe",
  });
  server = spawn(
    wrangler,
    [
      WRANGLER_JS, "dev", "--config", "wrangler.test.jsonc", "--port", String(PORTA), "--ip", "127.0.0.1", "--persist-to", stato,
      "--var", `ADMIN_PASSWORD:${PASSWORD}`, "--var", "SESSION_SECRET:segreto-di-test-lungo-trentadue-caratteri",
      "--var", "RESEND_API_KEY:re_finta", "--var", "EMAIL_MITTENTE:Prenotazioni <prenotazioni@esempio.it>",
      "--var", `RESEND_ENDPOINT:http://127.0.0.1:${PORTA_POSTA}/email`,
      "--var", "TWILIO_ACCOUNT_SID:ACfinto", "--var", "TWILIO_AUTH_TOKEN:token-finto", "--var", "TWILIO_NUMERO:+15550001111",
      "--var", `TWILIO_ENDPOINT:http://127.0.0.1:${PORTA_POSTA}/sms`,
      // WhatsApp: solo il modello di recensione, così le conferme WhatsApp restano manuali come senza configurazione.
      "--var", "WHATSAPP_TOKEN:token-wa-finto", "--var", "WHATSAPP_PHONE_ID:1234567890",
      "--var", "WHATSAPP_MODELLO_RECENSIONE:richiesta_recensione", "--var", "WHATSAPP_LINGUE:it,en_GB",
      "--var", `WHATSAPP_ENDPOINT:http://127.0.0.1:${PORTA_POSTA}/wa`,
      "--var", `WHATSAPP_VERIFY_TOKEN:${VERIFICA_WA}`, "--var", `WHATSAPP_APP_SECRET:${SEGRETO_WA}`,
      "--var", "STRIPE_SECRET_KEY:sk_test_finta", "--var", `STRIPE_WEBHOOK_SECRET:${SEGRETO_STRIPE}`,
      "--var", `STRIPE_ENDPOINT:http://127.0.0.1:${PORTA_POSTA}/stripe`,
      "--var", "SUPERADMIN_EMAIL:super@esempio.it",
    ],
    { stdio: "ignore", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } },
  );
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/ristorante`)).ok) return;
    } catch {}
    await new Promise((f) => setTimeout(f, 500));
  }
  throw new Error("Il server locale non è partito");
});

after(async () => {
  if (server && server.exitCode === null) {
    const uscito = new Promise((f) => server.once("exit", f));
    // Su Windows kill() ferma solo node: taskkill /T chiude anche workerd, che tiene aperti i file del database.
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
    await uscito;
  }
  posta?.close();
  rmSync(stato, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test("le pagine si aprono con gli header di sicurezza", async () => {
  for (const [percorso, testo] of [
    ["/", "Prenota un tavolo"],
    ["/admin", "Area riservata"],
    ["/prenotazione", "La tua prenotazione"],
    ["/ordina", "ordina\\.js"],
    ["/ordine", "ordine\\.js"],
    ["/regalo", "regalo\\.js"],
    ["/buono", "buono\\.js"],
    ["/sondaggio", "sondaggio\\.js"],
  ]) {
    const r = await chiama(percorso);
    assert.equal(r.status, 200, percorso);
    assert.match(await r.text(), new RegExp(testo));
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  }
});

test("la scheda del ristorante espone orari e regole", async () => {
  const info = await (await chiama("/api/ristorante")).json();
  assert.equal(info.nome, "Osteria del Melograno");
  assert.equal(info.max_persone_online, 8);
  assert.ok(info.orari.some((o) => o.giorno === 2));
  assert.ok(!info.orari.some((o) => o.giorno === 1));
});

test("la disponibilità segue orari, chiusura settimanale e promozioni", async () => {
  const d = await (await chiama(`/api/disponibilita?data=${MARTEDI}&persone=2`)).json();
  assert.equal(d.chiuso, false);
  assert.equal(d.slot[0].ora, "12:30");
  assert.equal(d.slot.find((s) => s.ora === "19:30").sconto, 20);
  assert.equal(d.slot.find((s) => s.ora === "21:00").sconto, 0);
  assert.ok(d.slot.every((s) => s.disponibile));
  const lun = await (await chiama(`/api/disponibilita?data=${LUNEDI}&persone=2`)).json();
  assert.equal(lun.chiuso, true);
  assert.equal((await chiama(`/api/disponibilita?data=${MARTEDI}&persone=9`)).status, 400);
});

test("una prenotazione occupa un tavolo per la durata del pasto", async () => {
  const r = await prenota({ persone: 8, ora: "20:00", nome: "Gruppo Grande", telefono: "333 1111111" });
  assert.equal(r.status, 201);
  const pren = await r.json();
  assert.match(pren.codice, /^[A-Z2-9]{6}$/);
  assert.equal(pren.stato, "in_attesa");

  const d = await (await chiama(`/api/disponibilita?data=${MARTEDI}&persone=8`)).json();
  const slot = (ora) => d.slot.find((s) => s.ora === ora).disponibile;
  assert.equal(slot("19:30"), false);
  assert.equal(slot("21:15"), false);
  assert.equal(slot("21:30"), true);
  assert.equal((await prenota({ persone: 8, ora: "20:30" })).status, 409);
});

test("prenotazioni simultanee non prendono lo stesso tavolo", async () => {
  const esiti = await Promise.all(
    Array.from({ length: 6 }, (_, i) => prenota({ persone: 8, ora: "12:30", telefono: `333 22200${i}` }, `10.1.0.${i}`)),
  );
  assert.equal(esiti.filter((r) => r.status === 201).length, 1);
  assert.equal(esiti.filter((r) => r.status === 409).length, 5);
});

test("i dati non validi vengono rifiutati", async () => {
  const ip = "10.0.0.2";
  assert.equal((await prenota({ persone: 9 }, ip)).status, 400);
  assert.equal((await prenota({ privacy: false }, ip)).status, 400);
  assert.equal((await prenota({ telefono: "abc" }, ip)).status, 400);
  assert.equal((await prenota({ email: "non-una-email" }, ip)).status, 400);
  assert.equal((await prenota({ nome: "A" }, ip)).status, 400);
  assert.equal((await prenota({ data: LUNEDI }, ip)).status, 409);
  assert.equal((await prenota({ ora: "20:07" }, ip)).status, 409);
  assert.equal((await prenota({ data: "2020-01-01" }, ip)).status, 409);
  assert.equal((await prenota({ data: "2026-02-31" }, ip)).status, 400);
});

test("il cliente vede e annulla la sua prenotazione solo con il link", async () => {
  const pren = await (await prenota({ ora: "13:00", nome: "Anna Bianchi", telefono: "333 3333333", note: "Seggiolone" }, "10.0.0.4")).json();
  const conToken = (t, metodo = "GET", suffisso = "") =>
    chiama(`/api/prenotazioni/${pren.id}${suffisso}`, { method: metodo, headers: { "x-prenotazione-token": t } });

  assert.equal((await conToken("token-sbagliato")).status, 404);
  const letta = await (await conToken(pren.token)).json();
  assert.equal(letta.nome, "Anna Bianchi");
  assert.equal(letta.sconto, 10);
  assert.equal(letta.annullabile, true);

  assert.equal((await conToken("token-sbagliato", "POST", "/annulla")).status, 404);
  assert.equal((await conToken(pren.token, "POST", "/annulla")).status, 200);
  assert.equal((await (await conToken(pren.token)).json()).stato, "annullata");
  assert.equal((await conToken(pren.token, "POST", "/annulla")).status, 409);
});

test("il campo esca e le richieste da altri siti non salvano nulla", async () => {
  const data = sposta(MARTEDI, 7);
  assert.equal((await prenota({ data, persone: 8, sito: "spam" }, "10.0.0.5")).status, 201);
  const d = await (await chiama(`/api/disponibilita?data=${data}&persone=8`)).json();
  assert.ok(d.slot.find((s) => s.ora === "20:00").disponibile);
  const r = await chiama("/api/prenotazioni", { method: "POST", headers: { origin: "https://altro.example" }, body: {} });
  assert.equal(r.status, 403);
});

test("dopo 10 prenotazioni in un'ora dallo stesso indirizzo scatta il limite", async () => {
  const data = sposta(MARTEDI, 14);
  const ore = ["12:30", "14:00", "19:30", "21:00", "22:00"];
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await prenota({ data, ora: ore[i % 5], persone: 1, telefono: `333 44400${i}` }, "10.2.0.1")).status, 201);
  }
  assert.equal((await prenota({ data, ora: "21:00", persone: 1 }, "10.2.0.1")).status, 429);
});

test("l'area riservata richiede il login e blocca i tentativi ripetuti", async () => {
  assert.equal((await chiama(`/api/admin/agenda?data=${MARTEDI}`)).status, 401);
  assert.equal(
    (await chiama(`/api/admin/agenda?data=${MARTEDI}`, { headers: { cookie: `__Host-sessione=${Date.now() + 99999}.falsa` } })).status,
    401,
  );
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": "10.3.0.1" }, body: { password: "no" } })).status, 401);
  }
  assert.equal((await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": "10.3.0.1" }, body: { password: PASSWORD } })).status, 429);

  const r = await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": "10.3.0.2" }, body: { password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  cookie = r.headers.get("set-cookie").split(";")[0];
});

test("l'agenda mostra prenotazioni, tavoli e storico del cliente", async () => {
  const a = await (await admin(`/api/admin/agenda?data=${MARTEDI}`)).json();
  const gruppo = a.prenotazioni.find((p) => p.nome === "Gruppo Grande");
  assert.equal(gruppo.tavolo, "D4");
  assert.ok(a.tavoli.length >= 12);
  assert.equal(a.sale.length, 2);
  assert.equal(a.prenotazioni.some((p) => "token_hash" in p), false);
});

test("il gestore aggiunge prenotazioni al telefono e clienti senza prenotazione", async () => {
  const tel = await admin("/api/admin/prenotazioni", {
    method: "POST",
    body: { data: MARTEDI, ora: "20:15", persone: 10, nome: "Cena Aziendale", telefono: "333 5555555", origine: "telefono" },
  });
  assert.equal(tel.status, 201);
  assert.equal((await tel.json()).tavolo_id, "t7");

  const pieno = await admin("/api/admin/prenotazioni", {
    method: "POST",
    body: { data: MARTEDI, ora: "20:15", persone: 10, nome: "Altro Gruppo", origine: "telefono" },
  });
  assert.equal(pieno.status, 409);
  const forzata = await admin("/api/admin/prenotazioni", {
    method: "POST",
    body: { data: MARTEDI, ora: "20:15", persone: 10, nome: "Altro Gruppo", origine: "telefono", forza: true },
  });
  assert.equal(forzata.status, 201);
  assert.equal((await forzata.json()).tavolo_id, null);

  const walk = await admin("/api/admin/prenotazioni", {
    method: "POST",
    body: { data: MARTEDI, ora: "19:45", persone: 2, nome: "Coppia Al Banco", origine: "walk_in", tavolo_id: "t1" },
  });
  assert.equal(walk.status, 201);
  const a = await (await admin(`/api/admin/agenda?data=${MARTEDI}`)).json();
  assert.equal(a.prenotazioni.find((p) => p.nome === "Coppia Al Banco").stato, "arrivata");
});

test("spostamenti e cambi di stato rispettano i tavoli occupati", async () => {
  const a = await (await admin(`/api/admin/agenda?data=${MARTEDI}`)).json();
  const coppia = a.prenotazioni.find((p) => p.nome === "Coppia Al Banco");
  const gruppo = a.prenotazioni.find((p) => p.nome === "Gruppo Grande");
  const senza = a.prenotazioni.find((p) => p.nome === "Altro Gruppo");
  const patch = (id, body) => admin(`/api/admin/prenotazioni/${id}`, { method: "PATCH", body });

  assert.equal((await patch(senza.id, { tavolo_id: "d4" })).status, 409);
  assert.equal((await patch(senza.id, { tavolo_id: "t5" })).status, 200);
  assert.equal((await patch(gruppo.id, { stato: "confermata" })).status, 200);
  assert.equal((await patch(gruppo.id, { stato: "annullata" })).status, 200);
  assert.equal((await patch(senza.id, { tavolo_id: "d4" })).status, 200);
  assert.equal((await patch(gruppo.id, { stato: "confermata" })).status, 409);
  assert.equal((await patch(coppia.id, { stato: "inventato" })).status, 400);
  assert.equal((await patch(coppia.id, { tavolo_id: "non-esiste" })).status, 404);
  assert.equal((await patch("00000000-0000-4000-8000-000000000000", { stato: "confermata" })).status, 404);
});

test("la mappa dei tavoli si modifica e protegge le prenotazioni future", async () => {
  const sala = await (await admin("/api/admin/sala")).json();
  const doppio = structuredClone(sala);
  doppio.tavoli[1].nome = doppio.tavoli[0].nome;
  assert.equal((await admin("/api/admin/sala", { method: "PUT", body: doppio })).status, 400);

  const senzaD4 = structuredClone(sala);
  senzaD4.tavoli = senzaD4.tavoli.filter((t) => t.id !== "d4");
  const rifiutato = await admin("/api/admin/sala", { method: "PUT", body: senzaD4 });
  assert.equal(rifiutato.status, 409);
  assert.match((await rifiutato.json()).errore, /D4/);

  const nuova = structuredClone(sala);
  nuova.tavoli.push({ id: "da-togliere", sala_id: "dehors", nome: "D9", posti_min: 1, posti_max: 2, forma: "tondo", x: 800, y: 80, larghezza: 100, altezza: 100, online: true });
  assert.equal((await admin("/api/admin/sala", { method: "PUT", body: nuova })).status, 200);
  nuova.tavoli = nuova.tavoli.filter((t) => t.id !== "da-togliere");
  nuova.tavoli.push({ id: "nuovo-12", sala_id: "dehors", nome: "D5", posti_min: 6, posti_max: 12, forma: "rettangolo", x: 600, y: 330, larghezza: 300, altezza: 110, online: true });
  nuova.tavoli.find((t) => t.id === "t1").x = 900;
  const ok = await admin("/api/admin/sala", { method: "PUT", body: nuova });
  assert.equal(ok.status, 200);
  const salvata = await ok.json();
  assert.equal(salvata.tavoli.some((t) => t.id === "da-togliere"), false);
  assert.equal(salvata.tavoli.find((t) => t.id === "nuovo-12").nome, "D5");
  assert.equal(salvata.tavoli.find((t) => t.id === "t1").x, 900);

  const fuori = structuredClone(salvata);
  fuori.tavoli.find((t) => t.id === "t1").x = 950;
  assert.equal((await admin("/api/admin/sala", { method: "PUT", body: fuori })).status, 400);

  const d = await (await chiama(`/api/disponibilita?data=${MARTEDI}&persone=8`)).json();
  assert.equal(d.slot.find((s) => s.ora === "20:00").disponibile, true);
});

test("orari, chiusure e regole cambiano subito la disponibilità", async () => {
  const conf = await (await admin("/api/admin/configurazione")).json();
  conf.impostazioni.max_persone_online = 10;
  conf.impostazioni.conferma_automatica = true;
  conf.chiusure.push({ data: sposta(MARTEDI, 1), motivo: "Evento privato" });
  conf.orari.push({ giorno: 1, servizio: "Cena", inizio: "19:30", fine: "21:00" });
  conf.promozioni.push({ giorni: [1], ora_da: "19:30", ora_a: "21:00", sconto: 30, attiva: true });
  const r = await admin("/api/admin/configurazione", { method: "PUT", body: conf });
  assert.equal(r.status, 200);

  const chiusa = await (await chiama(`/api/disponibilita?data=${sposta(MARTEDI, 1)}&persone=2`)).json();
  assert.equal(chiusa.chiuso, true);
  assert.equal(chiusa.motivo, "Evento privato");
  const lun = await (await chiama(`/api/disponibilita?data=${LUNEDI}&persone=10`)).json();
  assert.equal(lun.chiuso, false);
  assert.equal(lun.slot[0].sconto, 30);
  const pren = await (await prenota({ data: LUNEDI, ora: "19:30", persone: 10, telefono: "333 6666666" }, "10.5.0.1")).json();
  assert.equal(pren.stato, "confermata");

  const sbagliata = structuredClone(conf);
  sbagliata.orari.push({ giorno: 3, servizio: "Rotto", inizio: "22:00", fine: "20:00" });
  assert.equal((await admin("/api/admin/configurazione", { method: "PUT", body: sbagliata })).status, 400);
});

test("i clienti vengono riconosciuti dal telefono e accumulano lo storico", async () => {
  await prenota({ data: sposta(MARTEDI, 21), ora: "20:00", nome: "Mario Rossi", telefono: "+39 333 777 7777" }, "10.6.0.1");
  await prenota({ data: sposta(MARTEDI, 28), ora: "20:00", nome: "Mario R.", telefono: "3337777777", email: "mario@esempio.it" }, "10.6.0.1");
  const { clienti } = await (await admin("/api/admin/clienti?q=777")).json();
  assert.equal(clienti.length, 1);
  assert.equal(clienti[0].prenotazioni, 2);
  assert.equal(clienti[0].email, "mario@esempio.it");
  assert.equal((await admin(`/api/admin/clienti/${clienti[0].id}`, { method: "PATCH", body: { note: "Preferisce il dehors" } })).status, 200);
  const dopo = await (await admin("/api/admin/clienti?q=Mario")).json();
  assert.equal(dopo.clienti[0].note, "Preferisce il dehors");
});

test("le statistiche coprono il periodo richiesto", async () => {
  const s = await (await admin("/api/admin/statistiche?giorni=30")).json();
  assert.equal(s.serie.length, 30);
  assert.ok(s.prossimi_7_giorni.prenotazioni >= 0);
  assert.equal((await admin("/api/admin/statistiche?giorni=2")).status, 400);
});

test("logo e foto si caricano nel database e compaiono nella scheda", async () => {
  assert.equal((await chiama("/api/media/logo")).status, 404);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  assert.equal((await admin("/api/admin/media/logo", { method: "PUT", body: Buffer.from("<svg onload=x>"), grezzo: true })).status, 415);
  assert.equal((await admin("/api/admin/media/logo", { method: "PUT", body: Buffer.alloc(600 * 1024, 1), grezzo: true })).status, 413);
  assert.equal((await chiama("/api/admin/media/logo", { method: "PUT", body: png, grezzo: true })).status, 401);
  assert.equal((await admin("/api/admin/media/logo", { method: "PUT", body: png, grezzo: true })).status, 200);
  const letto = await chiama("/api/media/logo");
  assert.equal(letto.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await letto.arrayBuffer()), png);
  assert.ok((await (await chiama("/api/ristorante")).json()).logo);
  assert.equal((await admin("/api/admin/media/logo", { method: "DELETE" })).status, 200);
  assert.equal((await chiama("/api/media/logo")).status, 404);
});

test("il periodo restituisce le prenotazioni di settimana e mese", async () => {
  const r = await (await admin(`/api/admin/periodo?da=${sposta(MARTEDI, -1)}&a=${sposta(MARTEDI, 5)}`)).json();
  assert.ok(r.prenotazioni.some((p) => p.data === MARTEDI && p.nome === "Gruppo Grande"));
  assert.ok(r.giorni_aperti.includes(2));
  assert.equal((await admin(`/api/admin/periodo?da=${MARTEDI}&a=${sposta(MARTEDI, 60)}`)).status, 400);
});

test("la conferma del gestore invia l'email con il link personale", async () => {
  const conf = await (await admin("/api/admin/configurazione")).json();
  conf.impostazioni.conferma_automatica = false;
  assert.equal((await admin("/api/admin/configurazione", { method: "PUT", body: conf })).status, 200);
  const data = sposta(MARTEDI, 35);
  const pren = await (await prenota({ data, ora: "20:00", nome: "Laura Verdi", telefono: "333 8888888", email: "laura@esempio.it", canale: "email" }, "10.7.0.1")).json();
  assert.equal(pren.stato, "in_attesa");
  assert.equal(inviati.some((v) => v.json?.to?.[0] === "laura@esempio.it"), false);
  assert.equal((await admin(`/api/admin/prenotazioni/${pren.id}`, { method: "PATCH", body: { stato: "confermata" } })).status, 200);
  const email = await attendiInvio((v) => v.json?.to?.[0] === "laura@esempio.it");
  assert.ok(email, "email non inviata");
  assert.equal(email.auth, "Bearer re_finta");
  assert.match(email.json.text, new RegExp(pren.codice));
  const link = email.json.text.match(/\/prenotazione#id=([0-9a-f-]+)&t=([\w-]+)/);
  assert.equal(link[1], pren.id);
  const letta = await chiama(`/api/prenotazioni/${pren.id}`, { headers: { "x-prenotazione-token": link[2] } });
  assert.equal(letta.status, 200);

  const agenda = await (await admin(`/api/admin/agenda?data=${data}`)).json();
  const riga = agenda.prenotazioni.find((p) => p.id === pren.id);
  assert.equal(riga.notifica.esito, "inviata");
  assert.equal(riga.notifica.canale, "email");
  assert.match(riga.messaggio, /Laura/);

  const prima = inviati.length;
  await admin(`/api/admin/prenotazioni/${pren.id}`, { method: "PATCH", body: { stato: "annullata" } });
  await admin(`/api/admin/prenotazioni/${pren.id}`, { method: "PATCH", body: { stato: "confermata" } });
  await new Promise((f) => setTimeout(f, 800));
  assert.equal(inviati.length, prima, "la conferma non deve partire due volte");
});

test("se l'email fallisce la conferma parte via SMS, WhatsApp resta da inviare a mano", async () => {
  const data = sposta(MARTEDI, 42);
  const conErrore = await (await prenota({ data, ora: "20:00", nome: "Paolo Neri", telefono: "333 9990001", email: "errore@esempio.it", canale: "email" }, "10.8.0.1")).json();
  await admin(`/api/admin/prenotazioni/${conErrore.id}`, { method: "PATCH", body: { stato: "confermata" } });
  const sms = await attendiInvio((v) => v.form?.To === "+393339990001");
  assert.ok(sms, "SMS di riserva non inviato");
  assert.equal(sms.percorso, "/sms/2010-04-01/Accounts/ACfinto/Messages.json");
  assert.equal(sms.form.From, "+15550001111");

  const wa = await (await prenota({ data, ora: "21:00", nome: "Giulia Blu", telefono: "333 9990002", email: "giulia@esempio.it", canale: "whatsapp" }, "10.8.0.1")).json();
  await admin(`/api/admin/prenotazioni/${wa.id}`, { method: "PATCH", body: { stato: "confermata" } });
  await new Promise((f) => setTimeout(f, 800));
  assert.equal(inviati.some((v) => v.form?.To === "+393339990002" || v.json?.to?.[0] === "giulia@esempio.it"), false);
  let agenda = await (await admin(`/api/admin/agenda?data=${data}`)).json();
  assert.equal(agenda.prenotazioni.find((p) => p.id === wa.id).notifica.esito, "da_inviare");
  assert.equal(agenda.prenotazioni.find((p) => p.id === conErrore.id).notifica.canale, "sms");

  assert.equal((await admin(`/api/admin/prenotazioni/${wa.id}/notifica`, { method: "POST", body: { canale: "whatsapp" } })).status, 200);
  assert.equal((await admin(`/api/admin/prenotazioni/${wa.id}/notifica`, { method: "POST", body: { canale: "piccione" } })).status, 400);
  agenda = await (await admin(`/api/admin/agenda?data=${data}`)).json();
  assert.equal(agenda.prenotazioni.find((p) => p.id === wa.id).notifica.esito, "manuale");
});

test("con la conferma automatica il cliente riceve subito il messaggio", async () => {
  const sms = await attendiInvio((v) => v.form?.To === "+393336666666");
  assert.ok(sms, "la prenotazione confermata in automatico non ha inviato l'SMS");
  assert.match(sms.form.Body, /confermata/);
});

test("un canale email senza indirizzo viene rifiutato", async () => {
  assert.equal((await prenota({ data: sposta(MARTEDI, 49), canale: "email", email: "" }, "10.9.0.1")).status, 400);
});

/** Salva le impostazioni di un modulo partendo da quelle attuali. */
async function modulo(nome, modifiche) {
  const { impostazioni } = await (await admin("/api/admin/moduli")).json();
  const r = await admin(`/api/admin/moduli/${nome}`, { method: "PUT", body: { impostazioni: { ...impostazioni, ...modifiche } } });
  return r;
}

const oggiRoma = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());

test("il menù pubblico ha categorie, piatti, allergeni e traduzioni", async () => {
  const r = await chiama("/api/menu?t=t3");
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.tavolo, "3");
  assert.deepEqual(m.categorie.map((c) => c.id), ["antipasti", "primi", "secondi", "dolci"]);
  const burrata = m.categorie[0].piatti[0];
  assert.equal(burrata.prezzo, 1200);
  assert.deepEqual(burrata.allergeni, ["latte", "frutta_guscio"]);
  assert.match(burrata.traduzioni.en.nome, /Burrata/);
  assert.match(m.nota.de, /Gedeck/);
  assert.equal((await (await chiama("/api/menu?t=inesistente")).json()).tavolo, null);
  const pagina = await chiama("/menu");
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /menu\.js/);
});

test("il gestore modifica il menù e il cliente vede subito le modifiche", async () => {
  assert.equal((await chiama("/api/admin/menu")).status, 401);
  const menu = await (await admin("/api/admin/menu")).json();
  assert.equal(menu.allergeni.length, 14);
  const categorie = menu.categorie;
  categorie.push({
    id: "pizze",
    nome: "Pizze",
    traduzioni: { en: { nome: "Pizzas" } },
    piatti: [{ id: "margherita", nome: "Margherita", descrizione: "Pomodoro e fiordilatte", prezzo: 850, allergeni: ["glutine", "latte"], tag: ["vegetariano"], traduzioni: {}, disponibile: true }],
  });
  categorie[3].piatti[0].disponibile = false;
  const salvato = await admin("/api/admin/menu", { method: "PUT", body: { categorie, nota: { ...menu.nota, it: "Coperto 3 €." } } });
  assert.equal(salvato.status, 200);
  const pubblico = await (await chiama("/api/menu")).json();
  const pizze = pubblico.categorie.find((c) => c.id === "pizze");
  assert.equal(pizze.traduzioni.en.nome, "Pizzas");
  assert.equal(pizze.piatti[0].prezzo, 850);
  assert.equal(pubblico.categorie.find((c) => c.id === "dolci").piatti[0].disponibile, false);
  assert.equal(pubblico.nota.it, "Coperto 3 €.");

  categorie[4].piatti[0].allergeni = ["ananas"];
  assert.equal((await admin("/api/admin/menu", { method: "PUT", body: { categorie, nota: menu.nota } })).status, 400);
  categorie[4].piatti[0].allergeni = [];
  categorie[4].piatti[0].prezzo = -5;
  assert.equal((await admin("/api/admin/menu", { method: "PUT", body: { categorie, nota: menu.nota } })).status, 400);
  categorie[4].piatti.push({ ...categorie[4].piatti[0], prezzo: 900 });
  assert.equal((await admin("/api/admin/menu", { method: "PUT", body: { categorie, nota: menu.nota } })).status, 400, "id duplicato");
  const dopo = await (await chiama("/api/menu")).json();
  assert.equal(dopo.categorie.find((c) => c.id === "pizze").piatti[0].prezzo, 850, "un salvataggio rifiutato non cambia nulla");
});

test("i QR code aprono solo pagine di questo sito", async () => {
  const generale = await chiama("/api/qr");
  assert.equal(generale.status, 200);
  assert.match(generale.headers.get("content-type"), /image\/svg\+xml/);
  const svg = await generale.text();
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, new RegExp(`<title>${BASE}/menu</title>`));
  assert.match(await (await chiama("/api/qr?t=t3")).text(), /\/menu\?t=t3/);
  assert.match(await (await chiama("/api/qr?pagina=prenota")).text(), new RegExp(`<title>${BASE}/</title>`));
  assert.equal((await chiama("/api/qr?t=nessuno")).status, 404);
  assert.equal((await chiama("/api/qr?t=../x")).status, 400);
  assert.match((await chiama("/api/qr?t=t3&scarica=1")).headers.get("content-disposition"), /qr-menu-tavolo-3\.svg/);
});

test("le pagine pubbliche rispondono nella lingua del cliente", async () => {
  const errore = await chiama("/api/prenotazioni", {
    method: "POST",
    headers: { "cf-connecting-ip": "10.20.0.1" },
    body: { data: MARTEDI, ora: "20:00", persone: 2, nome: "John Smith", telefono: "12", privacy: true, lingua: "en" },
  });
  assert.equal(errore.status, 400);
  assert.equal((await errore.json()).errore, "Enter a valid phone number.");
  const chiuso = await (await chiama(`/api/disponibilita?data=${sposta(MARTEDI, 1)}&persone=2&lingua=de`)).json();
  assert.equal(chiuso.motivo, "Das Restaurant ist an diesem Datum geschlossen.");
  const troppi = await chiama(`/api/disponibilita?data=${MARTEDI}&persone=99&lingua=fr`);
  assert.match((await troppi.json()).errore, /^Choisissez de 1 à/);
  const info = await (await chiama("/api/ristorante")).json();
  assert.match(info.descrizioni.en, /Seasonal cooking/);
  const nonTrovata = await chiama(`/api/prenotazioni/${crypto.randomUUID()}`, { headers: { "x-prenotazione-token": "x", "x-lingua": "es" } });
  assert.equal((await nonTrovata.json()).errore, "Reserva no encontrada. Revisa el enlace que recibiste.");

  const data = sposta(MARTEDI, 56);
  const pren = await (await prenota({ data, ora: "20:00", nome: "Emma Brown", telefono: "+44 7700 900123", email: "emma@esempio.it", canale: "email", lingua: "en" }, "10.20.0.2")).json();
  await admin(`/api/admin/prenotazioni/${pren.id}`, { method: "PATCH", body: { stato: "confermata" } });
  const email = await attendiInvio((v) => v.json?.to?.[0] === "emma@esempio.it");
  assert.ok(email, "conferma in inglese non inviata");
  assert.match(email.json.subject, /^Booking confirmed at /);
  assert.match(email.json.text, /^Hi Emma, your table at .+ for 2 people on Tuesday/);
  assert.match(email.json.text, /&l=en$/);
  const agenda = await (await admin(`/api/admin/agenda?data=${data}`)).json();
  assert.equal(agenda.prenotazioni.find((p) => p.id === pren.id).lingua, "en");
});

test("il CRM registra consenso, etichette e compleanno ed esporta i segmenti", async () => {
  const data = sposta(MARTEDI, 63);
  await prenota({ data, ora: "20:00", nome: "Carla Rossa", telefono: "333 4440001", marketing: true, canale: "sms" }, "10.21.0.1");
  await prenota({ data, ora: "21:00", nome: "=1+1 Prova", telefono: "333 4440002", canale: "sms" }, "10.21.0.1");
  let r = await (await admin("/api/admin/clienti?segmento=marketing")).json();
  const carla = r.clienti.find((c) => c.nome === "Carla Rossa");
  assert.ok(carla, "il consenso alle promozioni non è stato registrato");
  assert.equal(carla.marketing, true);
  assert.ok(carla.marketing_il);
  assert.equal(r.clienti.some((c) => c.nome === "=1+1 Prova"), false);
  assert.ok(r.conteggi.tutti >= r.conteggi.marketing);

  assert.equal((await admin(`/api/admin/clienti/${carla.id}`, { method: "PATCH", body: { compleanno: "02-30" } })).status, 400);
  const salvata = await admin(`/api/admin/clienti/${carla.id}`, { method: "PATCH", body: { etichette: ["VIP", "Allergie"], compleanno: "03-15", lingua: "fr" } });
  assert.equal(salvata.status, 200);
  const scheda = await salvata.json();
  assert.deepEqual(scheda.cliente.etichette, ["VIP", "Allergie"]);
  assert.equal(scheda.cliente.compleanno, "03-15");
  assert.equal(scheda.cliente.marketing, true, "un aggiornamento parziale non tocca il consenso");
  assert.equal(scheda.storico.length, 1);
  r = await (await admin("/api/admin/clienti?segmento=vip")).json();
  assert.deepEqual(r.clienti.map((c) => c.nome), ["Carla Rossa"]);
  r = await (await admin("/api/admin/clienti?q=allergie")).json();
  assert.ok(r.clienti.some((c) => c.id === carla.id));
  const agenda = await (await admin(`/api/admin/agenda?data=${data}`)).json();
  assert.deepEqual(agenda.prenotazioni.find((p) => p.nome === "Carla Rossa").etichette, ["VIP", "Allergie"]);

  const revoca = await (await admin(`/api/admin/clienti/${carla.id}`, { method: "PATCH", body: { marketing: false } })).json();
  assert.equal(revoca.cliente.marketing, false);
  assert.equal(revoca.cliente.marketing_il, null);

  const csv = await admin("/api/admin/clienti.csv?segmento=tutti");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const byte = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...byte.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM per Excel");
  const testo = new TextDecoder().decode(byte);
  assert.ok(testo.startsWith("Nome;Telefono;Email;"));
  assert.match(testo, /\n'=1\+1 Prova;/);
  assert.equal((await chiama("/api/admin/clienti.csv")).status, 401);
});

test("la richiesta di recensione parte una volta dopo la visita, anche su WhatsApp", async () => {
  const conf = await (await admin("/api/admin/configurazione")).json();
  assert.equal(conf.canali.whatsapp, false);
  assert.equal(conf.canali.whatsapp_recensione, true);
  const prova = (modifiche) => admin("/api/admin/configurazione", { method: "PUT", body: { ...conf, impostazioni: { ...conf.impostazioni, ...modifiche } } });
  assert.equal((await prova({ link_recensioni: "http://esempio.it/recensioni" })).status, 400);
  assert.equal((await prova({ link_recensioni: "https://g.page/r/prova/review", messaggio_recensione: "Grazie della visita, a presto!" })).status, 400);
  assert.equal((await prova({ link_recensioni: "https://g.page/r/prova/review", recensione_dopo_ore: 1, recensioni_automatiche: true })).status, 200);
  // Qui si prova la sola recensione: il sondaggio (che la sostituisce quando è attivo) ha un test suo.
  await modulo("sondaggio", { sondaggio_attivo: false });

  const ieri = sposta(oggiRoma(), -1);
  const crea = (dati) =>
    admin("/api/admin/prenotazioni", { method: "POST", body: { data: ieri, ora: "12:30", persone: 2, origine: "walk_in", ...dati } }).then((r) => r.json());
  const viaEmail = await crea({ nome: "Sara Gialli", telefono: "333 7770001", email: "sara@esempio.it", canale: "email" });
  const viaWa = await crea({ nome: "Tom Green", telefono: "+44 7700 900777", canale: "whatsapp", lingua: "en" });
  const viaSms = await crea({ nome: "Rino Grigi", telefono: "333 7770003", canale: "sms" });

  await admin(`/api/admin/agenda?data=${ieri}`);
  const email = await attendiInvio((v) => v.json?.to?.[0] === "sara@esempio.it");
  assert.ok(email, "richiesta di recensione via email non inviata");
  assert.equal(email.json.subject, `Com'è andata da ${conf.impostazioni.nome}?`);
  assert.match(email.json.text, /https:\/\/g\.page\/r\/prova\/review/);

  const wa = await attendiInvio((v) => v.percorso === "/wa/1234567890/messages" && v.json?.to === "447700900777");
  assert.ok(wa, "richiesta di recensione WhatsApp non inviata");
  assert.equal(wa.auth, "Bearer token-wa-finto");
  assert.equal(wa.json.template.name, "richiesta_recensione");
  assert.equal(wa.json.template.language.code, "en_GB");
  assert.deepEqual(wa.json.template.components[0].parameters.map((p) => p.text), ["Tom", conf.impostazioni.nome, "https://g.page/r/prova/review"]);

  const sms = await attendiInvio((v) => v.form?.To === "+393337770003");
  assert.ok(sms, "chi ha scelto SMS riceve la richiesta via SMS");

  const prima = inviati.length;
  await admin(`/api/admin/agenda?data=${ieri}`);
  await new Promise((f) => setTimeout(f, 800));
  assert.equal(inviati.length, prima, "la richiesta non deve partire due volte");
  const agenda = await (await admin(`/api/admin/agenda?data=${ieri}`)).json();
  for (const id of [viaEmail.id, viaWa.id, viaSms.id]) {
    const riga = agenda.prenotazioni.find((p) => p.id === id);
    assert.equal(riga.notifica_recensione.esito, "inviata", riga.nome);
    assert.match(riga.messaggio_recensione, /g\.page/);
  }
  const stato = await (await admin("/api/admin/whatsapp")).json();
  assert.equal(stato.inviati[0].cliente, "Tom Green");
  assert.equal(stato.inviati[0].stato, "accettato");
});

test("il webhook WhatsApp accetta solo richieste firmate da Meta", async () => {
  const ok = await chiama(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFICA_WA}&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "12345");
  assert.equal((await chiama("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=sbagliato&hub.challenge=1")).status, 403);

  const inviato = (await (await admin("/api/admin/whatsapp")).json()).inviati[0];
  // Il server finto risponde con wamid.testN, dove N è la posizione della richiesta in `inviati`.
  const wamid = `wamid.test${inviati.findIndex((v) => v.json?.to === "447700900777") + 1}`;
  const corpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: "393337770001", profile: { name: "Sara" } }],
      messages: [{ id: "wamid.ricevuto1", from: "393337770001", timestamp: "1700000000", type: "text", text: { body: "Grazie, bellissima serata!" } }],
      statuses: [{ id: wamid, status: "read", recipient_id: "447700900777" }],
    } }] }],
  });
  const firma = `sha256=${createHmac("sha256", SEGRETO_WA).update(corpo).digest("hex")}`;
  const senzaFirma = await fetch(`${BASE}/api/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: corpo });
  assert.equal(senzaFirma.status, 401);
  const firmata = await fetch(`${BASE}/api/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": firma }, body: corpo });
  assert.equal(firmata.status, 200);
  const stato = await (await admin("/api/admin/whatsapp")).json();
  const ricevuto = stato.ricevuti.find((m) => m.testo === "Grazie, bellissima serata!");
  assert.ok(ricevuto);
  assert.equal(ricevuto.cliente, "Sara Gialli");
  assert.equal(stato.inviati.find((m) => m.cliente === inviato.cliente).stato, "read");
});

test("la raccolta punti accredita le visite e crea il premio in automatico", async () => {
  assert.equal((await modulo("fidelity", { fidelity_attiva: true, punti_visita: 10, premio_soglia: 20, messaggio_premio: "Ciao {nome}" })).status, 400, "il messaggio deve avere il link");
  assert.equal((await modulo("fidelity", { fidelity_attiva: true, punti_visita: 10, premio_soglia: 20 })).status, 200);
  const data = sposta(MARTEDI, 70);
  const prima = await (await prenota({ data, ora: "20:00", nome: "Fede Punti", telefono: "333 5550001", email: "fede@esempio.it", canale: "email", fidelity: true }, "10.30.0.1")).json();
  const seconda = await (await prenota({ data, ora: "21:00", nome: "Fede Punti", telefono: "333 5550001", email: "fede@esempio.it", canale: "email", fidelity: true }, "10.30.0.1")).json();
  await admin(`/api/admin/prenotazioni/${prima.id}`, { method: "PATCH", body: { stato: "arrivata" } });
  await admin(`/api/admin/prenotazioni/${prima.id}`, { method: "PATCH", body: { stato: "arrivata" } });
  await new Promise((f) => setTimeout(f, 400));
  let clienti = await (await admin("/api/admin/clienti?segmento=fidelity&q=Fede")).json();
  assert.equal(clienti.clienti[0].punti, 10, "la stessa visita non dà punti due volte");

  await admin(`/api/admin/prenotazioni/${seconda.id}`, { method: "PATCH", body: { stato: "arrivata" } });
  const email = await attendiInvio((v) => v.json?.to?.[0] === "fede@esempio.it" && /PR-/.test(v.json.text));
  assert.ok(email, "il messaggio del premio non è partito");
  assert.match(email.json.subject, /premio/);
  const [, id, token] = email.json.text.match(/\/buono#tipo=premio&id=([0-9a-f-]+)&t=([\w-]+)/);
  const buono = await (await chiama(`/api/buoni/premio/${id}`, { headers: { "x-buono-token": token } })).json();
  assert.equal(buono.stato, "attivo");
  assert.match(buono.descrizioni.en, /dessert/);
  assert.equal((await chiama(`/api/buoni/premio/${id}`, { headers: { "x-buono-token": "sbagliato" } })).status, 404);

  clienti = await (await admin("/api/admin/clienti?segmento=fidelity&q=Fede")).json();
  assert.equal(clienti.clienti[0].punti, 0, "la soglia viene scalata quando nasce il premio");
  const trovato = await (await admin(`/api/admin/codice?c=${buono.codice}`)).json();
  assert.equal(trovato.tipo, "premio");
  assert.equal((await admin(`/api/admin/premi/${id}/usa`, { method: "POST" })).status, 200);
  assert.equal((await admin(`/api/admin/premi/${id}/usa`, { method: "POST" })).status, 409);

  await admin(`/api/admin/prenotazioni/${seconda.id}`, { method: "PATCH", body: { stato: "confermata" } });
  await new Promise((f) => setTimeout(f, 300));
  const scheda = await (await admin(`/api/admin/clienti/${clienti.clienti[0].id}`)).json();
  assert.equal(scheda.fidelity.saldo, -10, "annullare l'arrivo toglie i punti della visita");
  assert.equal(scheda.fidelity.premi[0].stato, "usato");
});

test("le gift card si emettono al banco o si comprano online e si spendono a scalare", async () => {
  const info = await (await chiama("/api/gift")).json();
  assert.equal(info.online, true);
  assert.deepEqual(info.importi, [25, 50, 100]);

  const emessa = await admin("/api/admin/gift", { method: "POST", body: { importo: 50, acquirente_nome: "Zia Anna", destinatario_nome: "Luca", destinatario_email: "luca@esempio.it", messaggio: "Buon compleanno!" } });
  assert.equal(emessa.status, 201);
  const { id, codice } = await emessa.json();
  const email = await attendiInvio((v) => v.json?.to?.[0] === "luca@esempio.it");
  assert.ok(email, "la gift card non è arrivata al destinatario");
  assert.match(email.json.text, new RegExp(`Zia Anna ti ha regalato una gift card da 50,00`));
  const token = email.json.text.match(/&t=([\w-]+)/)[1];
  const pubblica = await (await chiama(`/api/buoni/gift/${id}`, { headers: { "x-buono-token": token } })).json();
  assert.equal(pubblica.saldo, 5000);
  assert.equal(pubblica.messaggio, "Buon compleanno!");

  const usata = await (await admin(`/api/admin/gift/${id}/usa`, { method: "POST", body: { importo: "20,00", nota: "Cena del 12" } })).json();
  assert.equal(usata.gift_card.saldo, 3000);
  assert.equal((await admin(`/api/admin/gift/${id}/usa`, { method: "POST", body: { importo: "40" } })).status, 409);
  assert.equal((await (await admin(`/api/admin/codice?c=${codice.toLowerCase()}`)).json()).saldo, 3000);
  assert.equal((await admin("/api/admin/codice?c=GC-NESSUNO")).status, 404);
  const qr = await chiama(`/api/qr?codice=${codice}`);
  assert.match(await qr.text(), new RegExp(`<title>${codice}</title>`));

  assert.equal((await chiama("/api/gift", { method: "POST", body: { importo: 33, acquirente_nome: "Mario", acquirente_email: "m@esempio.it", destinatario_nome: "Pia", privacy: true } })).status, 400);
  const online = await chiama("/api/gift", {
    method: "POST",
    body: { importo: 25, acquirente_nome: "Mario Bianchi", acquirente_email: "mario@esempio.it", destinatario_nome: "Pia", destinatario_email: "pia@esempio.it", privacy: true, lingua: "en" },
  });
  assert.equal(online.status, 201);
  const acquisto = await online.json();
  assert.match(acquisto.url_pagamento, /^https:\/\/checkout\.stripe\.com\//);
  const sessione = inviati.findLast((v) => v.percorso === "/stripe/v1/checkout/sessions");
  assert.equal(sessione.auth, "Bearer sk_test_finta");
  assert.equal(sessione.form["line_items[0][price_data][unit_amount]"], "2500");
  assert.equal(sessione.form["metadata[tipo]"], "gift");
  assert.equal(sessione.form.locale, "en");
  let elenco = await (await admin("/api/admin/gift")).json();
  assert.equal(elenco.gift_card.some((g) => g.id === acquisto.id), false, "non pagata, non compare");

  const falso = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body: "{}" });
  assert.equal(falso.status, 400);
  assert.equal((await eventoStripe("checkout.session.completed", { id: "cs_x", payment_status: "paid", metadata: { tipo: "gift", id: acquisto.id } })).status, 200);
  const regalo = await attendiInvio((v) => v.json?.to?.[0] === "pia@esempio.it");
  assert.ok(regalo, "dopo il pagamento la gift card arriva a chi la riceve");
  assert.match(regalo.json.text, /^Hi Pia, Mario Bianchi has given you a €25\.00 gift card/);
  elenco = await (await admin("/api/admin/gift")).json();
  assert.equal(elenco.gift_card.find((g) => g.id === acquisto.id).stato, "attiva");
  await eventoStripe("checkout.session.completed", { id: "cs_x", payment_status: "paid", metadata: { tipo: "gift", id: acquisto.id } });
  await new Promise((f) => setTimeout(f, 300));
  assert.equal(inviati.filter((v) => v.json?.to?.[0] === "pia@esempio.it").length, 1, "un evento ripetuto non attiva due volte");
});

test("il sondaggio dopo la visita raccoglie i voti e mostra a tutti il link per la recensione", async () => {
  assert.equal((await modulo("sondaggio", { sondaggio_attivo: true, messaggio_sondaggio: "Grazie della visita, a presto!" })).status, 400);
  assert.equal((await modulo("sondaggio", { sondaggio_attivo: true })).status, 200);
  const ieri = sposta(oggiRoma(), -1);
  const p = await (await admin("/api/admin/prenotazioni", {
    method: "POST",
    body: { data: ieri, ora: "13:00", persone: 2, origine: "walk_in", nome: "Vera Voti", telefono: "333 8880001", email: "vera@esempio.it", canale: "email" },
  })).json();
  await admin(`/api/admin/agenda?data=${ieri}`);
  const email = await attendiInvio((v) => v.json?.to?.[0] === "vera@esempio.it" && /sondaggio/.test(v.json.text));
  assert.ok(email, "il sondaggio non è partito");
  const [, id, token] = email.json.text.match(/\/sondaggio#id=([0-9a-f-]+)&t=([\w-]+)/);
  assert.equal(id, p.id);
  const h = { "x-sondaggio-token": token };
  const scheda = await (await chiama(`/api/sondaggio/${id}`, { headers: h })).json();
  assert.equal(scheda.compilato, false);
  assert.equal((await chiama(`/api/sondaggio/${id}`, { method: "POST", headers: h, body: { voto_cibo: 9 } })).status, 400);
  const voti = { voto_cibo: 5, voto_servizio: 2, voto_ambiente: 4, voto_prezzo: 3, consiglio: 6, commento: "Cibo ottimo, servizio lento." };
  const risposta = await chiama(`/api/sondaggio/${id}`, { method: "POST", headers: h, body: voti });
  assert.equal(risposta.status, 201);
  assert.equal((await risposta.json()).link_recensioni, "https://g.page/r/prova/review", "anche chi dà voti bassi vede il link");
  assert.equal((await chiama(`/api/sondaggio/${id}`, { method: "POST", headers: h, body: voti })).status, 409);
  const r = await (await admin("/api/admin/sondaggi?giorni=30")).json();
  assert.equal(r.risposte, 1);
  assert.equal(r.nps, -100);
  assert.equal(r.elenco[0].critico, true);
  assert.equal(r.elenco[0].nome, "Vera Voti");
  assert.equal((await admin(`/api/admin/sondaggi/${id}`, { method: "PATCH", body: { gestito: true } })).status, 200);
});

test("asporto e consegna: carrello, fasce, minimo, zone, stati e pagamento online", async () => {
  const info = await (await chiama("/api/ordini/info")).json();
  assert.equal(info.attivi, true);
  const data = info.giorni.at(-1);
  let fasce = (await (await chiama(`/api/ordini/fasce?data=${data}`)).json()).fasce;
  assert.ok(fasce.length > 3);
  const base = { tipo: "asporto", data, ora: fasce[0].ora, nome: "Olga Ordini", telefono: "333 9990077", email: "olga@esempio.it", canale: "email", privacy: true, fidelity: true };
  const ordina = (dati, ip = "10.40.0.1") => chiama("/api/ordini", { method: "POST", headers: { "cf-connecting-ip": ip }, body: { ...base, ...dati } });

  assert.equal((await ordina({ righe: [{ id: "tiramisu", quantita: 1 }] })).status, 409, "un piatto esaurito non si ordina");
  assert.equal((await ordina({ righe: [] })).status, 400);
  const sotto = await ordina({ tipo: "consegna", indirizzo: "Via Roma 1", cap: "80031", righe: [{ id: "margherita", quantita: 1 }], lingua: "en" });
  assert.equal((await sotto.json()).errore, "The minimum order for delivery is €15.00.");

  const r = await ordina({ righe: [{ id: "risotto", quantita: 2 }, { id: "margherita", quantita: 1 }, { id: "risotto", quantita: 1 }], prezzo: 1 });
  assert.equal(r.status, 201);
  const o = await r.json();
  assert.equal(o.totale, 3 * 1300 + 850, "i prezzi li calcola il server");
  const letto = await (await chiama(`/api/ordini/${o.id}`, { headers: { "x-ordine-token": o.token } })).json();
  assert.deepEqual(letto.righe.map((x) => [x.nome, x.quantita]), [["Risotto alla zucca", 3], ["Margherita", 1]]);

  const consegna = await (await ordina({ tipo: "consegna", ora: fasce[1].ora, indirizzo: "Via Roma 1", cap: "80031", righe: [{ id: "risotto", quantita: 2 }] })).json();
  assert.equal(consegna.totale, 2600 + 300);

  assert.equal((await modulo("ordini", { consegna_cap: "80031, 80032", ordini_max_fascia: 1 })).status, 200);
  assert.equal((await ordina({ tipo: "consegna", ora: fasce[2].ora, indirizzo: "Via Roma 1", cap: "00100", righe: [{ id: "risotto", quantita: 2 }] })).status, 400);
  assert.equal((await ordina({ ora: fasce[0].ora, righe: [{ id: "risotto", quantita: 1 }] })).status, 409, "fascia piena");
  fasce = (await (await chiama(`/api/ordini/fasce?data=${data}`)).json()).fasce;
  assert.equal(fasce.some((f) => f.ora === base.ora), false);

  const percorso = `/api/admin/ordini/${o.id}`;
  assert.equal((await admin(percorso, { method: "PATCH", body: { stato: "completato" } })).status, 409);
  assert.equal((await admin(percorso, { method: "PATCH", body: { stato: "in_preparazione" } })).status, 200);
  const conferma = await attendiInvio((v) => v.json?.to?.[0] === "olga@esempio.it");
  assert.ok(conferma, "conferma dell'ordine non inviata");
  assert.match(conferma.json.text, /ordine .+ è confermato: ritiro .+ Totale 47,50/);
  assert.match(conferma.json.text, /\/ordine#id=/);
  assert.equal((await admin(percorso, { method: "PATCH", body: { stato: "in_consegna" } })).status, 409, "l'asporto non va in consegna");
  await admin(percorso, { method: "PATCH", body: { stato: "pronto" } });
  await admin(percorso, { method: "PATCH", body: { stato: "completato" } });
  await new Promise((f) => setTimeout(f, 400));
  const cliente = (await (await admin("/api/admin/clienti?q=Olga")).json()).clienti[0];
  const scheda = await (await admin(`/api/admin/clienti/${cliente.id}`)).json();
  assert.equal(scheda.fidelity.movimenti.find((m) => m.motivo === `Ordine ${o.codice}`).punti, 47, "un punto per euro di ordine");
  assert.equal(scheda.fidelity.premi.length, 2, "con la soglia a 20 punti nascono due premi");
  assert.equal(scheda.fidelity.saldo, 7);

  const online = await (await ordina({ ora: fasce[0].ora, pagamento: "online", righe: [{ id: "margherita", quantita: 2 }] }, "10.40.0.2")).json();
  assert.equal(online.stato, "in_attesa_pagamento");
  assert.match(online.url_pagamento, /checkout\.stripe\.com/);
  let elenco = await (await admin(`/api/admin/ordini?data=${data}`)).json();
  assert.equal(elenco.ordini.some((x) => x.id === online.id), false);
  await eventoStripe("checkout.session.completed", { id: "cs_o", payment_status: "paid", metadata: { tipo: "ordine", id: online.id } });
  elenco = await (await admin(`/api/admin/ordini?data=${data}`)).json();
  const pagato = elenco.ordini.find((x) => x.id === online.id);
  assert.equal(pagato.stato, "nuovo");
  assert.equal(pagato.pagato, true);
  assert.match(pagato.messaggio, /confermato/);
  await modulo("ordini", { consegna_cap: "", ordini_max_fascia: 4 });
});

// ---------- Piattaforma: più ristoranti, account con ruoli, super amministratore ----------

const cookieDa = (r) => r.headers.get("set-cookie").split(";")[0];
const con = (c) => (percorso, opzioni = {}) => chiama(percorso, { ...opzioni, headers: { cookie: c, ...(opzioni.headers ?? {}) } });
const tokenDa = (testo) => testo.match(/\/accesso#t=([\w-]+)/)[1];
let piattaforma;
let ristorante2;
let titolare2;

async function attivaAccount(link, password, ip) {
  const r = await chiama("/api/accesso/imposta", { method: "POST", headers: { "cf-connecting-ip": ip }, body: { token: tokenDa(link), password } });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}

async function accedi(email, password, ip) {
  const r = await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": ip }, body: { email, password } });
  assert.equal(r.status, 200, await r.clone().text());
  return cookieDa(r);
}

test("la piattaforma accetta solo il super amministratore", async () => {
  const sbagliata = await chiama("/api/piattaforma/login", { method: "POST", headers: { "cf-connecting-ip": "10.70.0.1" }, body: { email: "super@esempio.it", password: "no" } });
  assert.equal(sbagliata.status, 401);
  assert.equal((await admin("/api/piattaforma/riepilogo")).status, 401, "la sessione del ristorante non apre la piattaforma");
  const r = await chiama("/api/piattaforma/login", { method: "POST", headers: { "cf-connecting-ip": "10.70.0.2" }, body: { email: "SUPER@esempio.it", password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /__Host-piattaforma=.+HttpOnly; SameSite=Strict/);
  piattaforma = con(cookieDa(r));
  assert.equal((await piattaforma("/api/admin/agenda")).status, 401, "la sessione della piattaforma non è quella di un ristorante");
  const riepilogo = await (await piattaforma("/api/piattaforma/riepilogo")).json();
  assert.equal(riepilogo.totale, 1);
  assert.equal(riepilogo.conteggi.attivo, 1);
});

test("il super amministratore crea un ristorante in prova e invita il titolare", async () => {
  assert.equal((await piattaforma("/api/piattaforma/ristoranti", { method: "POST", body: { nome: "Admin", slug: "admin" } })).status, 400, "indirizzo riservato");
  assert.equal((await piattaforma("/api/piattaforma/ristoranti", { method: "POST", body: { nome: "Doppione", slug: "melograno" } })).status, 409);
  const r = await piattaforma("/api/piattaforma/ristoranti", {
    method: "POST",
    body: { nome: "Trattoria Due", slug: "trattoria-due", piano: "base", giorni_prova: 14, nome_titolare: "Anna Due", email_titolare: "Anna@Due.it" },
  });
  assert.equal(r.status, 201);
  const creato = await r.json();
  ristorante2 = creato.ristorante;
  assert.equal(ristorante2.stato, "prova");
  assert.deepEqual(ristorante2.moduli, []);
  assert.match(creato.indirizzo, /\?r=trattoria-due$/);
  assert.equal(creato.invito.inviata, true);
  const email = await attendiInvio((v) => v.json?.to?.[0] === "anna@due.it");
  assert.match(email.json.text, /Trattoria Due/);

  // Il link è monouso.
  const attivato = await attivaAccount(email.json.text, "una-password-lunga", "10.70.1.1");
  assert.equal(attivato.destinazione, "/admin");
  const riuso = await chiama("/api/accesso/imposta", { method: "POST", headers: { "cf-connecting-ip": "10.70.1.2" }, body: { token: tokenDa(email.json.text), password: "altra-password-lunga" } });
  assert.equal(riuso.status, 400);

  titolare2 = con(await accedi("anna@due.it", "una-password-lunga", "10.70.1.3"));
  const s = await (await titolare2("/api/admin/sessione")).json();
  assert.equal(s.nome, "Trattoria Due");
  assert.equal(s.utente.ruolo, "titolare");
  assert.equal(s.ristorante.stato, "prova");
  assert.deepEqual(s.ristorante.moduli, []);
});

test("i dati dei ristoranti sono separati", async () => {
  // Sala e orari di partenza del nuovo ristorante; nessun dato della demo.
  const sala = await (await titolare2("/api/admin/sala")).json();
  assert.equal(sala.tavoli.length, 6);
  const salaDemo = await (await admin("/api/admin/sala")).json();
  assert.equal(salaDemo.tavoli.some((t) => sala.tavoli.some((x) => x.id === t.id)), false);
  assert.equal((await (await titolare2("/api/admin/clienti")).json()).clienti.length, 0);
  assert.equal((await (await titolare2(`/api/admin/agenda?data=${MARTEDI}`)).json()).prenotazioni.length, 0);

  // Prenotazione pubblica sul secondo ristorante, con lo stesso telefono di un cliente della demo.
  const info = await (await chiama("/api/ristorante?r=trattoria-due")).json();
  assert.equal(info.nome, "Trattoria Due");
  assert.equal(info.moduli.gift, false);
  const r = await chiama("/api/prenotazioni?r=trattoria-due", {
    method: "POST",
    headers: { "cf-connecting-ip": "10.70.2.1" },
    body: { data: MARTEDI, ora: "20:00", persone: 2, nome: "Prova Test", telefono: "333 0000001", privacy: true },
  });
  assert.equal(r.status, 201, await r.clone().text());
  const p = await r.json();
  const agenda2 = await (await titolare2(`/api/admin/agenda?data=${MARTEDI}`)).json();
  assert.equal(agenda2.prenotazioni.length, 1);
  const agendaDemo = await (await admin(`/api/admin/agenda?data=${MARTEDI}`)).json();
  assert.equal(agendaDemo.prenotazioni.some((x) => x.id === p.id), false);
  assert.equal((await (await titolare2("/api/admin/clienti")).json()).clienti.length, 1);

  // Il link personale porta al ristorante giusto anche senza ?r=.
  const letta = await (await chiama(`/api/prenotazioni/${p.id}`, { headers: { "x-prenotazione-token": p.token } })).json();
  assert.equal(letta.ristorante.nome, "Trattoria Due");

  // Un ristorante non tocca i dati dell'altro.
  const demo = agendaDemo.prenotazioni[0];
  assert.equal((await titolare2(`/api/admin/prenotazioni/${demo.id}`, { method: "PATCH", body: { stato: "annullata" } })).status, 404);
  const rubata = { sale: salaDemo.sale, tavoli: salaDemo.tavoli };
  assert.equal((await titolare2("/api/admin/sala", { method: "PUT", body: rubata })).status, 400);
  assert.equal((await (await admin("/api/admin/sala")).json()).tavoli.length, salaDemo.tavoli.length);

  // La password principale vale solo per il ristorante predefinito.
  const principale = await chiama("/api/admin/login?r=trattoria-due", { method: "POST", headers: { "cf-connecting-ip": "10.70.2.2" }, body: { password: PASSWORD } });
  assert.equal(principale.status, 401);
});

test("le funzioni seguono il piano del ristorante", async () => {
  assert.equal((await titolare2("/api/admin/moduli/gift", { method: "PUT", body: { impostazioni: { gift_attive: true } } })).status, 403);
  const ordini = await (await chiama("/api/ordini/info?r=trattoria-due")).json();
  assert.equal(ordini.attivi, false);
  const moduli = await (await titolare2("/api/admin/moduli")).json();
  assert.equal(moduli.stripe, false, "le chiavi Stripe della demo non valgono per gli altri ristoranti");
  assert.equal(moduli.canali.whatsapp_recensione, false, "neanche quelle di WhatsApp");

  // Con il modulo gift e le sue chiavi Stripe il ristorante può vendere gift card online.
  await piattaforma(`/api/piattaforma/ristoranti/${ristorante2.id}`, { method: "PATCH", body: { piano: "pro", moduli: ["gift", "fidelity"], prezzo_mensile: "59" } });
  const conChiavi = await piattaforma(`/api/piattaforma/ristoranti/${ristorante2.id}/integrazioni`, {
    method: "PUT",
    body: { integrazioni: { STRIPE_SECRET_KEY: "sk_test_ristorante_due", STRIPE_WEBHOOK_SECRET: "whsec_due" } },
  });
  const dettaglio = await conChiavi.json();
  assert.equal(dettaglio.integrazioni.STRIPE_SECRET_KEY, "••••_due");
  assert.equal(JSON.stringify(dettaglio).includes("sk_test_ristorante_due"), false, "le chiavi non tornano al browser");
  assert.equal((await (await titolare2("/api/admin/moduli")).json()).stripe, true);
  assert.equal((await titolare2("/api/admin/moduli/gift", { method: "PUT", body: { impostazioni: { ...moduli.impostazioni, gift_attive: true } } })).status, 200);
  const sessione = await (await titolare2("/api/admin/sessione")).json();
  assert.deepEqual(sessione.ristorante.moduli.sort(), ["fidelity", "gift"]);
});

test("ruoli: lo staff lavora sul servizio, la sola lettura consulta", async () => {
  const invito = await (await titolare2("/api/admin/utenti", { method: "POST", body: { email: "staff@due.it", nome: "Marco", ruolo: "staff" } })).json();
  assert.equal(invito.inviata, true);
  await attivaAccount(invito.link, "password-dello-staff", "10.70.3.1");
  const staff = con(await accedi("staff@due.it", "password-dello-staff", "10.70.3.2"));
  assert.equal((await staff(`/api/admin/agenda?data=${MARTEDI}`)).status, 200);
  assert.equal((await staff("/api/admin/configurazione", { method: "PUT", body: {} })).status, 403);
  assert.equal((await staff("/api/admin/clienti.csv")).status, 403);
  assert.equal((await staff("/api/admin/utenti")).status, 403);

  const l = await (await titolare2("/api/admin/utenti", { method: "POST", body: { email: "socio@due.it", ruolo: "lettura" } })).json();
  await attivaAccount(l.link, "password-del-socio", "10.70.3.3");
  const lettura = con(await accedi("socio@due.it", "password-del-socio", "10.70.3.4"));
  const agenda = await (await lettura(`/api/admin/agenda?data=${MARTEDI}`)).json();
  assert.equal((await lettura(`/api/admin/prenotazioni/${agenda.prenotazioni[0].id}`, { method: "PATCH", body: { stato: "confermata" } })).status, 403);

  // Il titolare non può restare senza titolari, e chi viene disattivato perde subito l'accesso.
  const { utenti, io } = await (await titolare2("/api/admin/utenti")).json();
  assert.equal(utenti.length, 3);
  assert.equal((await titolare2(`/api/admin/utenti/${io}`, { method: "PATCH", body: { ruolo: "staff" } })).status, 400);
  const marco = utenti.find((u) => u.email === "staff@due.it");
  await titolare2(`/api/admin/utenti/${marco.id}`, { method: "PATCH", body: { attivo: false } });
  assert.equal((await staff(`/api/admin/agenda?data=${MARTEDI}`)).status, 401);
  assert.equal((await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": "10.70.3.5" }, body: { email: "staff@due.it", password: "password-dello-staff" } })).status, 401);

  // Password dimenticata: arriva un link nuovo; la risposta è la stessa anche per email inesistenti.
  assert.equal((await chiama("/api/accesso/recupera", { method: "POST", headers: { "cf-connecting-ip": "10.70.3.6" }, body: { email: "nessuno@due.it" } })).status, 200);
  assert.equal((await chiama("/api/accesso/recupera", { method: "POST", headers: { "cf-connecting-ip": "10.70.3.6" }, body: { email: "socio@due.it" } })).status, 200);
  const reset = await attendiInvio((v) => v.json?.to?.[0] === "socio@due.it" && /reimpostare/.test(v.json.text));
  await attivaAccount(reset.json.text, "nuova-password-socio", "10.70.3.7");
  await accedi("socio@due.it", "nuova-password-socio", "10.70.3.8");
});

test("sospensione, assistenza, esportazione e cancellazione", async () => {
  const percorso = `/api/piattaforma/ristoranti/${ristorante2.id}`;
  assert.equal((await piattaforma(`${percorso}/stato`, { method: "POST", body: { stato: "sospeso" } })).status, 400, "serve il motivo");
  await piattaforma(`${percorso}/stato`, { method: "POST", body: { stato: "sospeso", motivo: "Fattura di novembre non pagata" } });
  const pubblico = await chiama("/api/ristorante?r=trattoria-due");
  assert.equal(pubblico.status, 503);
  assert.equal((await pubblico.json()).sospeso, true);
  assert.equal((await chiama("/api/ristorante")).status, 200, "la demo continua a funzionare");
  const s = await (await titolare2("/api/admin/sessione")).json();
  assert.equal(s.ristorante.stato, "sospeso");
  assert.equal(s.ristorante.motivo, "Fattura di novembre non pagata");
  assert.equal((await titolare2(`/api/admin/agenda?data=${MARTEDI}`)).status, 200, "si può consultare");
  const bloccata = await titolare2("/api/admin/configurazione", { method: "PUT", body: {} });
  assert.equal(bloccata.status, 403);
  assert.match((await bloccata.json()).errore, /sospeso/);

  // L'assistenza entra nel pannello del ristorante e lascia traccia nel registro.
  const a = await piattaforma(`${percorso}/assistenza`, { method: "POST" });
  const assistenza = con(cookieDa(a));
  const sa = await (await assistenza("/api/admin/sessione")).json();
  assert.equal(sa.assistenza, true);
  assert.equal(sa.nome, "Trattoria Due");

  await piattaforma(`${percorso}/stato`, { method: "POST", body: { stato: "attivo" } });
  assert.equal((await chiama("/api/ristorante?r=trattoria-due")).status, 200);
  const dettaglio = await (await piattaforma(percorso)).json();
  assert.equal(dettaglio.ristorante.stato, "attivo");
  assert.equal(dettaglio.uso.prenotazioni.totale, 1);
  assert.ok(dettaglio.registro.some((x) => x.azione === "accesso_assistenza"));
  assert.ok(dettaglio.registro.some((x) => x.azione === "stato_sospeso" && /novembre/.test(x.dettaglio)));
  const riepilogo = await (await piattaforma("/api/piattaforma/riepilogo")).json();
  assert.equal(riepilogo.mrr, 5900, "conta solo gli abbonamenti attivi (la demo costa 0)");

  const esporta = await piattaforma(`${percorso}/esporta`);
  assert.match(esporta.headers.get("content-disposition"), /ristorante-trattoria-due/);
  const dati = await esporta.json();
  assert.equal(dati.dati.prenotazioni_v2.length, 1);
  assert.equal(dati.utenti.length, 3);
  assert.equal("integrazioni" in dati.ristorante, false);

  assert.equal((await piattaforma(percorso, { method: "DELETE", body: { conferma: "trattoria-due" } })).status, 409, "prima va disattivato");
  await piattaforma(`${percorso}/stato`, { method: "POST", body: { stato: "disattivato" } });
  assert.equal((await chiama("/api/ristorante?r=trattoria-due")).status, 404);
  assert.equal((await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": "10.70.4.1" }, body: { email: "anna@due.it", password: "una-password-lunga" } })).status, 403);
  assert.equal((await piattaforma(percorso, { method: "DELETE", body: { conferma: "sbagliato" } })).status, 400);
  assert.equal((await piattaforma(percorso, { method: "DELETE", body: { conferma: "trattoria-due" } })).status, 200);
  assert.equal((await piattaforma(percorso)).status, 404);
  assert.equal((await (await piattaforma("/api/piattaforma/riepilogo")).json()).totale, 1);
});

test("un ristorante si iscrive da solo e parte in prova", async () => {
  const info = await (await chiama("/api/registrati")).json();
  assert.equal(info.aperte, true);
  assert.equal(info.giorni_prova, 14);
  assert.equal(info.piani.pro.prezzo, undefined, "la pagina di iscrizione non mostra i prezzi");
  assert.ok(info.piani.pro.moduli.length);
  const dati = { nome_locale: "Osteria Nuova", nome: "Lucia Neri", email: "Lucia@Nuova.it", telefono: "333 1234567", password: "password-di-lucia", piano: "pro", consenso: true };
  assert.equal((await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.1" }, body: { ...dati, consenso: false } })).status, 400);
  assert.equal((await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.1" }, body: { ...dati, password: "corta" } })).status, 400);
  const r = await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.1" }, body: dati });
  assert.equal(r.status, 201, await r.clone().text());
  const esito = await r.json();
  assert.match(esito.indirizzo, /\?r=osteria-nuova$/);
  const titolare = con(cookieDa(r));
  const s = await (await titolare("/api/admin/sessione")).json();
  assert.equal(s.nome, "Osteria Nuova");
  assert.equal(s.utente.ruolo, "titolare");
  assert.equal(s.ristorante.stato, "prova");
  assert.deepEqual(s.ristorante.moduli.sort(), ["fidelity", "gift", "sondaggi", "whatsapp"]);
  assert.equal((await (await titolare("/api/admin/sala")).json()).tavoli.length, 6);
  // Benvenuto al titolare e avviso al super amministratore.
  assert.ok(await attendiInvio((v) => v.json?.to?.[0] === "lucia@nuova.it" && /prova gratuita/.test(v.json.text)));
  const avviso = await attendiInvio((v) => v.json?.to?.[0] === "super@esempio.it" && /Osteria Nuova/.test(v.json.subject));
  assert.match(avviso.json.text, /Lucia Neri/);
  // Stessa email: no; stesso nome: indirizzo con un numero.
  assert.equal((await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.2" }, body: dati })).status, 409);
  const due = await (await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.2" }, body: { ...dati, email: "altra@nuova.it" } })).json();
  assert.match(due.indirizzo, /\?r=osteria-nuova-2$/);
  // Limite: tre iscrizioni l'ora dalla stessa connessione; il campo trappola non crea nulla.
  for (const email of ["a@x.it", "b@x.it"]) await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.3" }, body: { ...dati, email } });
  await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.3" }, body: { ...dati, email: "c@x.it" } });
  assert.equal((await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.3" }, body: { ...dati, email: "d@x.it" } })).status, 429);
  const prima = (await (await piattaforma("/api/piattaforma/ristoranti")).json()).ristoranti.length;
  assert.equal((await chiama("/api/registrati", { method: "POST", headers: { "cf-connecting-ip": "10.80.0.4" }, body: { ...dati, email: "bot@x.it", sito: "http://spam" } })).status, 201);
  assert.equal((await (await piattaforma("/api/piattaforma/ristoranti")).json()).ristoranti.length, prima);
  const registro = await (await piattaforma("/api/piattaforma/registro")).json();
  assert.ok(registro.registro.some((x) => x.azione === "iscrizione" && /Osteria Nuova, piano Pro/.test(x.dettaglio)));
});

test("dopo il logout il cookie viene cancellato", async () => {
  const r = await admin("/api/admin/logout", { method: "POST" });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});

test("il pannello segnala le prenotazioni online finché non sono confermate o annullate", async () => {
  assert.equal((await chiama("/api/admin/novita")).status, 401);
  const prima = await (await admin("/api/admin/novita")).json();
  const r = await prenota({ ora: "21:00", nome: "Nuova Online", telefono: "333 0000777" }, "10.90.0.1");
  assert.equal(r.status, 201, await r.clone().text());
  const creata = await r.json();
  const stato = (body) => admin(`/api/admin/prenotazioni/${creata.id}`, { method: "PATCH", body });
  if (creata.stato !== "in_attesa") assert.equal((await stato({ stato: "in_attesa" })).status, 200);
  const dopo = await (await admin("/api/admin/novita")).json();
  assert.equal(dopo.totale, prima.totale + 1);
  assert.ok(dopo.prenotazioni.some((p) => p.id === creata.id && p.nome === "Nuova Online"));
  assert.equal((await stato({ stato: "confermata" })).status, 200);
  const confermata = await (await admin("/api/admin/novita")).json();
  assert.ok(!confermata.prenotazioni.some((p) => p.id === creata.id));
  assert.equal(confermata.totale, prima.totale);
});

test("il pannello segnala gli ordini da evadere solo nel giorno dell'ordine", async () => {
  const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const prima = await (await admin("/api/admin/novita")).json();
  assert.equal(typeof prima.ordini_totale, "number");
  assert.ok(Array.isArray(prima.ordini));
  assert.ok(prima.ordini.every((o) => o.data === oggi && !["completato", "annullato", "in_attesa_pagamento"].includes(o.stato)));
  const info = await (await chiama("/api/ordini/info")).json();
  const data = info.giorni.find((g) => g !== oggi);
  if (!data) return;
  const fasce = (await (await chiama(`/api/ordini/fasce?data=${data}`)).json()).fasce;
  const r = await chiama("/api/ordini", {
    method: "POST",
    headers: { "cf-connecting-ip": "10.91.0.1" },
    body: { tipo: "asporto", data, ora: fasce.at(-1).ora, nome: "Futuro Ordine", telefono: "333 9990088", privacy: true, righe: [{ id: "margherita", quantita: 2 }] },
  });
  assert.equal(r.status, 201, await r.clone().text());
  const dopo = await (await admin("/api/admin/novita")).json();
  assert.equal(dopo.ordini_totale, prima.ordini_totale, "un ordine per un altro giorno non si segnala oggi");
});

test("la richiesta di recensione aspetta le ore dopo l'arrivo, anche con il sondaggio attivo", async () => {
  const conf = await (await admin("/api/admin/configurazione")).json();
  assert.equal(conf.impostazioni.recensione_dopo_arrivo_ore, 3);
  const domani = sposta(oggiRoma(), 1);
  const r = await admin("/api/admin/prenotazioni", {
    method: "POST",
    body: { data: domani, ora: "20:00", persone: 2, origine: "walk_in", nome: "Appena Arrivato", telefono: "333 7770099", email: "arrivato@esempio.it", canale: "email" },
  });
  assert.equal(r.status, 201, await r.clone().text());
  const { id } = await r.json();
  await admin(`/api/admin/agenda?data=${domani}`);
  await new Promise((f) => setTimeout(f, 800));
  assert.ok(!inviati.some((v) => v.json?.to?.[0] === "arrivato@esempio.it"), "appena arrivato: nessuna richiesta ancora");
  const riga = (await (await admin(`/api/admin/agenda?data=${domani}`)).json()).prenotazioni.find((p) => p.id === id);
  assert.equal(riga.notifica_recensione, null);
  assert.match(riga.messaggio_recensione, /g\.page/, "il testo per l'invio a mano è già pronto");
});
