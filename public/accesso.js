const $ = (id) => document.getElementById(id);
const parametri = new URLSearchParams(location.hash.slice(1));
const token = parametri.get("t");

async function invia(percorso, corpo) {
  const r = await fetch(percorso, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dati.errore || "Operazione non riuscita. Riprova.");
  return dati;
}

function fatto(titolo, testo, destinazione) {
  $("imposta").hidden = true;
  $("recupera").hidden = true;
  $("fatto").hidden = false;
  $("titolo-fatto").textContent = titolo;
  $("testo-fatto").textContent = testo;
  $("vai").hidden = !destinazione;
  if (destinazione) $("vai").href = destinazione;
}

if (token) {
  $("imposta").hidden = false;
  // Il token non resta nella cronologia del browser.
  history.replaceState(null, "", location.pathname);
} else {
  $("recupera").hidden = false;
}

$("form-imposta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = $("errore-imposta");
  errore.hidden = true;
  const d = new FormData(e.target);
  if (d.get("password") !== d.get("ripeti")) {
    errore.textContent = "Le due password non coincidono.";
    errore.hidden = false;
    return;
  }
  try {
    const esito = await invia("/api/accesso/imposta", { token, password: d.get("password") });
    fatto("Password salvata", `Ora puoi accedere con ${esito.email} e la password che hai scelto.`, esito.destinazione);
  } catch (err) {
    errore.textContent = err.message;
    errore.hidden = false;
  }
});

$("form-recupera").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = $("errore-recupera");
  errore.hidden = true;
  try {
    await invia("/api/accesso/recupera", { email: new FormData(e.target).get("email") });
    fatto("Controlla la posta", "Se l'email corrisponde a un account, tra poco ricevi il link per scegliere una nuova password. Guarda anche nello spam.", null);
  } catch (err) {
    errore.textContent = err.message;
    errore.hidden = false;
  }
});
