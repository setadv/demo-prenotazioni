import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const PORTA = 8799;
const BASE = `http://127.0.0.1:${PORTA}`;
const PASSWORD = "password-di-test";
const stato = mkdtempSync(join(tmpdir(), "demo-pren-"));
const wrangler = "node_modules/.bin/wrangler";
let server;
let cookie = "";
let posta;
const inviati = [];
const PORTA_POSTA = 8798;

/** Server finto che riceve le chiamate a Resend e Twilio durante i test. */
function avviaPosta() {
  posta = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      const voce = { percorso: req.url, auth: req.headers.authorization, corpo };
      if (req.url.startsWith("/email")) voce.json = JSON.parse(corpo);
      else voce.form = Object.fromEntries(new URLSearchParams(corpo));
      inviati.push(voce);
      const errore = voce.json?.to?.[0] === "errore@esempio.it";
      res.writeHead(errore ? 500 : 200, { "content-type": "application/json" });
      res.end(errore ? '{"message":"casella inesistente"}' : '{"id":"finto"}');
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
  execFileSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.test.jsonc", "--persist-to", stato], {
    env: { ...process.env, CI: "1" },
    stdio: "pipe",
  });
  server = spawn(
    wrangler,
    [
      "dev", "--config", "wrangler.test.jsonc", "--port", String(PORTA), "--ip", "127.0.0.1", "--persist-to", stato,
      "--var", `ADMIN_PASSWORD:${PASSWORD}`, "--var", "SESSION_SECRET:segreto-di-test-lungo-trentadue-caratteri",
      "--var", "RESEND_API_KEY:re_finta", "--var", "EMAIL_MITTENTE:Prenotazioni <prenotazioni@esempio.it>",
      "--var", `RESEND_ENDPOINT:http://127.0.0.1:${PORTA_POSTA}/email`,
      "--var", "TWILIO_ACCOUNT_SID:ACfinto", "--var", "TWILIO_AUTH_TOKEN:token-finto", "--var", "TWILIO_NUMERO:+15550001111",
      "--var", `TWILIO_ENDPOINT:http://127.0.0.1:${PORTA_POSTA}/sms`,
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

after(() => {
  server?.kill("SIGTERM");
  posta?.close();
  rmSync(stato, { recursive: true, force: true });
});

test("le pagine si aprono con gli header di sicurezza", async () => {
  for (const [percorso, testo] of [["/", "Prenota un tavolo"], ["/admin", "Area riservata"], ["/prenotazione", "La tua prenotazione"]]) {
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

test("dopo il logout il cookie viene cancellato", async () => {
  const r = await admin("/api/admin/logout", { method: "POST" });
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});
