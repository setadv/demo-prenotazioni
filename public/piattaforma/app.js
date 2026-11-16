import { $, api, apriDialogo, avviso, chiudiDialogo, h, testoData } from "../gestione/comune.js";
import { RUOLI, mostraInvito } from "../gestione/account.js";

const STATI = {
  attivo: "Attivo",
  prova: "In prova",
  prova_scaduta: "Prova scaduta",
  sospeso: "Sospeso",
  disattivato: "Disattivato",
};
const FILTRI = { "": "Tutti", attivo: "Attivi", prova: "In prova", prova_scaduta: "Prova scaduta", da_pagare: "Da pagare", sospeso: "Sospesi", disattivato: "Disattivati" };
const AZIONI = {
  ristorante_creato: "Ristorante creato",
  iscrizione: "Iscrizione dal sito",
  ristorante_modificato: "Dati modificati",
  ristorante_cancellato: "Ristorante cancellato",
  stato_attivo: "Attivato",
  stato_prova: "Prova avviata",
  stato_sospeso: "Sospeso",
  stato_disattivato: "Disattivato",
  integrazioni_modificate: "Integrazioni modificate",
  dati_esportati: "Dati esportati",
  accesso_assistenza: "Accesso come assistenza",
  utente_creato: "Persona invitata",
  utente_modificato: "Persona modificata",
  invito_inviato: "Nuovo link di accesso",
  account_attivato: "Account attivato",
  password_reimpostata: "Password reimpostata",
};
const INTEGRAZIONI = [
  ["Stripe (pagamenti online)", [
    ["STRIPE_SECRET_KEY", "Chiave segreta (sk_live_...)"],
    ["STRIPE_WEBHOOK_SECRET", "Segreto del webhook (whsec_...)"],
  ]],
  ["WhatsApp Business (Meta)", [
    ["WHATSAPP_TOKEN", "Token di accesso permanente"],
    ["WHATSAPP_PHONE_ID", "Phone number ID"],
    ["WHATSAPP_APP_SECRET", "App secret (firma del webhook)"],
    ["WHATSAPP_VERIFY_TOKEN", "Verify token (lo scegli tu)"],
    ["WHATSAPP_LINGUE", "Lingue dei modelli, es. it,en_GB"],
    ["WHATSAPP_MODELLO_CONFERMA", "Modello conferma"],
    ["WHATSAPP_MODELLO_RECENSIONE", "Modello recensione"],
    ["WHATSAPP_MODELLO_SONDAGGIO", "Modello sondaggio"],
    ["WHATSAPP_MODELLO_PREMIO", "Modello premio"],
    ["WHATSAPP_MODELLO_ORDINE", "Modello ordine"],
    ["WHATSAPP_MODELLO_GIFT", "Modello gift card"],
  ]],
];

const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format((c ?? 0) / 100);
const quando = (iso) => (iso ? new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(iso)) : "–");
const giorno = (iso) => (iso ? testoData(iso, { day: "numeric", month: "short", year: "numeric" }) : "–");
const chip = (stato) => h("span", { class: `chip-stato ${stato}` }, STATI[stato] ?? stato);
const slugDa = (nome) =>
  nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

let sessione = null;

function riga(etichetta, valore) {
  return h("div", {}, h("dt", {}, etichetta), h("dd", {}, valore));
}

function moduloErrori() {
  return h("p", { class: "messaggio", role: "alert", hidden: true });
}

async function conErrore(el, azione) {
  el.hidden = true;
  try {
    return await azione();
  } catch (e) {
    el.textContent = e.message;
    el.hidden = false;
    return null;
  }
}

// ---------- Cruscotto ----------

