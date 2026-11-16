import { applicaTesti, euro, quandoCambia, selettoreLingua, t, testoData, tradotto } from "./lingue.js";

const $ = (id) => document.getElementById(id);
// Il link arriva nel messaggio (#id=...) o di ritorno dal pagamento Stripe (?id=...).
const parametri = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
const id = parametri.get("id") ?? "";
const token = parametri.get("t") ?? "";
let ordine = null;
let timer;

const PASSI = {
  asporto: ["nuovo", "in_preparazione", "pronto", "completato"],
  consegna: ["nuovo", "in_preparazione", "in_consegna", "completato"],
};

function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo != null) el.textContent = testo;
  return el;
}

function mostra(o) {
  ordine = o;
  document.title = t("tuo_ordine", { codice: o.codice });
  $("caricamento").hidden = true;
  $("dettaglio").hidden = false;
  $("ristorante").textContent = o.ristorante.nome;
  $("titolo").textContent = t(`ord_${o.stato}`);
  const passi = PASSI[o.tipo];
  const posizione = passi.indexOf(o.stato);
  $("passi").hidden = o.stato === "annullato" || o.stato === "in_attesa_pagamento";
  $("passi").replaceChildren(
    ...passi.map((p, i) => {
      const li = crea("li", i < posizione ? "fatto" : i === posizione ? "attuale" : "", t(`ord_${p}`));
      if (i === posizione) li.setAttribute("aria-current", "step");
      return li;
    }),
  );
  $("attesa").hidden = o.stato !== "in_attesa_pagamento";
  $("attesa").textContent = t("pagamento_attesa");
  $("quando").textContent = t(o.tipo === "consegna" ? "consegna_quando" : "ritiro_quando", { data: testoData(o.data), ora: o.ora });
  $("dove-etichetta").textContent = t(o.tipo === "consegna" ? "tipo_consegna" : "tipo_asporto");
  $("dove").textContent = o.tipo === "consegna" ? t("consegna_dove", { indirizzo: o.indirizzo, cap: o.cap }) : t("ritiro_dove", { indirizzo: o.ristorante.indirizzo });
  $("nome").textContent = o.nome;
  const pagamento = o.pagato ? t("pagato_online") : t(o.tipo === "consegna" ? "da_pagare_consegna" : "da_pagare_ritiro");
  $("totale").textContent = `${euro(o.totale)} · ${pagamento}`;
  const riga = (sinistra, destra) => {
    const li = crea("li");
    li.append(crea("span", null, sinistra), crea("span", null, destra));
    return li;
  };
  $("righe").replaceChildren(
    ...o.righe.map((r) => riga(`${r.quantita} × ${tradotto(r, "nome")}`, euro(r.prezzo * r.quantita))),
    ...(o.tipo === "consegna" ? [riga(t("spese"), o.spese_consegna ? euro(o.spese_consegna) : t("gratis"))] : []),
  );
  $("contatti").textContent = o.ristorante.telefono;
  clearTimeout(timer);
  // Si aggiorna da sola finché l'ordine non è chiuso.
  if (!["completato", "annullato"].includes(o.stato)) timer = setTimeout(carica, o.stato === "in_attesa_pagamento" ? 4000 : 30000);
}

async function carica() {
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) {
    $("caricamento").hidden = true;
    $("errore").textContent = t("link_non_valido");
    $("errore").hidden = false;
    return;
  }
  try {
    const r = await fetch(`/api/ordini/${id}`, { headers: { "x-ordine-token": token, "x-lingua": document.documentElement.lang } });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    mostra(dati);
  } catch (e) {
    $("caricamento").hidden = true;
    $("errore").textContent = e.message || t("errore_generico");
    $("errore").hidden = false;
  }
}

quandoCambia(() => ordine && mostra(ordine));
selettoreLingua($("scelta-lingua"));
applicaTesti();
carica();
