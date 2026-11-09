const $ = (id) => document.getElementById(id);
const modulo = $("modulo");
const stato = { data: null, ora: null, persone: 2, slot: [], info: null };
let ultimaRichiesta = 0;

const testoData = (iso) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
const giornoSettimana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const spostaData = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const persone = (n) => (n === 1 ? "1 persona" : `${n} persone`);

function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo != null) el.textContent = testo;
  return el;
}

async function caricaInfo() {
  const r = await fetch("/api/ristorante");
  if (!r.ok) throw new Error("Non riesco a caricare il ristorante. Ricarica la pagina.");
  const info = await r.json();
  stato.info = info;
  document.title = `${info.nome}, prenota un tavolo`;
  $("nome-ristorante").textContent = info.nome;
  $("indirizzo").textContent = info.indirizzo;
  $("prezzo").textContent = info.prezzo_medio ? `Prezzo medio ${info.prezzo_medio} € a persona` : "";
  $("descrizione").textContent = info.descrizione;
  $("gruppi").textContent = `Per gruppi di più di ${info.max_persone_online} persone chiama il ${info.telefono}.`;
  creaPersone();
  creaGiorni();
}

function creaPersone() {
  const box = $("persone");
  box.replaceChildren();
  stato.persone = Math.min(stato.persone, stato.info.max_persone_online);
  for (let n = 1; n <= stato.info.max_persone_online; n += 1) {
    const b = crea("button", "scelta", String(n));
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", persone(n));
    b.setAttribute("aria-checked", String(n === stato.persone));
    b.addEventListener("click", () => {
      stato.persone = n;
      box.querySelectorAll(".scelta").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      caricaFasce();
    });
    box.append(b);
  }
}

function giornoAperto(iso) {
  const g = giornoSettimana(iso);
  return stato.info.orari.some((o) => o.giorno === g) && !stato.info.chiusure.includes(iso);
}

function creaGiorni() {
  const box = $("giorni");
  box.replaceChildren();
  const giorni = Math.min(stato.info.giorni_prenotabili, 30);
  let primo = null;
  for (let i = 0; i <= giorni; i += 1) {
    const iso = spostaData(stato.info.oggi, i);
    const aperto = giornoAperto(iso);
    const d = new Date(`${iso}T12:00:00Z`);
    const b = crea("button", "giorno");
    b.type = "button";
    b.dataset.data = iso;
    b.disabled = !aperto;
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", `${testoData(iso)}${aperto ? "" : ", chiuso"}`);
    b.append(
      crea("small", "", i === 0 ? "Oggi" : d.toLocaleDateString("it-IT", { weekday: "short", timeZone: "UTC" })),
      crea("b", "", String(d.getUTCDate())),
      crea("small", "", aperto ? d.toLocaleDateString("it-IT", { month: "short", timeZone: "UTC" }) : "chiuso"),
    );
    b.addEventListener("click", () => scegliGiorno(iso));
    box.append(b);
    if (aperto && !primo) primo = iso;
  }
  if (primo) scegliGiorno(primo);
  else $("fasce").replaceChildren(crea("p", "stato", "Nessun giorno prenotabile online. Chiama il ristorante."));
}

function scegliGiorno(iso) {
  stato.data = iso;
  stato.ora = null;
  document.querySelectorAll(".giorno").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.data === iso)));
  caricaFasce();
}

async function caricaFasce() {
  if (!stato.data) return;
  const richiesta = ++ultimaRichiesta;
  aggiornaInvio();
  try {
    const r = await fetch(`/api/disponibilita?data=${stato.data}&persone=${stato.persone}`);
    const dati = await r.json();
    if (richiesta !== ultimaRichiesta) return;
    if (!r.ok) throw new Error(dati.errore);
    stato.slot = dati.chiuso ? [] : dati.slot;
    if (dati.chiuso) {
      $("fasce").replaceChildren(crea("p", "stato", dati.motivo));
    } else {
      if (stato.ora && !stato.slot.some((s) => s.ora === stato.ora && s.disponibile)) stato.ora = null;
      disegnaFasce();
    }
  } catch (e) {
    if (richiesta !== ultimaRichiesta) return;
    $("fasce").replaceChildren(crea("p", "stato", e.message || "Non riesco a caricare gli orari. Ricarica la pagina."));
  }
  aggiornaInvio();
}

