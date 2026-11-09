const $ = (id) => document.getElementById(id);
const parametri = new URLSearchParams(location.hash.slice(1));
const id = parametri.get("id") ?? "";
const token = parametri.get("t") ?? "";
const ETICHETTE = {
  in_attesa: "Prenotazione in attesa di conferma",
  confermata: "Prenotazione confermata",
  arrivata: "Buon appetito",
  no_show: "Prenotazione non onorata",
  annullata: "Prenotazione annullata",
};

function mostraErrore(testo) {
  $("caricamento").hidden = true;
  $("errore").textContent = testo;
  $("errore").hidden = false;
}

async function chiama(percorso, metodo = "GET") {
  const r = await fetch(percorso, { method: metodo, headers: { "x-prenotazione-token": token } });
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dati.errore || "Operazione non riuscita. Riprova.");
  return dati;
}

function mostra(p) {
  const quando = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${p.data}T12:00:00Z`),
  );
  $("caricamento").hidden = true;
  $("dettaglio").hidden = false;
  $("ristorante").textContent = p.ristorante.nome;
  $("titolo").textContent = ETICHETTE[p.stato];
  $("quando").textContent = `${quando} alle ${p.ora}`;
  $("quanti").textContent = String(p.persone);
  $("nome").textContent = p.nome;
  $("codice").textContent = p.codice;
  $("riga-sconto").hidden = !p.sconto;
  $("sconto").textContent = `${p.sconto}% sul conto alla carta`;
  $("riga-note").hidden = !p.note;
  $("note").textContent = p.note;
  $("contatti").textContent = `${p.ristorante.indirizzo}. Per modifiche chiama il ${p.ristorante.telefono}.`;
  $("area-annulla").hidden = !p.annullabile;
  $("conferma-annulla").hidden = true;
  $("annulla").hidden = false;
}

async function carica() {
  if (!/^[0-9a-f-]{36}$/.test(id) || !token) {
    mostraErrore("Link non valido. Usa il link che hai ricevuto dopo la prenotazione.");
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

carica();
