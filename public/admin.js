const $ = (id) => document.getElementById(id);
const ETICHETTE = { in_attesa: "Da confermare", confermata: "Confermata", annullata: "Annullata" };

function oggiRoma() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

function mostra(id, testo) {
  const el = $(id);
  el.textContent = testo;
  el.hidden = !testo;
}

async function chiama(percorso, opzioni = {}) {
  const r = await fetch(percorso, opzioni);
  const dati = await r.json().catch(() => ({}));
  if (r.status === 401 && percorso !== "/api/admin/login") {
    mostraAccesso();
    throw new Error("");
  }
  if (!r.ok) throw new Error(dati.errore || "Operazione non riuscita. Riprova.");
  return dati;
}

function mostraAccesso() {
  $("pannello").hidden = true;
  $("accesso").hidden = false;
  document.querySelector("#login input").focus();
}

function bottone(testo, azione) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = testo;
  b.addEventListener("click", azione);
  return b;
}

async function cambiaStato(id, stato) {
  mostra("errore-sala", "");
  try {
    await chiama(`/api/admin/prenotazioni/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stato }),
    });
    await carica();
  } catch (e) {
    mostra("errore-sala", e.message);
  }
}

function creaRiga(p) {
  const riga = document.createElement("article");
  riga.className = "riga";
  riga.dataset.stato = p.stato;

  const quanti = document.createElement("div");
  quanti.className = "quanti";
  quanti.textContent = String(p.persone);
  quanti.title = "Persone";

  const chi = document.createElement("div");
  chi.className = "chi";
  const nome = document.createElement("strong");
  nome.textContent = p.nome;
  const contatto = document.createElement("span");
  contatto.textContent = `${ETICHETTE[p.stato]}. ${p.contatto}`;
  chi.append(nome, contatto);
  if (p.note) {
    const note = document.createElement("span");
    note.textContent = p.note;
    chi.append(note);
  }

  const azioni = document.createElement("div");
  azioni.className = "azioni";
  if (p.stato !== "confermata") azioni.append(bottone("Conferma", () => cambiaStato(p.id, "confermata")));
  if (p.stato !== "annullata") azioni.append(bottone("Annulla", () => cambiaStato(p.id, "annullata")));

  riga.append(quanti, chi, azioni);
  return riga;
}

async function carica() {
  const { prenotazioni } = await chiama(`/api/admin/prenotazioni?data=${$("data").value}`);
  const elenco = $("elenco");
  elenco.replaceChildren();
  if (!prenotazioni.length) {
    const vuoto = document.createElement("p");
    vuoto.className = "vuoto";
    vuoto.textContent = "Nessuna prenotazione per questo giorno.";
    elenco.append(vuoto);
    return;
  }
  const ore = [...new Set(prenotazioni.map((p) => p.ora))];
  for (const ora of ore) {
    const gruppo = prenotazioni.filter((p) => p.ora === ora);
    const coperti = gruppo.filter((p) => p.stato !== "annullata").reduce((t, p) => t + p.persone, 0);
    const sezione = document.createElement("section");
    sezione.className = "turno";
    const titolo = document.createElement("h2");
    const totale = document.createElement("small");
    totale.textContent = `${coperti} coperti`;
    titolo.append(ora, totale);
    sezione.append(titolo, ...gruppo.map(creaRiga));
    elenco.append(sezione);
  }
}

async function apriPannello() {
  const sessione = await chiama("/api/admin/sessione");
  $("accesso").hidden = true;
  $("pannello").hidden = false;
  if (!$("data").value) $("data").value = oggiRoma();
  $("area-foto").hidden = !sessione.foto;
  mostra("ambiente", sessione.ambiente === "preview" ? "Stai lavorando sulla Preview: questi dati sono separati dalla produzione." : "");
  await carica();
}

$("login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  mostra("errore-login", "");
  try {
    await chiama("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: new FormData(evento.target).get("password") }),
    });
    evento.target.reset();
    await apriPannello();
  } catch (e) {
    mostra("errore-login", e.message);
  }
});

$("data").addEventListener("change", () => {
  carica().catch((e) => mostra("errore-sala", e.message));
});

$("esci").addEventListener("click", async () => {
  await chiama("/api/admin/logout", { method: "POST" }).catch(() => {});
  mostraAccesso();
});

$("file-foto").addEventListener("change", async (evento) => {
  const file = evento.target.files[0];
  if (!file) return;
  $("esito-foto").textContent = "Carico la foto.";
  try {
    await chiama("/api/admin/foto", { method: "PUT", body: file });
    $("esito-foto").textContent = "Foto aggiornata.";
  } catch (e) {
    $("esito-foto").textContent = e.message;
  }
  evento.target.value = "";
});

apriPannello().catch(() => {});
