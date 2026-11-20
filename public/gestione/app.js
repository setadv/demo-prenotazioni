import { $, api, avviso, corrente } from "./comune.js";
import { vistaAccount } from "./account.js";
import { vistaAgenda } from "./agenda.js";
import { vistaSala } from "./sala.js";
import { vistaMappa } from "./mappa.js";
import { vistaClienti } from "./clienti.js";
import { vistaStatistiche } from "./statistiche.js";
import { vistaImpostazioni } from "./impostazioni.js";
import { vistaMenu } from "./menu.js";
import { vistaOrdini } from "./ordini.js";
import { vistaFidelity } from "./fidelity.js";
import { vistaSondaggi } from "./sondaggi.js";
import { avviaNovita, fermaNovita, titoloConNovita } from "./novita.js";

const VISTE = {
  agenda: vistaAgenda,
  sala: vistaSala,
  mappa: vistaMappa,
  ordini: vistaOrdini,
  clienti: vistaClienti,
  fidelity: vistaFidelity,
  menu: vistaMenu,
  sondaggi: vistaSondaggi,
  statistiche: vistaStatistiche,
  impostazioni: vistaImpostazioni,
  account: vistaAccount,
};
const TITOLI = {
  agenda: "Agenda",
  sala: "Sala",
  mappa: "Mappa tavoli",
  ordini: "Ordini",
  clienti: "Clienti",
  fidelity: "Fidelity e gift card",
  menu: "Menù",
  sondaggi: "Sondaggi",
  statistiche: "Statistiche",
  impostazioni: "Impostazioni",
  account: "Account",
};

/** Viste visibili: dipendono dal ruolo e dalle funzioni incluse nel piano del ristorante. */
function visibile(nome) {
  const s = sessione;
  if (!s) return false;
  const moduli = new Set(s.ristorante?.moduli ?? []);
  const ruolo = s.utente?.ruolo ?? "titolare";
  if (nome === "ordini") return moduli.has("ordini");
  if (nome === "fidelity") return moduli.has("fidelity") || moduli.has("gift");
  if (nome === "sondaggi") return moduli.has("sondaggi");
  if (nome === "mappa" || nome === "impostazioni") return ruolo === "titolare";
  return true;
}

const STATI_ACCOUNT = {
  prova_scaduta: "Il periodo di prova è finito: i clienti non possono più prenotare online. Puoi consultare i dati; per continuare contatta l'assistenza.",
  sospeso: "L'account è sospeso: i clienti non possono prenotare online e il pannello è in sola consultazione.",
  disattivato: "L'account è disattivato.",
};

function banda() {
  const el = $("stato-account");
  const r = sessione.ristorante ?? {};
  let testo = "";
  let tipo = "info";
  if (sessione.assistenza) {
    testo = `Sei nel pannello di ${sessione.nome} come assistenza. Ogni accesso è registrato.`;
    tipo = "assistenza";
  } else if (STATI_ACCOUNT[r.stato]) {
    testo = `${STATI_ACCOUNT[r.stato]}${r.motivo ? ` Motivo: ${r.motivo}` : ""}`;
    tipo = "allerta";
  } else if (r.stato === "prova" && r.prova_fino) {
    const giorni = Math.round((Date.parse(`${r.prova_fino}T12:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`)) / 86400000);
    testo = giorni > 0 ? `Periodo di prova: ${giorni === 1 ? "manca 1 giorno" : `mancano ${giorni} giorni`}.` : "Il periodo di prova finisce oggi.";
  } else if (sessione.utente?.ruolo === "lettura") {
    testo = "Accesso in sola lettura: puoi consultare ma non modificare.";
  }
  el.textContent = testo;
  el.dataset.tipo = tipo;
  el.hidden = !testo;
}

let sessione = null;
let vistaCorrente = null;

function mostraAccesso() {
  $("pannello").hidden = true;
  $("accesso").hidden = false;
  $("dialogo").open && $("dialogo").close();
  document.querySelector("#login input").focus();
}

async function apriVista() {
  const richiesta = location.hash.slice(1);
  const nome = VISTE[richiesta] && visibile(richiesta) ? richiesta : "agenda";
  if (vistaCorrente && vistaCorrente.nome !== nome && vistaCorrente.esci && !vistaCorrente.esci(nome)) {
    history.replaceState(null, "", `#${vistaCorrente.nome}`);
    return;
  }
  document.querySelectorAll(".menu a").forEach((a) => {
    if (a.dataset.vista === nome) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = titoloConNovita(`${TITOLI[nome]}, ${sessione?.nome ?? "pannello"}`);
  const contenuto = $("contenuto");
  contenuto.replaceChildren();
  vistaCorrente = { nome, ...(await VISTE[nome](contenuto, sessione)) };
}

async function avvia() {
  sessione = await api("/api/admin/sessione");
  corrente.sessione = sessione;
  document.querySelectorAll(".menu a").forEach((a) => {
    a.hidden = !visibile(a.dataset.vista);
  });
  banda();
  document.body.classList.toggle("sola-lettura", sessione.utente?.ruolo === "lettura");
  $("accesso").hidden = true;
  $("pannello").hidden = false;
  $("nome-locale").textContent = sessione.nome;
  $("ambiente").hidden = sessione.ambiente !== "preview";
  $("ambiente").textContent = "Anteprima: questi dati sono separati dalla produzione.";
  await apriVista();
  avviaNovita(sessione, (vista) => {
    if (location.hash === `#${vista}`) apriVista().catch((e) => avviso(e.message, "errore"));
    else location.hash = vista;
  });
}

window.addEventListener("hashchange", () => {
  if (sessione) apriVista().catch((e) => avviso(e.message, "errore"));
});

document.addEventListener("sessione-scaduta", () => {
  fermaNovita();
  sessione = null;
  mostraAccesso();
});

$("login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const errore = $("errore-login");
  errore.hidden = true;
  try {
    const dati = new FormData(evento.target);
    await api("/api/admin/login", { metodo: "POST", corpo: { email: dati.get("email") || undefined, password: dati.get("password") } });
    evento.target.reset();
    await avvia();
  } catch (e) {
    errore.textContent = e.message;
    errore.hidden = false;
  }
});

$("esci").addEventListener("click", async () => {
  fermaNovita();
  await api("/api/admin/logout", { metodo: "POST" }).catch(() => {});
  sessione = null;
  corrente.sessione = null;
  vistaCorrente = null;
  mostraAccesso();
});

avvia().catch((e) => {
  if (e.status !== 401) avviso(e.message, "errore");
  mostraAccesso();
});
