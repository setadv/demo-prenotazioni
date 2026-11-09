import { $, api, avviso } from "./comune.js";
import { vistaAgenda } from "./agenda.js";
import { vistaSala } from "./sala.js";
import { vistaMappa } from "./mappa.js";
import { vistaClienti } from "./clienti.js";
import { vistaStatistiche } from "./statistiche.js";
import { vistaImpostazioni } from "./impostazioni.js";

const VISTE = {
  agenda: vistaAgenda,
  sala: vistaSala,
  mappa: vistaMappa,
  clienti: vistaClienti,
  statistiche: vistaStatistiche,
  impostazioni: vistaImpostazioni,
};
const TITOLI = {
  agenda: "Agenda",
  sala: "Sala",
  mappa: "Mappa tavoli",
  clienti: "Clienti",
  statistiche: "Statistiche",
  impostazioni: "Impostazioni",
};

let sessione = null;
let vistaCorrente = null;

function mostraAccesso() {
  $("pannello").hidden = true;
  $("accesso").hidden = false;
  $("dialogo").open && $("dialogo").close();
  document.querySelector("#login input").focus();
}

async function apriVista() {
  const nome = VISTE[location.hash.slice(1)] ? location.hash.slice(1) : "agenda";
  if (vistaCorrente && vistaCorrente.nome !== nome && vistaCorrente.esci && !vistaCorrente.esci(nome)) {
    history.replaceState(null, "", `#${vistaCorrente.nome}`);
    return;
  }
  document.querySelectorAll(".menu a").forEach((a) => {
    if (a.dataset.vista === nome) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = `${TITOLI[nome]}, ${sessione?.nome ?? "pannello"}`;
  const contenuto = $("contenuto");
  contenuto.replaceChildren();
  vistaCorrente = { nome, ...(await VISTE[nome](contenuto, sessione)) };
}

async function avvia() {
  sessione = await api("/api/admin/sessione");
  $("accesso").hidden = true;
  $("pannello").hidden = false;
  $("nome-locale").textContent = sessione.nome;
  $("ambiente").hidden = sessione.ambiente !== "preview";
  $("ambiente").textContent = "Anteprima: questi dati sono separati dalla produzione.";
  await apriVista();
}

window.addEventListener("hashchange", () => {
  if (sessione) apriVista().catch((e) => avviso(e.message, "errore"));
});

document.addEventListener("sessione-scaduta", () => {
  sessione = null;
  mostraAccesso();
});

$("login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const errore = $("errore-login");
  errore.hidden = true;
  try {
    await api("/api/admin/login", { metodo: "POST", corpo: { password: new FormData(evento.target).get("password") } });
    evento.target.reset();
    await avvia();
  } catch (e) {
    errore.textContent = e.message;
    errore.hidden = false;
  }
});

$("esci").addEventListener("click", async () => {
  await api("/api/admin/logout", { metodo: "POST" }).catch(() => {});
  sessione = null;
  vistaCorrente = null;
  mostraAccesso();
});

avvia().catch((e) => {
  if (e.status !== 401) avviso(e.message, "errore");
  mostraAccesso();
});
