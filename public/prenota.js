import { applicaTesti, lingua, locale, persone, quandoCambia, selettoreLingua, servizio, t, testoData } from "./lingue.js";

const $ = (id) => document.getElementById(id);
const modulo = $("modulo");
const stato = { data: null, ora: null, persone: 2, slot: [], info: null, mese: null, conferma: null };
let ultimaRichiesta = 0;

const testoMese = (mese) =>
  new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mese}-15T12:00:00Z`));
const giornoSettimana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const spostaData = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const spostaMese = (mese, n) => {
  const [a, m] = mese.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const NOMI_CANALE = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };
// Dal lunedì alla domenica: 5 gennaio 2026 era un lunedì.
const intestazioni = () => [5, 6, 7, 8, 9, 10, 11].map((g) => testoData(`2026-01-${String(g).padStart(2, "0")}`, { weekday: "short" }));

function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo != null) el.textContent = testo;
  return el;
}

async function caricaInfo() {
  const r = await fetch("/api/ristorante");
  if (!r.ok) throw new Error(t("errore_info"));
  stato.info = await r.json();
  mostraImmagine($("logo"), "logo", stato.info.logo);
  mostraImmagine($("foto"), "foto", stato.info.foto);
  testiRistorante();
  creaPersone();
  creaCalendario();
}

/** Testi della colonna del ristorante: cambiano con la lingua. */
function testiRistorante() {
  const info = stato.info;
  if (!info) return;
  document.title = t("titolo_documento", { nome: info.nome });
  $("nome-ristorante").textContent = info.nome;
  $("indirizzo").textContent = info.indirizzo;
  $("prezzo").textContent = info.prezzo_medio ? t("prezzo_medio", { n: info.prezzo_medio }) : "";
  $("descrizione").textContent = info.descrizioni?.[lingua()] || info.descrizione;
  $("gruppi").textContent = t("gruppi", { max: info.max_persone_online, telefono: info.telefono });
  $("logo").alt = t("logo_alt", { nome: info.nome });
  $("foto").alt = t("foto_alt");
}

function mostraImmagine(img, chiave, versione) {
  if (!versione) return;
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
    $("fasce").replaceChildren(crea("p", "stato", t("nessun_giorno")));
  }
}

function disegnaCalendario() {
  const box = $("calendario");
  const primoMese = stato.info.oggi.slice(0, 7);
  const ultimoMese = ultimoGiorno().slice(0, 7);

  const prima = crea("button", "mese-nav", "‹");
  prima.type = "button";
  prima.setAttribute("aria-label", t("mese_prec"));
  prima.disabled = stato.mese <= primoMese;
  prima.addEventListener("click", () => cambiaMese(spostaMese(stato.mese, -1)));

  const dopo = crea("button", "mese-nav", "›");
  dopo.type = "button";
  dopo.setAttribute("aria-label", t("mese_succ"));
  dopo.disabled = stato.mese >= ultimoMese;
  dopo.addEventListener("click", () => cambiaMese(spostaMese(stato.mese, 1)));

  const scelta = crea("select", "mese-scelta");
  scelta.setAttribute("aria-label", t("mese"));
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
  for (const g of intestazioni()) griglia.append(crea("span", "intestazione-giorno", g));

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
    b.setAttribute("aria-label", `${testoData(iso)}${chiuso ? `, ${t("chiuso")}` : fuori ? `, ${t("non_prenotabile")}` : ""}`);
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
  $("data-scelta").textContent = t("hai_scelto", { data: testoData(iso) });
  caricaFasce();
}

async function caricaFasce() {
  if (!stato.data) return;
  const richiesta = ++ultimaRichiesta;
  aggiornaInvio();
  try {
    const r = await fetch(`/api/disponibilita?data=${stato.data}&persone=${stato.persone}&lingua=${lingua()}`);
    const dati = await r.json();
    if (richiesta !== ultimaRichiesta) return;
    if (!r.ok) throw new Error(dati.errore);
    stato.slot = dati.chiuso ? [] : dati.slot;
    stato.motivo = dati.chiuso ? dati.motivo : "";
    if (dati.chiuso) {
      $("fasce").replaceChildren(crea("p", "stato", dati.motivo));
    } else {
      if (stato.ora && !stato.slot.some((s) => s.ora === stato.ora && s.disponibile)) stato.ora = null;
      disegnaFasce();
    }
  } catch (e) {
    if (richiesta !== ultimaRichiesta) return;
    $("fasce").replaceChildren(crea("p", "stato", e.message || t("errore_orari")));
  }
  aggiornaInvio();
}

function disegnaFasce() {
  const box = $("fasce");
  box.replaceChildren();
  const servizi = [...new Set(stato.slot.map((s) => s.servizio))];
  let liberi = 0;
  for (const nome of servizi) {
    box.append(crea("p", "servizio", servizio(nome)));
    const griglia = crea("div", "orari");
    griglia.setAttribute("role", "radiogroup");
    griglia.setAttribute("aria-label", servizio(nome));
    for (const s of stato.slot.filter((x) => x.servizio === nome)) {
      const b = crea("button", "orario");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(stato.ora === s.ora));
      b.disabled = !s.disponibile;
      b.append(crea("span", "ora", s.ora));
      if (s.sconto) b.append(crea("span", "sconto", `-${s.sconto}%`));
      b.setAttribute("aria-label", `${s.ora}${s.sconto ? `, ${t("sconto", { n: s.sconto })}` : ""}${s.disponibile ? "" : `, ${t("non_disponibile")}`}`);
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
  if (!liberi) box.append(crea("p", "stato", t("nessun_tavolo", { persone: persone(stato.persone) })));
}

function aggiornaInvio() {
  const invia = $("invia");
  const scelto = stato.slot.find((s) => s.ora === stato.ora);
  invia.disabled = !scelto;
  invia.textContent = scelto ? t("prenota_per", { persone: persone(stato.persone), ora: scelto.ora }) : t("scegli_orario");
  const promo = $("promo-scelta");
  promo.hidden = !scelto?.sconto;
  if (scelto?.sconto) promo.textContent = t("promo", { n: scelto.sconto });
}

function aggiornaCanale() {
  const canale = new FormData(modulo).get("canale");
  const email = modulo.querySelector("[name=email]");
  email.required = canale === "email";
  $("etichetta-email").textContent = canale === "email" ? t("email") : t("email_facoltativa");
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
  invia.textContent = t("invio");
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
        marketing: campi.get("marketing") === "on",
        lingua: lingua(),
        sito: campi.get("sito"),
      }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    stato.conferma = { ...dati, nome: campi.get("nome").trim(), canale: campi.get("canale"), data: stato.data, ora: stato.ora, persone: stato.persone };
    mostraConferma();
    $("conferma").hidden = false;
    modulo.hidden = true;
    $("conferma").focus();
  } catch (e) {
    mostraErrore(e.message || t("errore_invio"));
    await caricaFasce();
  }
});

function mostraConferma() {
  const c = stato.conferma;
  if (!c) return;
  const l = lingua() === "it" ? "" : `&l=${lingua()}`;
  const link = `${location.origin}/prenotazione#id=${c.id}&t=${c.token}${l}`;
  const via = NOMI_CANALE[c.canale] ?? "email";
  const sconto = c.sconto ? ` ${t("sconto_registrato", { n: c.sconto })}` : "";
  $("riepilogo").textContent = t("riepilogo", { data: testoData(c.data), ora: c.ora, persone: persone(c.persone), nome: c.nome });
  $("codice").textContent = c.codice;
  $("titolo-conferma").textContent = c.stato === "confermata" ? t("confermata") : t("ricevuta");
  $("stato-conferma").textContent = (c.stato === "confermata" ? t("stato_confermata", { via }) : t("stato_attesa", { via })) + sconto;
  $("link-gestione").href = link;
}

$("copia-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("link-gestione").href);
    $("copia-link").textContent = t("link_copiato");
  } catch {
    $("copia-link").textContent = t("copia_fallita");
  }
});

$("nuova").addEventListener("click", () => {
  modulo.reset();
  aggiornaCanale();
  modulo.hidden = false;
  $("conferma").hidden = true;
  stato.ora = null;
  stato.conferma = null;
  caricaFasce();
  $("invia").focus();
});

/** Cambio di lingua: tutto si ridisegna senza perdere giorno, orario e dati già scritti. */
quandoCambia(() => {
  testiRistorante();
  aggiornaCanale();
  if (!stato.info) return;
  creaPersone();
  disegnaCalendario();
  if (stato.data) $("data-scelta").textContent = t("hai_scelto", { data: testoData(stato.data) });
  if (stato.motivo) caricaFasce();
  else if (stato.slot.length) disegnaFasce();
  aggiornaInvio();
  mostraConferma();
});

selettoreLingua($("scelta-lingua"));
applicaTesti();
aggiornaCanale();
caricaInfo().catch((e) => $("fasce").replaceChildren(crea("p", "stato", e.message)));
