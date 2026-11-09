const $ = (id) => document.getElementById(id);
const modulo = $("modulo");
const stato = { data: null, ora: null, persone: 2, slot: [], info: null, mese: null };
let ultimaRichiesta = 0;

const testoData = (iso) =>
  new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
const testoMese = (mese) =>
  new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mese}-15T12:00:00Z`));
const giornoSettimana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const spostaData = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const spostaMese = (mese, n) => {
  const [a, m] = mese.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const persone = (n) => (n === 1 ? "1 persona" : `${n} persone`);
const NOMI_CANALE = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };
const INTESTAZIONI = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

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
  mostraImmagine($("logo"), "logo", info.logo, `Logo di ${info.nome}`);
  mostraImmagine($("foto"), "foto", info.foto, "La sala del ristorante");
  creaPersone();
  creaCalendario();
}

function mostraImmagine(img, chiave, versione, alt) {
  if (!versione) return;
  img.alt = alt;
  img.addEventListener("load", () => {
    img.hidden = false;
  });
  img.src = `/api/media/${chiave}?v=${encodeURIComponent(versione)}`;
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

const ultimoGiorno = () => spostaData(stato.info.oggi, stato.info.giorni_prenotabili);

function giornoAperto(iso) {
  const g = giornoSettimana(iso);
  return stato.info.orari.some((o) => o.giorno === g) && !stato.info.chiusure.includes(iso);
}

function prenotabile(iso) {
  return iso >= stato.info.oggi && iso <= ultimoGiorno() && giornoAperto(iso);
}

function creaCalendario() {
  let primo = null;
  for (let i = 0; i <= stato.info.giorni_prenotabili && !primo; i += 1) {
    const iso = spostaData(stato.info.oggi, i);
    if (prenotabile(iso)) primo = iso;
  }
  stato.mese = (primo ?? stato.info.oggi).slice(0, 7);
  if (primo) scegliGiorno(primo);
  else {
    disegnaCalendario();
    $("fasce").replaceChildren(crea("p", "stato", "Nessun giorno prenotabile online. Chiama il ristorante."));
  }
}

function disegnaCalendario() {
  const box = $("calendario");
  const primoMese = stato.info.oggi.slice(0, 7);
  const ultimoMese = ultimoGiorno().slice(0, 7);

  const prima = crea("button", "mese-nav", "‹");
  prima.type = "button";
  prima.setAttribute("aria-label", "Mese precedente");
  prima.disabled = stato.mese <= primoMese;
  prima.addEventListener("click", () => cambiaMese(spostaMese(stato.mese, -1)));

  const dopo = crea("button", "mese-nav", "›");
  dopo.type = "button";
  dopo.setAttribute("aria-label", "Mese successivo");
  dopo.disabled = stato.mese >= ultimoMese;
  dopo.addEventListener("click", () => cambiaMese(spostaMese(stato.mese, 1)));

  const scelta = crea("select", "mese-scelta");
  scelta.setAttribute("aria-label", "Mese");
  for (let m = primoMese; m <= ultimoMese; m = spostaMese(m, 1)) {
    const o = crea("option", null, testoMese(m));
    o.value = m;
    o.selected = m === stato.mese;
    scelta.append(o);
  }
  scelta.addEventListener("change", () => cambiaMese(scelta.value));

  const griglia = crea("div", "griglia-giorni");
  griglia.setAttribute("role", "group");
  griglia.setAttribute("aria-label", testoMese(stato.mese));
  for (const g of INTESTAZIONI) griglia.append(crea("span", "intestazione-giorno", g));

  const primo = `${stato.mese}-01`;
  const vuoti = (giornoSettimana(primo) + 6) % 7;
  for (let i = 0; i < vuoti; i += 1) griglia.append(crea("span", "vuoto-giorno"));
  for (let iso = primo; iso.slice(0, 7) === stato.mese; iso = spostaData(iso, 1)) {
    const fuori = iso < stato.info.oggi || iso > ultimoGiorno();
    const chiuso = !fuori && !giornoAperto(iso);
    const b = crea("button", `giorno-cal${chiuso ? " chiuso" : ""}${iso === stato.info.oggi ? " oggi" : ""}`, String(Number(iso.slice(8))));
    b.type = "button";
    b.disabled = fuori || chiuso;
    b.setAttribute("aria-pressed", String(iso === stato.data));
    b.setAttribute("aria-label", `${testoData(iso)}${chiuso ? ", chiuso" : fuori ? ", non prenotabile" : ""}`);
    b.addEventListener("click", () => scegliGiorno(iso));
    griglia.append(b);
  }

  box.replaceChildren(crea("div", "testa-calendario"), griglia);
  box.firstChild.append(prima, scelta, dopo);
}

function cambiaMese(mese) {
  stato.mese = mese;
  disegnaCalendario();
  const primoLibero = [...document.querySelectorAll(".giorno-cal:not(:disabled)")][0];
  if (primoLibero) primoLibero.focus();
  else $("calendario").querySelector(".mese-scelta").focus();
}

function scegliGiorno(iso) {
  stato.data = iso;
  stato.ora = null;
  stato.mese = iso.slice(0, 7);
  disegnaCalendario();
  $("data-scelta").textContent = `Hai scelto ${testoData(iso)}.`;
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

function aggiornaCanale() {
  const canale = new FormData(modulo).get("canale");
  const email = modulo.querySelector("[name=email]");
  email.required = canale === "email";
  $("etichetta-email").textContent = canale === "email" ? "Email" : "Email (facoltativa)";
}

function mostraErrore(testo) {
  $("messaggio").textContent = testo;
  $("messaggio").hidden = !testo;
}

modulo.addEventListener("change", (e) => {
  if (e.target.name === "canale") aggiornaCanale();
});

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
        canale: campi.get("canale"),
        note: campi.get("note"),
        privacy: campi.get("privacy") === "on",
        sito: campi.get("sito"),
      }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    mostraConferma(dati, campi.get("nome").trim(), campi.get("canale"));
  } catch (e) {
    mostraErrore(e.message || "Prenotazione non inviata. Controlla la connessione e riprova.");
    await caricaFasce();
  }
});

function mostraConferma(dati, nome, canale) {
  const link = `${location.origin}/prenotazione#id=${dati.id}&t=${dati.token}`;
  const via = NOMI_CANALE[canale] ?? "email";
  const sconto = dati.sconto ? ` Lo sconto del ${dati.sconto}% è già registrato.` : "";
  $("riepilogo").textContent = `${testoData(stato.data)} alle ${stato.ora}, ${persone(stato.persone)}, a nome ${nome}.`;
  $("codice").textContent = dati.codice;
  $("titolo-conferma").textContent = dati.stato === "confermata" ? "Prenotazione confermata" : "Prenotazione ricevuta";
  $("stato-conferma").textContent =
    dati.stato === "confermata"
      ? `Ti aspettiamo. Riceverai il riepilogo via ${via}.${sconto}`
      : `Il ristorante deve ancora confermarla: quando lo farà riceverai un messaggio via ${via}.${sconto}`;
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
  aggiornaCanale();
  modulo.hidden = false;
  $("conferma").hidden = true;
  stato.ora = null;
  caricaFasce();
  $("invia").focus();
});

aggiornaCanale();
caricaInfo().catch((e) => $("fasce").replaceChildren(crea("p", "stato", e.message)));