async function vistaCruscotto(c) {
  const d = await api("/api/piattaforma/riepilogo");
  const n = d.conteggi;
  c.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Cruscotto"), h("div", { class: "pulsanti-testata" }, h("a", { class: "azione compatta pulsante-link", href: "#nuovo" }, "Nuovo ristorante"))),
    h(
      "dl",
      { class: "cifre" },
      riga("Ristoranti", String(d.totale)),
      riga("Attivi", String(n.attivo ?? 0)),
      riga("In prova", String(n.prova ?? 0)),
      riga("Prova scaduta", String(n.prova_scaduta ?? 0)),
      riga("Sospesi", String(n.sospeso ?? 0)),
      riga("Ricavo mensile", euro(d.mrr)),
      riga("Ricavo annuo", euro(d.arr)),
      riga("Prenotazioni 30 giorni", String(d.attivita_30_giorni.prenotazioni)),
      riga("Coperti 30 giorni", String(d.attivita_30_giorni.coperti)),
    ),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Scadenze dei prossimi 7 giorni"),
      d.scadenze.length
        ? h(
            "ul",
            { class: "elenco-semplice" },
            d.scadenze.map((s) =>
              h(
                "li",
                {},
                h("a", { href: `#ristorante/${s.id}` }, s.nome),
                " · ",
                {
                  prova: `la prova finisce il ${giorno(s.data)}`,
                  prova_scaduta: `prova finita il ${giorno(s.data)}`,
                  pagamento: `pagato fino al ${giorno(s.data)}`,
                  pagamento_scaduto: `pagamento scaduto il ${giorno(s.data)}`,
                }[s.tipo],
              ),
            ),
          )
        : h("p", { class: "legenda" }, "Nessuna scadenza in arrivo."),
    ),
    h("section", { class: "blocco" }, h("h2", {}, "Ultime attività"), tabellaRegistro(d.registro, true)),
  );
}

function tabellaRegistro(righe, conRistorante) {
  if (!righe.length) return h("p", { class: "legenda" }, "Ancora nessuna attività.");
  return h(
    "div",
    { class: "tabella-scorre" },
    h(
      "table",
      { class: "tabella" },
      h("thead", {}, h("tr", {}, h("th", {}, "Quando"), conRistorante ? h("th", {}, "Ristorante") : null, h("th", {}, "Chi"), h("th", {}, "Cosa"))),
      h(
        "tbody",
        {},
        righe.map((r) =>
          h(
            "tr",
            {},
            h("td", {}, quando(r.creato_il)),
            conRistorante ? h("td", {}, r.ristorante_id && r.ristorante ? h("a", { href: `#ristorante/${r.ristorante_id}` }, r.ristorante) : "–") : null,
            h("td", {}, r.autore),
            h("td", {}, h("strong", {}, AZIONI[r.azione] ?? r.azione), r.dettaglio ? ` · ${r.dettaglio}` : ""),
          ),
        ),
      ),
    ),
  );
}

// ---------- Elenco ristoranti ----------

