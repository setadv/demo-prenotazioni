import { applicaTesti, euro, lingua, quandoCambia, selettoreLingua, t } from "./lingue.js";

const $ = (id) => document.getElementById(id);
const modulo = $("modulo");
let info = null;
let importo = null;

function disegna() {
  if (!info) return;
  const r = info.ristorante;
  document.title = `${r.nome}, ${t("titolo_regalo").toLowerCase()}`;
  $("ristorante").textContent = r.nome;
  $("intro").textContent = t("regalo_intro", { nome: r.nome, mesi: info.validita_mesi });
  if (!info.online) {
    $("stato").textContent = t("regalo_offline", { telefono: r.telefono });
    $("stato").hidden = false;
    modulo.hidden = true;
    return;
  }
  $("stato").hidden = true;
  modulo.hidden = false;
  const box = $("importi");
  box.setAttribute("aria-label", t("importo_domanda"));
  box.replaceChildren(
    ...info.importi.map((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "scelta scelta-importo";
      b.textContent = euro(n * 100).replace(/[,.]00(?=\D|$)/, "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(n === importo));
      b.addEventListener("click", () => {
        importo = n;
        disegna();
      });
      return b;
    }),
  );
  $("invia").textContent = importo ? t("paga_regalo", { importo: euro(importo * 100) }) : t("importo_domanda");
  $("invia").disabled = !importo;
}

modulo.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("messaggio").hidden = true;
  if (!importo || !modulo.reportValidity()) return;
  const f = new FormData(modulo);
  $("invia").disabled = true;
  try {
    const r = await fetch("/api/gift", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(f), importo, privacy: f.get("privacy") === "on", lingua: lingua() }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    location.href = dati.url_pagamento;
  } catch (err) {
    $("messaggio").textContent = err.message || t("errore_generico");
    $("messaggio").hidden = false;
    $("invia").disabled = false;
  }
});

quandoCambia(disegna);
selettoreLingua($("scelta-lingua"));
applicaTesti();
fetch("/api/gift")
  .then((r) => r.json())
  .then((dati) => {
    info = dati;
    importo = dati.importi[1] ?? dati.importi[0] ?? null;
    disegna();
  })
  .catch(() => {
    $("stato").textContent = t("errore_generico");
  });
