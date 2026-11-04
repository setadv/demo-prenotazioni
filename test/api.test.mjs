import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
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

const domani = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const giorno = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

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

const prenota = (dati, ip = "10.0.0.1") =>
  chiama("/api/prenotazioni", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
    body: { data: domani, ora: "20:30", persone: 2, nome: "Prova Test", contatto: "333 0000000", ...dati },
  });

before(async () => {
  execFileSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.test.jsonc", "--persist-to", stato], {
    env: { ...process.env, CI: "1" },
    stdio: "pipe",
  });
  server = spawn(wrangler, [
    "dev", "--config", "wrangler.test.jsonc", "--port", String(PORTA), "--ip", "127.0.0.1",
    "--persist-to", stato,
    "--var", `ADMIN_PASSWORD:${PASSWORD}`, "--var", "SESSION_SECRET:segreto-di-test-lungo-trentadue-caratteri",
  ], { stdio: "ignore", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/disponibilita?data=${domani}`);
      if (r.ok) return;
    } catch {}
    await new Promise((f) => setTimeout(f, 500));
  }
  throw new Error("Il server locale non è partito");
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(stato, { recursive: true, force: true });
});

test("la pagina pubblica e l'area riservata si aprono con gli header di sicurezza", async () => {
  const home = await chiama("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Osteria del Melograno/);
  assert.equal(home.headers.get("x-robots-tag"), "noindex");
  assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);
  const admin = await chiama("/admin");
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Area riservata/);
});

test("una prenotazione valida riduce i posti disponibili", async () => {
  const r = await prenota({ ora: "12:30", persone: 4 });
  assert.equal(r.status, 201);
  const { fasce } = await (await chiama(`/api/disponibilita?data=${domani}`)).json();
  const fascia = fasce.find((f) => f.ora === "12:30");
  assert.equal(fascia.occupati, 4);
  assert.equal(fascia.liberi, 16);
});

test("i dati non validi vengono rifiutati", async () => {
  assert.equal((await prenota({ persone: 13 }, "10.0.0.2")).status, 400);
  assert.equal((await prenota({ nome: "A" }, "10.0.0.2")).status, 400);
  assert.equal((await prenota({ data: "2020-01-01" }, "10.0.0.2")).status, 400);
  assert.equal((await prenota({ data: "2026-02-31" }, "10.0.0.2")).status, 400);
  assert.equal((await prenota({ data: giorno(61) }, "10.0.0.2")).status, 400);
  assert.equal((await prenota({ ora: "11:00" }, "10.0.0.2")).status, 409);
});

test("prenotazioni simultanee non superano i coperti", async () => {
  const data = giorno(2);
  const esiti = await Promise.all(
    Array.from({ length: 8 }, (_, i) => prenota({ data, ora: "19:30", persone: 6 }, `10.1.0.${i}`)),
  );
  const riuscite = esiti.filter((r) => r.status === 201).length;
  assert.equal(riuscite, 3);
  assert.equal(esiti.filter((r) => r.status === 409).length, 5);
  const { fasce } = await (await chiama(`/api/disponibilita?data=${data}`)).json();
  assert.equal(fasce.find((f) => f.ora === "19:30").occupati, 18);
});

test("una richiesta da un altro sito viene bloccata", async () => {
  const r = await chiama("/api/prenotazioni", {
    method: "POST",
    headers: { origin: "https://altro-sito.example" },
    body: {},
  });
  assert.equal(r.status, 403);
});

test("il campo esca non salva nulla", async () => {
  const data = giorno(5);
  const r = await prenota({ data, sito: "spam" }, "10.0.0.3");
  assert.equal(r.status, 201);
  const { fasce } = await (await chiama(`/api/disponibilita?data=${data}`)).json();
  assert.equal(fasce.find((f) => f.ora === "20:30").occupati, 0);
});

test("dopo 10 prenotazioni in un'ora dallo stesso indirizzo scatta il limite", async () => {
  const data = giorno(10);
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await prenota({ data, persone: 1 }, "10.2.0.1")).status, 201);
  }
  assert.equal((await prenota({ data, persone: 1 }, "10.2.0.1")).status, 429);
});

test("l'area riservata è bloccata senza login o con cookie falso", async () => {
  assert.equal((await chiama(`/api/admin/prenotazioni?data=${domani}`)).status, 401);
  const falso = await chiama(`/api/admin/prenotazioni?data=${domani}`, {
    headers: { cookie: `__Host-sessione=${Date.now() + 999999}.firma-falsa` },
  });
  assert.equal(falso.status, 401);
});

test("cinque password errate bloccano i tentativi", async () => {
  const ip = "10.3.0.1";
  for (let i = 0; i < 5; i += 1) {
    const r = await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": ip }, body: { password: "no" } });
    assert.equal(r.status, 401);
  }
  const r = await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": ip }, body: { password: PASSWORD } });
  assert.equal(r.status, 429);
});

test("il login crea una sessione protetta e mostra le prenotazioni", async () => {
  const r = await chiama("/api/admin/login", { method: "POST", headers: { "cf-connecting-ip": "10.3.0.2" }, body: { password: PASSWORD } });
  assert.equal(r.status, 200);
  const intestazione = r.headers.get("set-cookie");
  assert.match(intestazione, /__Host-sessione=/);
  assert.match(intestazione, /HttpOnly/);
  assert.match(intestazione, /Secure/);
  assert.match(intestazione, /SameSite=Strict/);
  cookie = intestazione.split(";")[0];
  const elenco = await chiama(`/api/admin/prenotazioni?data=${domani}`, { headers: { cookie } });
  assert.equal(elenco.status, 200);
  assert.equal((await elenco.json()).prenotazioni.length, 1);
});

test("conferma, annullamento e riattivazione rispettano i coperti", async () => {
  const data = giorno(3);
  const prima = await (await prenota({ data, ora: "13:30", persone: 12 }, "10.4.0.1")).json();
  await prenota({ data, ora: "13:30", persone: 8 }, "10.4.0.1");
  const patch = (id, stato) =>
    chiama(`/api/admin/prenotazioni/${id}`, { method: "PATCH", headers: { cookie }, body: { stato } });

  assert.equal((await patch(prima.id, "confermata")).status, 200);
  assert.equal((await patch(prima.id, "annullata")).status, 200);
  assert.equal((await prenota({ data, ora: "13:30", persone: 6 }, "10.4.0.1")).status, 201);
  assert.equal((await patch(prima.id, "confermata")).status, 409);
  assert.equal((await patch(prima.id, "sbagliato")).status, 400);
  assert.equal((await patch("00000000-0000-4000-8000-000000000000", "confermata")).status, 404);
});

test("la foto accetta solo immagini vere e appare sulla pagina pubblica", async () => {
  assert.equal((await chiama("/api/foto")).status, 404);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const finta = await chiama("/api/admin/foto", { method: "PUT", headers: { cookie }, body: Buffer.from("<script>"), grezzo: true });
  assert.equal(finta.status, 415);
  const vera = await chiama("/api/admin/foto", { method: "PUT", headers: { cookie }, body: png, grezzo: true });
  assert.equal(vera.status, 200);
  const letta = await chiama("/api/foto");
  assert.equal(letta.status, 200);
  assert.equal(letta.headers.get("content-type"), "image/png");
});

test("dopo il logout il cookie viene cancellato", async () => {
  const r = await chiama("/api/admin/logout", { method: "POST", headers: { cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});