async function vistaRistoranti(c) {
  let filtro = sessionStorage.getItem("filtro-ristoranti") ?? "";
  const cerca = h("input", { type: "search", placeholder: "Cerca per nome, indirizzo, P.IVA, email", "aria-label": "Cerca" });
  const filtri = h("div", { class: "filtri", role: "group", "aria-label": "Stato" });
  const elenco = h("div", {});
  let timer;

  async function carica() {
    filtri.replaceChildren(
      ...Object.entries(FILTRI).map(([k, v]) =>
        h("button", { type: "button", class: "filtro", "aria-pressed": String(k === filtro), onclick: () => { filtro = k; sessionStorage.setItem("filtro-ristoranti", k); carica(); } }, v),
      ),
    );
    const { ristoranti } = await api(`/api/piattaforma/ristoranti?stato=${filtro}&q=${encodeURIComponent(cerca.value.trim())}`);
    if (!ristoranti.length) {
      elenco.replaceChildren(h("p", { class: "vuoto" }, "Nessun ristorante."));
      return;
    }
    elenco.replaceChildren(
      h(
        "div",
        { class: "tabella-scorre" },
        h(
          "table",
          { class: "tabella" },
          h(
            "thead",
            {},
            h("tr", {}, ["Ristorante", "Stato", "Piano", "€/mese", "Scadenza", "Prenotazioni 30 gg", "Ultimo accesso"].map((t) => h("th", {}, t))),
          ),
          h(
            "tbody",
            {},
            ristoranti.map((r) =>
              h(
                "tr",
                {},
                h("td", {}, h("a", { href: `#ristorante/${r.id}` }, h("strong", {}, r.nome)), h("br"), h("small", {}, r.slug)),
                h("td", {}, chip(r.stato_effettivo), r.pagamento_scaduto ? h("span", { class: "etichetta allerta" }, "Da pagare") : null),
                h("td", {}, sessione.piani[r.piano]?.nome ?? r.piano),
                h("td", {}, euro(r.prezzo_mensile)),
                h("td", {}, r.stato === "prova" ? `prova al ${giorno(r.prova_fino)}` : r.pagato_fino ? `pagato al ${giorno(r.pagato_fino)}` : "–"),
                h("td", {}, String(r.prenotazioni_30)),
                h("td", {}, quando(r.ultimo_accesso)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  cerca.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(carica, 250);
  });
  c.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Ristoranti"), h("div", { class: "pulsanti-testata" }, h("a", { class: "azione compatta pulsante-link", href: "#nuovo" }, "Nuovo ristorante"))),
    h("div", { class: "strumenti" }, cerca),
    filtri,
    elenco,
  );
  await carica();
}

// ---------- Nuovo ristorante ----------

function sceltaModuli(selezionati) {
  return h(
    "fieldset",
    { class: "moduli-piano" },
    h("legend", { class: "piccola" }, "Funzioni incluse (oltre a prenotazioni, menù, QR, CRM e recensioni)"),
    Object.entries(sessione.moduli).map(([k, v]) => h("label", { class: "spunta" }, h("input", { type: "checkbox", name: "moduli", value: k, checked: selezionati.includes(k) }), v)),
  );
}

async function vistaNuovo(c) {
  const errore = moduloErrori();
  let slugToccato = false;
  const slug = h("input", { name: "slug", required: true, pattern: "[a-z0-9][a-z0-9\\-]*[a-z0-9]", maxlength: 40 });
  const nome = h("input", { name: "nome", required: true, maxlength: 80 });
  const anteprima = h("span", { class: "aiuto" });
  const aggiornaAnteprima = () => {
    anteprima.textContent = sessione.dominio ? `https://${slug.value || "indirizzo"}.${sessione.dominio}` : `${location.origin}/?r=${slug.value || "indirizzo"}`;
  };
  nome.addEventListener("input", () => {
    if (!slugToccato) slug.value = slugDa(nome.value);
    aggiornaAnteprima();
  });
  slug.addEventListener("input", () => {
    slugToccato = true;
    aggiornaAnteprima();
  });
  aggiornaAnteprima();
  const prezzo = h("input", { name: "prezzo_mensile", inputmode: "decimal", value: String(sessione.piani.base.prezzo / 100) });
  let moduli = sceltaModuli(sessione.piani.base.moduli);
  const piano = h(
    "select",
    {
      name: "piano",
      onchange: () => {
        const p = sessione.piani[piano.value];
        prezzo.value = String(p.prezzo / 100);
        const nuovo = sceltaModuli(p.moduli);
        moduli.replaceWith(nuovo);
        moduli = nuovo;
      },
    },
    Object.entries(sessione.piani).map(([k, p]) => h("option", { value: k }, `${p.nome} · ${euro(p.prezzo)}/mese`)),
  );
  const form = h(
    "form",
    {
      class: "impostazioni",
      onsubmit: async (e) => {
        e.preventDefault();
        const d = new FormData(form);
        const corpo = Object.fromEntries([...d.entries()].filter(([k]) => k !== "moduli"));
        corpo.moduli = d.getAll("moduli");
        const esito = await conErrore(errore, () => api("/api/piattaforma/ristoranti", { metodo: "POST", corpo }));
        if (!esito) return;
        location.hash = `#ristorante/${esito.ristorante.id}`;
        if (esito.invito) mostraInvito(esito.invito, corpo.email_titolare);
        else avviso("Ristorante creato. Invita il titolare dalla scheda.");
      },
    },
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Ristorante"),
      h(
        "div",
        { class: "campi" },
        h("label", {}, "Nome del ristorante", nome),
        h("label", {}, "Indirizzo", slug, anteprima),
      ),
    ),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Abbonamento"),
      h(
        "div",
        { class: "campi" },
        h("label", {}, "Piano", piano),
        h("label", {}, "Prezzo mensile (€)", prezzo),
        h("label", {}, "Giorni di prova", h("input", { name: "giorni_prova", type: "number", min: 0, max: 90, value: 14 }), h("span", { class: "aiuto" }, "0 = attivo da subito")),
      ),
      moduli,
    ),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Titolare"),
      h("p", { class: "legenda" }, "Riceve l'invito per scegliere la password. Se l'email non è configurata, ti mostriamo il link da mandargli."),
      h(
        "div",
        { class: "campi" },
        h("label", {}, "Nome e cognome", h("input", { name: "nome_titolare", maxlength: 80 })),
        h("label", {}, "Email", h("input", { name: "email_titolare", type: "email" })),
        h("label", {}, "Telefono", h("input", { name: "telefono", type: "tel", maxlength: 30 })),
      ),
      h("label", {}, "Note interne", h("textarea", { name: "note", rows: 3, maxlength: 2000 })),
    ),
    errore,
    h("div", { class: "barra-salva" }, h("button", { type: "submit", class: "azione compatta" }, "Crea il ristorante")),
  );
  c.append(h("div", { class: "testata-vista" }, h("h1", {}, "Nuovo ristorante")), form);
  nome.focus();
}

// ---------- Scheda del ristorante ----------

async function vistaRistorante(c, id) {
  const d = await api(`/api/piattaforma/ristoranti/${id}`);
  const r = d.ristorante;
  const ricarica = () => {
    c.replaceChildren();
    return vistaRistorante(c, id);
  };
  const salva = async (corpo, errore) => {
    const ok = await conErrore(errore, () => api(`/api/piattaforma/ristoranti/${id}`, { metodo: "PATCH", corpo }));
    if (ok) {
      avviso("Salvato.");
      ricarica();
    }
  };
  const stato = async (corpo) => {
    try {
      await api(`/api/piattaforma/ristoranti/${id}/stato`, { metodo: "POST", corpo });
      avviso("Stato aggiornato.");
      ricarica();
    } catch (e) {
      avviso(e.message, "errore");
    }
  };

  // Stato
  const pulsantiStato = [];
  if (r.stato !== "attivo") pulsantiStato.push(h("button", { type: "button", class: "azione compatta", onclick: () => stato({ stato: "attivo" }) }, r.stato === "sospeso" ? "Riattiva" : "Attiva"));
  if (r.stato === "prova" || r.stato === "sospeso" || r.stato === "disattivato") {
    pulsantiStato.push(
      h("button", {
        type: "button",
        class: "secondario",
        onclick: () => {
          const giorni = h("input", { type: "number", min: 1, max: 90, value: 14 });
          apriDialogo(
            h("h2", {}, "Periodo di prova"),
            h("label", {}, "Giorni da oggi", giorni),
            h("div", { class: "pulsanti-dialogo" }, h("button", { type: "button", class: "azione compatta", onclick: () => { chiudiDialogo(); stato({ stato: "prova", giorni: Number(giorni.value) }); } }, "Conferma"), h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla")),
          );
        },
      }, r.stato === "prova" ? "Estendi la prova" : "Rimetti in prova"),
    );
  }
  if (r.stato === "attivo" || r.stato === "prova") {
    pulsantiStato.push(
      h("button", {
        type: "button",
        class: "secondario pericolo",
        onclick: () => {
          const motivo = h("input", { maxlength: 300, placeholder: "Es. pagamento di novembre non ricevuto" });
          const err = moduloErrori();
          apriDialogo(
            h("h2", {}, `Sospendi ${r.nome}`),
            h("p", {}, "I clienti non potranno prenotare né ordinare online. Il ristorante potrà entrare nel pannello solo per consultare. I dati restano tutti."),
            h("label", {}, "Motivo (lo vede il ristorante)", motivo),
            err,
            h("div", { class: "pulsanti-dialogo" }, h("button", { type: "button", class: "azione compatta pericolo", onclick: () => { if (!motivo.value.trim()) { err.textContent = "Scrivi il motivo."; err.hidden = false; return; } chiudiDialogo(); stato({ stato: "sospeso", motivo: motivo.value }); } }, "Sospendi"), h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla")),
          );
        },
      }, "Sospendi"),
    );
  }
  if (r.stato !== "disattivato") {
    pulsantiStato.push(
      h("button", {
        type: "button",
        class: "secondario pericolo",
        onclick: () =>
          apriDialogo(
            h("h2", {}, `Disattiva ${r.nome}`),
            h("p", {}, "Le pagine pubbliche smettono di funzionare e nessuno del ristorante può più accedere. I dati restano: puoi riattivarlo o esportarli."),
            h("div", { class: "pulsanti-dialogo" }, h("button", { type: "button", class: "azione compatta pericolo", onclick: () => { chiudiDialogo(); stato({ stato: "disattivato" }); } }, "Disattiva"), h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla")),
          ),
      }, "Disattiva"),
    );
  } else if (r.id !== "demo") {
    pulsantiStato.push(
      h("button", {
        type: "button",
        class: "secondario pericolo",
        onclick: () => {
          const conferma = h("input", { autocomplete: "off" });
          const err = moduloErrori();
          apriDialogo(
            h("h2", {}, "Cancella definitivamente"),
            h("p", {}, "Cancella il ristorante con prenotazioni, clienti, menù, ordini, buoni e account. Non si può annullare: esporta prima i dati se servono."),
            h("label", {}, `Scrivi ${r.slug} per confermare`, conferma),
            err,
            h(
              "div",
              { class: "pulsanti-dialogo" },
              h("button", {
                type: "button",
                class: "azione compatta pericolo",
                onclick: async () => {
                  const ok = await conErrore(err, () => api(`/api/piattaforma/ristoranti/${id}`, { metodo: "DELETE", corpo: { conferma: conferma.value } }));
                  if (ok) {
                    chiudiDialogo();
                    avviso("Ristorante cancellato.");
                    location.hash = "#ristoranti";
                  }
                },
              }, "Cancella per sempre"),
              h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla"),
            ),
          );
        },
      }, "Cancella"),
    );
  }

  // Abbonamento
  const errAbb = moduloErrori();
  const pagato = h("input", { type: "date", name: "pagato_fino", value: r.pagato_fino ?? "" });
  const formAbb = h(
    "form",
    {
      onsubmit: (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        salva(
          {
            piano: f.get("piano"),
            moduli: f.getAll("moduli"),
            prezzo_mensile: f.get("prezzo_mensile"),
            prova_fino: f.get("prova_fino"),
            pagato_fino: f.get("pagato_fino"),
          },
          errAbb,
        );
      },
    },
    h(
      "div",
      { class: "campi" },
      h("label", {}, "Piano", h("select", { name: "piano" }, Object.entries(d.piani).map(([k, p]) => h("option", { value: k, selected: k === r.piano }, `${p.nome} · listino ${euro(p.prezzo)}`)))),
      h("label", {}, "Prezzo mensile (€)", h("input", { name: "prezzo_mensile", inputmode: "decimal", value: String(r.prezzo_mensile / 100) })),
      h("label", {}, "Fine prova", h("input", { type: "date", name: "prova_fino", value: r.prova_fino ?? "" })),
      h(
        "label",
        {},
        "Pagato fino al",
        pagato,
        h("button", {
          type: "button",
          class: "collegamento",
          onclick: () => {
            const oggi = new Date().toISOString().slice(0, 10);
            const base = pagato.value && pagato.value > oggi ? pagato.value : oggi;
            const dt = new Date(`${base}T12:00:00Z`);
            dt.setUTCMonth(dt.getUTCMonth() + 1);
            pagato.value = dt.toISOString().slice(0, 10);
          },
        }, "+1 mese"),
      ),
    ),
    sceltaModuli(r.moduli),
    h("p", { class: "aiuto" }, "Cambiare piano non cambia da solo le funzioni: scegli qui quelle incluse."),
    errAbb,
    h("button", { type: "submit", class: "azione compatta" }, "Salva abbonamento"),
  );

  // Dati
  const errDati = moduloErrori();
  const campo = (nome, etichetta, attr = {}) => h("label", {}, etichetta, h("input", { name: nome, value: r[nome] ?? "", ...attr }));
  const formDati = h(
    "form",
    {
      onsubmit: (e) => {
        e.preventDefault();
        salva(Object.fromEntries(new FormData(e.target)), errDati);
      },
    },
    h(
      "div",
      { class: "campi" },
      campo("nome", "Nome", { required: true, maxlength: 80 }),
      h("label", {}, "Indirizzo (sottodominio)", h("input", { name: "slug", value: r.slug, required: true, maxlength: 40 }), h("span", { class: "aiuto" }, "Cambiarlo rompe i QR già stampati.")),
      campo("ragione_sociale", "Ragione sociale"),
      campo("partita_iva", "Partita IVA", { maxlength: 20 }),
      campo("codice_destinatario", "Codice destinatario SDI", { maxlength: 7 }),
      campo("pec", "PEC", { type: "email" }),
      campo("indirizzo_fatturazione", "Indirizzo di fatturazione"),
      campo("contatto_nome", "Referente"),
      campo("contatto_email", "Email referente", { type: "email" }),
      campo("contatto_telefono", "Telefono referente", { type: "tel" }),
    ),
    h("label", {}, "Note interne", h("textarea", { name: "note", rows: 3, maxlength: 2000 }, r.note)),
    errDati,
    h("button", { type: "submit", class: "azione compatta" }, "Salva i dati"),
  );

  // Persone
  const errUt = moduloErrori();
  const persone = h(
    "div",
    {},
    d.utenti.length
      ? h(
          "div",
          { class: "tabella-scorre" },
          h(
            "table",
            { class: "tabella" },
            h("thead", {}, h("tr", {}, ["Persona", "Ruolo", "Ultimo accesso", "Stato", ""].map((t) => h("th", {}, t)))),
            h(
              "tbody",
              {},
              d.utenti.map((u) => {
                const cambia = async (corpo) => {
                  try {
                    await api(`/api/piattaforma/ristoranti/${id}/utenti/${u.id}`, { metodo: "PATCH", corpo });
                    avviso("Fatto.");
                  } catch (e) {
                    avviso(e.message, "errore");
                  }
                  ricarica();
                };
                return h(
                  "tr",
                  { class: u.attivo ? "" : "spento" },
                  h("td", {}, h("strong", {}, u.nome || u.email), u.nome ? [h("br"), h("small", {}, u.email)] : null),
                  h("td", {}, h("select", { "aria-label": `Ruolo di ${u.email}`, onchange: (e) => cambia({ ruolo: e.target.value }) }, Object.entries(RUOLI).map(([k, v]) => h("option", { value: k, selected: k === u.ruolo }, v.nome)))),
                  h("td", {}, u.attivato ? quando(u.ultimo_accesso) : "Invito in attesa"),
                  h("td", {}, u.attivo ? "Attivo" : "Disattivato"),
                  h(
                    "td",
                    { class: "azioni-riga" },
                    u.attivo
                      ? h("button", {
                          type: "button",
                          class: "secondario",
                          onclick: async () => {
                            try {
                              mostraInvito(await api(`/api/piattaforma/ristoranti/${id}/utenti/${u.id}/invito`, { metodo: "POST" }), u.email);
                            } catch (e) {
                              avviso(e.message, "errore");
                            }
                          },
                        }, u.attivato ? "Link nuova password" : "Nuovo invito")
                      : null,
                    h("button", { type: "button", class: `secondario${u.attivo ? " pericolo" : ""}`, onclick: () => cambia({ attivo: !u.attivo }) }, u.attivo ? "Disattiva" : "Riattiva"),
                  ),
                );
              }),
            ),
          ),
        )
      : h("p", { class: "legenda" }, "Nessuno ha ancora un account. Invita il titolare."),
    h(
      "form",
      {
        class: "riga-modifica invito",
        onsubmit: async (e) => {
          e.preventDefault();
          const corpo = Object.fromEntries(new FormData(e.target));
          const esito = await conErrore(errUt, () => api(`/api/piattaforma/ristoranti/${id}/utenti`, { metodo: "POST", corpo }));
          if (esito) {
            mostraInvito(esito, corpo.email);
            if (esito.inviata) ricarica();
            else document.getElementById("dialogo").addEventListener("close", ricarica, { once: true });
          }
        },
      },
      h("label", { class: "cresce" }, "Email", h("input", { type: "email", name: "email", required: true })),
      h("label", {}, "Nome", h("input", { name: "nome", maxlength: 80 })),
      h("label", {}, "Ruolo", h("select", { name: "ruolo" }, Object.entries(RUOLI).map(([k, v]) => h("option", { value: k, selected: k === (d.utenti.length ? "staff" : "titolare") }, v.nome)))),
      h("button", { type: "submit", class: "azione compatta" }, "Invita"),
    ),
    errUt,
  );

  // Integrazioni
  const errInt = moduloErrori();
  const formInt = h(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        const valori = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => String(v).trim() !== ""));
        if (!Object.keys(valori).length) {
          errInt.textContent = "Scrivi almeno un valore da salvare.";
          errInt.hidden = false;
          return;
        }
        const ok = await conErrore(errInt, () => api(`/api/piattaforma/ristoranti/${id}/integrazioni`, { metodo: "PUT", corpo: { integrazioni: valori } }));
        if (ok) {
          avviso("Integrazioni salvate.");
          ricarica();
        }
      },
    },
    h("p", { class: "legenda" }, "Le chiavi si salvano cifrate e non si rileggono: lascia vuoto un campo per non cambiarlo. Se il ristorante non le ha, i pagamenti online e WhatsApp automatico restano spenti."),
    INTEGRAZIONI.map(([titolo, chiavi]) =>
      h(
        "fieldset",
        { class: "gruppo-integrazioni" },
        h("legend", { class: "piccola" }, titolo),
        h(
          "div",
          { class: "campi" },
          chiavi.map(([k, etichetta]) =>
            h(
              "label",
              {},
              etichetta,
              h("input", { name: k, autocomplete: "off", placeholder: d.integrazioni[k] ?? "non impostata" }),
              d.integrazioni[k]
                ? h("button", {
                    type: "button",
                    class: "collegamento pericolo",
                    onclick: async () => {
                      await api(`/api/piattaforma/ristoranti/${id}/integrazioni`, { metodo: "PUT", corpo: { integrazioni: { [k]: null } } }).catch((e) => avviso(e.message, "errore"));
                      ricarica();
                    },
                  }, "Rimuovi")
                : null,
            ),
          ),
        ),
      ),
    ),
    h("p", { class: "aiuto" }, "Webhook Stripe (evento checkout.session.completed ed expired): ", h("code", {}, d.webhook.stripe)),
    h("p", { class: "aiuto" }, "Webhook WhatsApp (callback URL su Meta): ", h("code", {}, d.webhook.whatsapp)),
    errInt,
    h("button", { type: "submit", class: "azione compatta" }, "Salva integrazioni"),
  );

  const u = d.uso;
  c.append(
    h(
      "div",
      { class: "testata-vista" },
      h("div", {}, h("p", { class: "legenda" }, h("a", { href: "#ristoranti" }, "‹ Ristoranti")), h("h1", {}, r.nome, " ", chip(r.stato_effettivo))),
      h(
        "div",
        { class: "pulsanti-testata" },
        h("a", { class: "secondario pulsante-link", href: d.indirizzo, target: "_blank", rel: "noopener" }, "Pagina pubblica"),
        h("a", { class: "secondario pulsante-link", href: `/api/piattaforma/ristoranti/${id}/esporta`, download: "" }, "Esporta i dati"),
        h("button", {
          type: "button",
          class: "azione compatta",
          onclick: async () => {
            try {
              const esito = await api(`/api/piattaforma/ristoranti/${id}/assistenza`, { metodo: "POST" });
              window.open(esito.url, "_blank", "noopener");
            } catch (e) {
              avviso(e.message, "errore");
            }
          },
        }, "Entra come assistenza"),
      ),
    ),
    h("p", { class: "banda", dataset: { tipo: "allerta" }, hidden: !(r.stato === "sospeso" && r.motivo_sospensione) }, `Sospeso: ${r.motivo_sospensione}`),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Stato"),
      h(
        "dl",
        { class: "scheda-dati" },
        riga("Stato", STATI[r.stato_effettivo]),
        riga("Indirizzo", h("a", { href: d.indirizzo, target: "_blank", rel: "noopener" }, d.indirizzo)),
        riga("Cliente dal", giorno(r.creato_il.slice(0, 10))),
        r.stato === "prova" ? riga("Fine prova", giorno(r.prova_fino)) : null,
        riga("Pagato fino al", r.pagato_fino ? giorno(r.pagato_fino) : "–"),
      ),
      h("div", { class: "pulsanti-testata" }, pulsantiStato),
    ),
    h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Uso negli ultimi 30 giorni"),
      h(
        "dl",
        { class: "cifre" },
        riga("Prenotazioni", String(u.prenotazioni.totale)),
        riga("Coperti", String(u.prenotazioni.coperti)),
        riga("Online", String(u.prenotazioni.online)),
        riga("No-show", String(u.prenotazioni.no_show)),
        riga("Ordini", String(u.ordini.totale)),
        riga("Incasso ordini", euro(u.ordini.incasso)),
        riga("Clienti in CRM", String(u.clienti)),
        riga("Messaggi", Object.entries(u.messaggi).map(([k, v]) => `${k} ${v}`).join(" · ") || "0"),
      ),
    ),
    h("section", { class: "blocco" }, h("h2", {}, "Abbonamento e funzioni"), formAbb),
    h("section", { class: "blocco" }, h("h2", {}, "Persone"), persone),
    h("section", { class: "blocco" }, h("h2", {}, "Dati di fatturazione e referente"), formDati),
    h("section", { class: "blocco" }, h("h2", {}, "Integrazioni"), formInt),
    h("section", { class: "blocco" }, h("h2", {}, "Registro"), tabellaRegistro(d.registro, false)),
  );
}

