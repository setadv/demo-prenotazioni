import { applicaTesti, euro, lingua, quandoCambia, selettoreLingua, t, testoData } from "./lingue.js";

const $ = (id) => document.getElementById(id);
// Il link arriva nel messaggio (#tipo=...) o di ritorno dal pagamento Stripe (?tipo=...).
const parametri = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
const tipo = parametri.get("tipo") === "premio" ? "premio" : "gift";
const id = parametri.get("id") ?? "";
const token = parametri.get("t") ?? "";
const daPagamento = parametri.get("pagato") === "1";
let buono = null;
let tentativi = 0;

function mostra(b) {
  buono = b;
  $("caricamento").hidden = true;
  $("carta").hidden = false;
  $("codice-box").hidden = false;
  $("ristorante").textContent = b.ristorante.nome;
  document.title = `${t(tipo === "gift" ? "gift_card" : "premio_fedelta")}, ${b.ristorante.nome}`;
  $("tipo").textContent = t(tipo === "gift" ? "gift_card" : "premio_fedelta");
  if (tipo === "gift") {
    $("valore").textContent = euro(b.importo);
    $("dedica").hidden = !b.messaggio;
    $("dedica").textContent = b.messaggio ? `“${b.messaggio}”` : "";
    $("persone").textContent = [b.destinatario_nome && t("per_nome", { nome: b.destinatario_nome }), b.acquirente_nome && t("da_nome", { nome: b.acquirente_nome })]
      .filter(Boolean)
      .join(" · ");
  } else {
    $("valore").textContent = b.descrizioni[lingua()] || b.descrizioni.it;
    $("dedica").hidden = true;
    $("persone").textContent = t("premio_per", { nome: b.nome });
  }
  let problema = null;
  if (b.stato === "in_attesa_pagamento") problema = null;
  else if (b.stato === "annullata" || b.stato === "annullato") problema = t("stato_annullato");
  else if (b.stato === "usato") problema = t("stato_usato");
  else if (b.scaduto) problema = t("stato_scaduto");
  else if (tipo === "gift" && b.saldo === 0) problema = t("stato_esaurita");
  $("stato-buono").hidden = !problema && tipo !== "gift";
  $("stato-buono").textContent = problema ?? (tipo === "gift" ? `${t("saldo")}: ${euro(b.saldo)}` : "");
  $("carta").classList.toggle("non-valido", Boolean(problema));
  $("codice").textContent = b.codice;
  $("qr").src = `/api/qr?codice=${encodeURIComponent(b.codice)}`;
  $("qr").alt = b.codice;
  $("validita").textContent = t("valida_fino", { data: testoData(b.scade_il, { day: "numeric", month: "long", year: "numeric" }) });
  $("contatti").textContent = `${b.ristorante.indirizzo} · ${b.ristorante.telefono}`;
  const inAttesa = b.stato === "in_attesa_pagamento";
  $("attivazione").hidden = !inAttesa;
  $("attivazione").textContent = t("gift_in_attivazione");
  $("codice-box").hidden = inAttesa;
  // Di ritorno da Stripe il webhook può arrivare qualche secondo dopo: riprova per un minuto.
  if (inAttesa && daPagamento && tentativi < 20) {
    tentativi += 1;
    setTimeout(carica, 3000);
  }
}

async function carica() {
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) {
    $("caricamento").hidden = true;
    $("errore").textContent = t("link_non_valido");
    $("errore").hidden = false;
    return;
  }
  try {
    const r = await fetch(`/api/buoni/${tipo}/${id}`, { headers: { "x-buono-token": token, "x-lingua": document.documentElement.lang } });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    mostra(dati);
  } catch (e) {
    $("caricamento").hidden = true;
    $("errore").textContent = e.message || t("errore_generico");
    $("errore").hidden = false;
  }
}

quandoCambia(() => buono && mostra(buono));
selettoreLingua($("scelta-lingua"));
applicaTesti();
carica();
