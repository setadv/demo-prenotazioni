import { applicaTesti, lingua, quandoCambia, selettoreLingua, t } from "./lingue.js";

const $ = (id) => document.getElementById(id);
const parametri = new URLSearchParams(location.hash.slice(1));
const id = parametri.get("id") ?? "";
const token = parametri.get("t") ?? "";
const DOMANDE = ["voto_cibo", "voto_servizio", "voto_ambiente", "voto_prezzo"];
const CHIAVI = { voto_cibo: "q_cibo", voto_servizio: "q_servizio", voto_ambiente: "q_ambiente", voto_prezzo: "q_prezzo" };
const risposte = {};
let info = null;

function pulsanti(contenitore, valori, chiave, etichetta) {
  contenitore.replaceChildren(
    ...valori.map((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = chiave === "consiglio" ? "voto-numero" : "stella";
      b.textContent = chiave === "consiglio" ? String(v) : "★";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", etichetta(v));
      b.setAttribute("aria-checked", String(risposte[chiave] === v));
      if (chiave !== "consiglio" && risposte[chiave] >= v) b.classList.add("piena");
      b.addEventListener("click", () => {
        risposte[chiave] = v;
        disegna();
        contenitore.querySelector('[aria-checked="true"]')?.focus();
      });
      return b;
    }),
  );
}

function disegna() {
  if (!info) return;
  document.title = t("titolo_sondaggio", { nome: info.ristorante });
  $("titolo").textContent = t("titolo_sondaggio", { nome: info.ristorante });
  $("intro").textContent = t("sondaggio_intro", { nome: info.nome });
  const box = $("domande");
  if (!box.childElementCount) {
    for (const k of DOMANDE) {
      const f = document.createElement("fieldset");
      f.className = "domanda";
      const legend = document.createElement("legend");
      legend.dataset.chiave = k;
      const stelle = document.createElement("div");
      stelle.className = "stelle";
      stelle.setAttribute("role", "radiogroup");
      stelle.id = `stelle-${k}`;
      f.append(legend, stelle);
      box.append(f);
    }
  }
  for (const k of DOMANDE) {
    box.querySelector(`[data-chiave="${k}"]`).textContent = t(CHIAVI[k]);
    const stelle = $(`stelle-${k}`);
    stelle.setAttribute("aria-label", t(CHIAVI[k]));
    pulsanti(stelle, [1, 2, 3, 4, 5], k, (v) => t("voto_di", { n: v }));
  }
  $("q-consiglio").textContent = t("q_consiglio", { nome: info.ristorante });
  $("scala").setAttribute("aria-label", t("q_consiglio", { nome: info.ristorante }));
  pulsanti($("scala"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "consiglio", (v) => String(v));
}

function ringrazia(link) {
  $("modulo").hidden = true;
  $("grazie").hidden = false;
  $("recensione").hidden = !link;
  if (link) $("link-recensione").href = link;
  $("grazie").focus();
}

$("modulo").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("messaggio").hidden = true;
  if (DOMANDE.some((k) => !risposte[k])) {
    $("messaggio").textContent = t("voto_mancante");
    $("messaggio").hidden = false;
    return;
  }
  try {
    const r = await fetch(`/api/sondaggio/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sondaggio-token": token },
      body: JSON.stringify({ ...risposte, commento: new FormData($("modulo")).get("commento"), lingua: lingua() }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    ringrazia(dati.link_recensioni);
  } catch (err) {
    $("messaggio").textContent = err.message || t("errore_generico");
    $("messaggio").hidden = false;
  }
});

async function carica() {
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) {
    $("caricamento").hidden = true;
    $("errore").textContent = t("link_non_valido");
    $("errore").hidden = false;
    return;
  }
  try {
    const r = await fetch(`/api/sondaggio/${id}`, { headers: { "x-sondaggio-token": token, "x-lingua": lingua() } });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    info = dati;
    $("caricamento").hidden = true;
    if (dati.compilato) ringrazia(dati.link_recensioni);
    else {
      $("modulo").hidden = false;
      disegna();
    }
  } catch (e) {
    $("caricamento").hidden = true;
    $("errore").textContent = e.message || t("errore_generico");
    $("errore").hidden = false;
  }
}

quandoCambia(disegna);
selettoreLingua($("scelta-lingua"));
applicaTesti();
carica();
