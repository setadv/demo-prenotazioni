import { applicaTesti, quandoCambia, selettoreLingua, t, testoData } from "./lingue.js";

const $ = (id) => document.getElementById(id);
const parametri = new URLSearchParams(location.hash.slice(1));
const id = parametri.get("id") ?? "";
const token = parametri.get("t") ?? "";
let ultima = null;
let erroreChiave = null;

function mostraErrore(testo, chiave = null) {
  erroreChiave = chiave;
  $("caricamento").hidden = true;
  $("errore").textContent = chiave ? t(chiave) : testo;
  $("errore").hidden = false;
}

async function chiama(percorso, metodo = "GET") {
  const r = await fetch(percorso, { method: metodo, headers: { "x-prenotazione-token": token, "x-lingua": document.documentElement.lang } });
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dati.errore || t("errore_generico"));
  return dati;
}

function mostra(p) {
  ultima = p;
  document.title = t("tua_prenotazione");
  $("caricamento").hidden = true;
  $("dettaglio").hidden = false;
  $("ristorante").textContent = p.ristorante.nome;
  $("titolo").textContent = t(p.stato === "confermata" ? "stato_confermata_titolo" : `stato_${p.stato}`);
  $("quando").textContent = t("alle", { data: testoData(p.data), ora: p.ora });
  $("quanti").textContent = String(p.persone);
  $("nome").textContent = p.nome;
  $("codice").textContent = p.codice;
  $("riga-sconto").hidden = !p.sconto;
  $("sconto").textContent = t("sconto_valore", { n: p.sconto });
  $("riga-note").hidden = !p.note;
  $("note").textContent = p.note;
  $("contatti").textContent = t("contatti", { indirizzo: p.ristorante.indirizzo, telefono: p.ristorante.telefono });
  $("area-annulla").hidden = !p.annullabile;
  $("conferma-annulla").hidden = true;
  $("annulla").hidden = false;
}

async function carica() {
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) {
    mostraErrore("", "link_non_valido");
    return;
  }
  try {
    mostra(await chiama(`/api/prenotazioni/${id}`));
  } catch (e) {
    mostraErrore(e.message);
  }
}

$("annulla").addEventListener("click", () => {
  $("annulla").hidden = true;
  $("conferma-annulla").hidden = false;
  $("annulla-no").focus();
});
$("annulla-no").addEventListener("click", () => {
  $("conferma-annulla").hidden = true;
  $("annulla").hidden = false;
  $("annulla").focus();
});
$("annulla-si").addEventListener("click", async () => {
  $("annulla-si").disabled = true;
  try {
    await chiama(`/api/prenotazioni/${id}/annulla`, "POST");
    await carica();
  } catch (e) {
    mostraErrore(e.message);
  } finally {
    $("annulla-si").disabled = false;
  }
});

quandoCambia(() => {
  if (ultima) mostra(ultima);
  if (erroreChiave) mostraErrore("", erroreChiave);
});

selettoreLingua($("scelta-lingua"));
applicaTesti();
carica();
