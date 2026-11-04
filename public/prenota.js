const $ = (id) => document.getElementById(id);
const modulo = $("modulo");
const stato = { data: null, ora: null, persone: 2, fasce: [] };
let ultimaRichiesta = 0;

function isoRoma(data) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(data);
}

function testoData(iso) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function creaGiorni() {
  const oggi = Date.parse(`${isoRoma(new Date())}T12:00:00Z`);
  for (let i = 0; i < 14; i += 1) {
    const iso = new Date(oggi + i * 86400000).toISOString().slice(0, 10);
    const d = new Date(`${iso}T12:00:00Z`);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "giorno";
    b.dataset.data = iso;
    const sopra = document.createElement("small");
    const numero = document.createElement("b");
    const sotto = document.createElement("small");
    sopra.textContent = i === 0 ? "Oggi" : d.toLocaleDateString("it-IT", { weekday: "short", timeZone: "UTC" });
    numero.textContent = String(d.getUTCDate());
    sotto.textContent = d.toLocaleDateString("it-IT", { month: "short", timeZone: "UTC" });
    b.append(sopra, numero, sotto);
    b.setAttribute("aria-label", testoData(iso));
    b.addEventListener("click", () => scegliGiorno(iso));
    $("giorni").append(b);
  }
}

async function scegliGiorno(iso) {
  stato.data = iso;
  stato.ora = null;
  document.querySelectorAll(".giorno").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.data === iso));
  });
  await caricaFasce();
}

async function caricaFasce() {
  const richiesta = ++ultimaRichiesta;
  try {
    const r = await fetch(`/api/disponibilita?data=${stato.data}`);
    const dati = await r.json();
    if (richiesta !== ultimaRichiesta) return;
    if (!r.ok) throw new Error(dati.errore);
    stato.fasce = dati.fasce;
    disegnaFasce();
  } catch (e) {
    if (richiesta !== ultimaRichiesta) return;
    $("fasce").replaceChildren(testoStato(e.message || "Non riesco a caricare i posti. Ricarica la pagina."));
  }
  aggiornaInvio();
}

function testoStato(testo) {
  const p = document.createElement("p");
  p.className = "stato";
  p.textContent = testo;
  return p;
}

function disegnaFasce() {
  const contenitore = $("fasce");
  contenitore.replaceChildren();
  contenitore.setAttribute("role", "radiogroup");
  contenitore.setAttribute("aria-label", "Orario");
  let servizio = "";
  for (const f of stato.fasce) {
    if (f.servizio !== servizio) {
      servizio = f.servizio;
      const titolo = document.createElement("p");
      titolo.className = "servizio";
      titolo.textContent = servizio === "pranzo" ? "Pranzo" : "Cena";
      contenitore.append(titolo);
    }
    contenitore.append(creaFascia(f));
  }
  if (stato.ora && !fasciaPrenotabile(stato.fasce.find((f) => f.ora === stato.ora))) stato.ora = null;
}

function fasciaPrenotabile(f) {
  return Boolean(f) && f.disponibile && f.liberi >= stato.persone;
}

function etichettaLiberi(f) {
  if (!f.disponibile) return "Orario passato";
  if (f.liberi === 0) return "Al completo";
  if (f.liberi < stato.persone) return `Solo ${f.liberi === 1 ? "1 posto" : `${f.liberi} posti`}`;
  return `${f.liberi} posti liberi`;
}

function creaFascia(f) {
  const b = document.createElement("button");
  const scelta = stato.ora === f.ora;
  b.type = "button";
  b.className = "fascia";
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", String(scelta));
  b.disabled = !fasciaPrenotabile(f);

  const ora = document.createElement("span");
  ora.className = "ora";
  ora.textContent = f.ora;

  const posti = document.createElement("span");
  posti.className = "posti";
  posti.setAttribute("aria-hidden", "true");
  for (let i = 0; i < f.coperti; i += 1) {
    const s = document.createElement("i");
    s.className = "seggiola";
    if (i < f.occupati) s.classList.add("occupata");
    else if (fasciaPrenotabile(f) && i < f.occupati + stato.persone) s.classList.add("tua");
    posti.append(s);
  }

  const liberi = document.createElement("span");
  liberi.className = "liberi";
  liberi.textContent = etichettaLiberi(f);

  b.append(ora, posti, liberi);
  b.addEventListener("click", () => {
    stato.ora = f.ora;
    disegnaFasce();
    aggiornaInvio();
  });
  return b;
}

function cambiaPersone(delta) {
  stato.persone = Math.min(12, Math.max(1, stato.persone + delta));
  $("persone").textContent = String(stato.persone);
  $("meno").disabled = stato.persone === 1;
  $("piu").disabled = stato.persone === 12;
  disegnaFasce();
  aggiornaInvio();
}

function aggiornaInvio() {
  const invia = $("invia");
  invia.disabled = !stato.ora;
  invia.textContent = stato.ora ? `Prenota alle ${stato.ora}` : "Scegli un orario";
}

function mostraErrore(testo) {
  const m = $("messaggio");
  m.textContent = testo;
  m.hidden = !testo;
}

modulo.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  mostraErrore("");
  if (!modulo.reportValidity() || !stato.ora) return;
  const campi = new FormData(modulo);
  const invia = $("invia");
  invia.disabled = true;
  invia.textContent = "Invio la prenotazione";
  try {
    const r = await fetch("/api/prenotazioni", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: stato.data,
        ora: stato.ora,
        persone: stato.persone,
        nome: campi.get("nome"),
        contatto: campi.get("contatto"),
        note: campi.get("note"),
        sito: campi.get("sito"),
      }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    $("riepilogo").textContent =
      `${testoData(stato.data)} alle ${stato.ora}, ${stato.persone === 1 ? "1 persona" : `${stato.persone} persone`}, a nome ${campi.get("nome").trim()}.`;
    modulo.hidden = true;
    $("conferma").hidden = false;
    $("conferma").focus();
  } catch (e) {
    mostraErrore(e.message || "Prenotazione non inviata. Controlla la connessione e riprova.");
    await caricaFasce();
  }
});

$("nuova").addEventListener("click", async () => {
  modulo.reset();
  modulo.hidden = false;
  $("conferma").hidden = true;
  stato.ora = null;
  await caricaFasce();
  $("invia").focus();
});

$("meno").addEventListener("click", () => cambiaPersone(-1));
$("piu").addEventListener("click", () => cambiaPersone(1));

const foto = $("foto");
foto.addEventListener("load", () => { foto.hidden = false; });
foto.src = "/api/foto";

creaGiorni();
scegliGiorno(document.querySelector(".giorno").dataset.data);