function disegnaFasce() {
  const box = $("fasce");
  box.replaceChildren();
  const servizi = [...new Set(stato.slot.map((s) => s.servizio))];
  let liberi = 0;
  for (const servizio of servizi) {
    box.append(crea("p", "servizio", servizio));
    const griglia = crea("div", "orari");
    griglia.setAttribute("role", "radiogroup");
    griglia.setAttribute("aria-label", servizio);
    for (const s of stato.slot.filter((x) => x.servizio === servizio)) {
      const b = crea("button", "orario");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(stato.ora === s.ora));
      b.disabled = !s.disponibile;
      b.append(crea("span", "ora", s.ora));
      if (s.sconto) b.append(crea("span", "sconto", `-${s.sconto}%`));
      b.setAttribute("aria-label", `${s.ora}${s.sconto ? `, sconto ${s.sconto}%` : ""}${s.disponibile ? "" : ", non disponibile"}`);
      if (s.disponibile) liberi += 1;
      b.addEventListener("click", () => {
        stato.ora = s.ora;
        disegnaFasce();
        aggiornaInvio();
      });
      griglia.append(b);
    }
    box.append(griglia);
  }
  if (!liberi) {
    box.append(crea("p", "stato", `Nessun tavolo libero per ${persone(stato.persone)} in questa data. Prova un altro giorno.`));
  }
}

function aggiornaInvio() {
  const invia = $("invia");
  const scelto = stato.slot.find((s) => s.ora === stato.ora);
  invia.disabled = !scelto;
  invia.textContent = scelto ? `Prenota per ${persone(stato.persone)} alle ${scelto.ora}` : "Scegli un orario";
  const promo = $("promo-scelta");
  promo.hidden = !scelto?.sconto;
  if (scelto?.sconto) promo.textContent = `Con questo orario hai uno sconto del ${scelto.sconto}% sul conto alla carta, bevande escluse.`;
}

function mostraErrore(testo) {
  $("messaggio").textContent = testo;
  $("messaggio").hidden = !testo;
}

modulo.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  mostraErrore("");
  if (!stato.ora) return;
  if (!modulo.reportValidity()) return;
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
        telefono: campi.get("telefono"),
        email: campi.get("email"),
        occasione: campi.get("occasione"),
        note: campi.get("note"),
        privacy: campi.get("privacy") === "on",
        sito: campi.get("sito"),
      }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    mostraConferma(dati, campi.get("nome").trim());
  } catch (e) {
    mostraErrore(e.message || "Prenotazione non inviata. Controlla la connessione e riprova.");
    await caricaFasce();
  }
});

function mostraConferma(dati, nome) {
  const link = `${location.origin}/prenotazione#id=${dati.id}&t=${dati.token}`;
  $("riepilogo").textContent = `${testoData(stato.data)} alle ${stato.ora}, ${persone(stato.persone)}, a nome ${nome}.`;
  $("codice").textContent = dati.codice;
  $("titolo-conferma").textContent = dati.stato === "confermata" ? "Prenotazione confermata" : "Prenotazione ricevuta";
  $("stato-conferma").textContent =
    dati.stato === "confermata"
      ? `Ti aspettiamo.${dati.sconto ? ` Lo sconto del ${dati.sconto}% è già registrato.` : ""}`
      : `Il ristorante la conferma a breve: controlla lo stato dal link qui sotto.${dati.sconto ? ` Lo sconto del ${dati.sconto}% è già registrato.` : ""}`;
  $("link-gestione").href = link;
  $("copia-link").textContent = "Copia il link";
  modulo.hidden = true;
  $("conferma").hidden = false;
  $("conferma").focus();
}

$("copia-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("link-gestione").href);
    $("copia-link").textContent = "Link copiato";
  } catch {
    $("copia-link").textContent = "Copia non riuscita: tieni premuto sul link";
  }
});

$("nuova").addEventListener("click", () => {
  modulo.reset();
  modulo.hidden = false;
  $("conferma").hidden = true;
  stato.ora = null;
  caricaFasce();
  $("invia").focus();
});

const foto = $("foto");
foto.addEventListener("load", () => {
  foto.hidden = false;
});
foto.src = "/api/foto";

caricaInfo().catch((e) => $("fasce").replaceChildren(crea("p", "stato", e.message)));