// ---------- Registro e amministratori ----------

async function vistaRegistro(c) {
  const { registro } = await api("/api/piattaforma/registro");
  c.append(h("div", { class: "testata-vista" }, h("h1", {}, "Registro")), h("section", { class: "blocco" }, tabellaRegistro(registro, true)));
}

async function vistaAmministratori(c) {
  const { utenti } = await api("/api/piattaforma/amministratori");
  const errore = moduloErrori();
  const ricarica = () => {
    c.replaceChildren();
    vistaAmministratori(c);
  };
  c.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Amministratori")),
    h(
      "section",
      { class: "blocco" },
      h("p", { class: "legenda" }, "Chi gestisce la piattaforma: crea ristoranti, li attiva o sospende ed entra come assistenza."),
      utenti.length
        ? h(
            "div",
            { class: "tabella-scorre" },
            h(
              "table",
              { class: "tabella" },
              h("thead", {}, h("tr", {}, ["Persona", "Ultimo accesso", "Stato", ""].map((t) => h("th", {}, t)))),
              h(
                "tbody",
                {},
                utenti.map((u) =>
                  h(
                    "tr",
                    { class: u.attivo ? "" : "spento" },
                    h("td", {}, h("strong", {}, u.nome || u.email), u.nome ? [h("br"), h("small", {}, u.email)] : null),
                    h("td", {}, u.attivato ? quando(u.ultimo_accesso) : "Invito in attesa"),
                    h("td", {}, u.attivo ? "Attivo" : "Disattivato"),
                    h(
                      "td",
                      { class: "azioni-riga" },
                      u.attivo
                        ? h("button", {
                            type: "button",
                            class: "secondario",
                            onclick: async () => mostraInvito(await api(`/api/piattaforma/amministratori/${u.id}/invito`, { metodo: "POST" }), u.email),
                          }, u.attivato ? "Link nuova password" : "Nuovo invito")
                        : null,
                      u.id === sessione.utente.id
                        ? h("span", { class: "legenda" }, "Sei tu")
                        : h("button", {
                            type: "button",
                            class: `secondario${u.attivo ? " pericolo" : ""}`,
                            onclick: async () => {
                              await api(`/api/piattaforma/amministratori/${u.id}`, { metodo: "PATCH", corpo: { attivo: !u.attivo } }).catch((e) => avviso(e.message, "errore"));
                              ricarica();
                            },
                          }, u.attivo ? "Disattiva" : "Riattiva"),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "legenda" }, "Stai usando l'accesso principale (SUPERADMIN_EMAIL). Aggiungi te stesso con un account personale."),
      h(
        "form",
        {
          class: "riga-modifica invito",
          onsubmit: async (e) => {
            e.preventDefault();
            const corpo = Object.fromEntries(new FormData(e.target));
            const esito = await conErrore(errore, () => api("/api/piattaforma/amministratori", { metodo: "POST", corpo }));
            if (esito) {
              mostraInvito(esito, corpo.email);
              ricarica();
            }
          },
        },
        h("label", { class: "cresce" }, "Email", h("input", { type: "email", name: "email", required: true })),
        h("label", {}, "Nome", h("input", { name: "nome", maxlength: 80 })),
        h("button", { type: "submit", class: "azione compatta" }, "Invita"),
      ),
      errore,
    ),
  );
}

// ---------- Navigazione ----------

const VISTE = {
  cruscotto: [vistaCruscotto, "Cruscotto"],
  ristoranti: [vistaRistoranti, "Ristoranti"],
  nuovo: [vistaNuovo, "Nuovo ristorante"],
  ristorante: [vistaRistorante, "Ristorante"],
  registro: [vistaRegistro, "Registro"],
  amministratori: [vistaAmministratori, "Amministratori"],
};

async function apriVista() {
  const [nome, parametro] = location.hash.slice(1).split("/");
  const chiave = VISTE[nome] ? nome : "cruscotto";
  const menu = chiave === "nuovo" || chiave === "ristorante" ? "ristoranti" : chiave;
  document.querySelectorAll(".menu a").forEach((a) => {
    if (a.dataset.vista === menu) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = `${VISTE[chiave][1]}, piattaforma`;
  const c = $("contenuto");
  c.replaceChildren();
  try {
    await VISTE[chiave][0](c, parametro);
  } catch (e) {
    if (e.status !== 401) c.append(h("p", { class: "messaggio" }, e.message));
  }
}

function mostraAccesso() {
  $("pannello").hidden = true;
  $("accesso").hidden = false;
  if ($("dialogo").open) $("dialogo").close();
  document.querySelector("#login input").focus();
}

async function avvia() {
  sessione = await api("/api/piattaforma/sessione");
  $("accesso").hidden = true;
  $("pannello").hidden = false;
  $("chi").textContent = sessione.utente.nome;
  $("ambiente").hidden = sessione.ambiente !== "preview";
  $("ambiente").textContent = "Anteprima: questi dati sono separati dalla produzione.";
  await apriVista();
}

window.addEventListener("hashchange", () => {
  if (sessione) apriVista();
});
document.addEventListener("sessione-scaduta", () => {
  sessione = null;
  mostraAccesso();
});
$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = $("errore-login");
  errore.hidden = true;
  try {
    await api("/api/piattaforma/login", { metodo: "POST", corpo: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    await avvia();
  } catch (err) {
    errore.textContent = err.message;
    errore.hidden = false;
  }
});
$("esci").addEventListener("click", async () => {
  await api("/api/piattaforma/logout", { metodo: "POST" }).catch(() => {});
  sessione = null;
  mostraAccesso();
});

avvia().catch((e) => {
  if (e.status !== 401) avviso(e.message, "errore");
  mostraAccesso();
});
