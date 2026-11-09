import {
  ATTIVI,
  OCCASIONI,
  ORIGINI,
  STATI,
  aMinuti,
  api,
  apriDialogo,
  avviso,
  chiudiDialogo,
  condiviso,
  daMinuti,
  etichettaTavolo,
  h,
  oraRoma,
  oggiRoma,
  numeroWhatsApp,
  persone,
  spostaData,
  testoData,
} from "./comune.js";

const FILTRI = { tutto: "Tutto il giorno", pranzo: "Pranzo", cena: "Cena" };

export async function cambiaStato(id, stato) {
  await api(`/api/admin/prenotazioni/${id}`, { metodo: "PATCH", corpo: { stato } });
}

export async function cambiaTavolo(id, tavolo_id) {
  await api(`/api/admin/prenotazioni/${id}`, { metodo: "PATCH", corpo: { tavolo_id } });
}

/** Azioni disponibili per ciascuno stato, con l'etichetta del pulsante e lo stato di arrivo. */
export function azioniPer(stato) {
  switch (stato) {
    case "in_attesa":
      return [["Conferma", "confermata"], ["Arrivati", "arrivata"], ["Annulla", "annullata"]];
    case "confermata":
      return [["Arrivati", "arrivata"], ["Non presentati", "no_show"], ["Annulla", "annullata"]];
    case "arrivata":
      return [["Annulla arrivo", "confermata"]];
    default:
      return [["Ripristina", "confermata"]];
  }
}

export function selettoreTavolo(p, tavoli, sale, onCambia) {
  const select = h(
    "select",
    { "aria-label": `Tavolo per ${p.nome}`, class: "scegli-tavolo" },
    h("option", { value: "", selected: !p.tavolo_id }, "Senza tavolo"),
    sale.map((s) =>
      h(
        "optgroup",
        { label: s.nome },
        tavoli
          .filter((t) => t.sala_id === s.id)
          .map((t) =>
            h(
              "option",
              { value: t.id, selected: t.id === p.tavolo_id },
              `${etichettaTavolo(t)}${p.persone > t.posti_max ? ", troppo piccolo" : ""}`,
            ),
          ),
      ),
    ),
  );
  select.addEventListener("change", () => onCambia(select.value || null, select));
  return select;
}

const NOMI_CANALE = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };

function bloccoMessaggio(p, ricarica) {
  if (!p.messaggio && !p.notifica) return null;
  const n = p.notifica;
  let stato = null;
  if (n?.esito === "inviata") stato = h("span", { class: "invio ok" }, `Conferma inviata via ${NOMI_CANALE[n.canale]}`);
  else if (n?.esito === "manuale") stato = h("span", { class: "invio ok" }, `Conferma inviata a mano via ${NOMI_CANALE[n.canale]}`);
  else if (n?.esito === "errore") stato = h("span", { class: "invio errore" }, `Invio non riuscito: ${n.dettaglio}`);
  else if (p.messaggio) stato = h("span", { class: "invio attesa" }, `Conferma da inviare, preferisce ${NOMI_CANALE[p.canale] ?? "email"}`);
  if (!p.messaggio) return h("p", { class: "messaggi" }, stato);

  const segna = (canale) => async () => {
    try {
      await api(`/api/admin/prenotazioni/${p.id}/notifica`, { metodo: "POST", corpo: { canale } });
      setTimeout(ricarica, 300);
    } catch (e) {
      avviso(e.message, "errore");
    }
  };
  const testo = encodeURIComponent(p.messaggio);
  const numero = numeroWhatsApp(p.telefono);
  const link = [];
  if (numero) {
    link.push(
      h("a", { class: `invia-link${p.canale === "whatsapp" ? " preferito" : ""}`, href: `https://wa.me/${numero}?text=${testo}`, target: "_blank", rel: "noopener", onclick: segna("whatsapp") }, "WhatsApp"),
      h("a", { class: `invia-link${p.canale === "sms" ? " preferito" : ""}`, href: `sms:+${numero}?body=${testo}`, onclick: segna("sms") }, "SMS"),
    );
  }
  if (p.email) {
    link.push(
      h("a", {
        class: `invia-link${p.canale === "email" ? " preferito" : ""}`,
        href: `mailto:${p.email}?subject=${encodeURIComponent("Prenotazione confermata")}&body=${testo}`,
        onclick: segna("email"),
      }, "Email"),
    );
  }
  return h("div", { class: "messaggi" }, stato, link.length ? h("span", { class: "legenda" }, "Invia:") : null, link);
}

function rigaPrenotazione(p, dati, ricarica) {
  const etichette = [];
  if (p.occasione) etichette.push(h("span", { class: "etichetta occasione" }, OCCASIONI[p.occasione] ?? p.occasione));
  if (p.visite >= 2) etichette.push(h("span", { class: "etichetta abituale" }, `Cliente abituale, ${p.visite} visite`));
  else if (p.visite === 1) etichette.push(h("span", { class: "etichetta" }, "Già venuto una volta"));
  if (p.no_show) etichette.push(h("span", { class: "etichetta allerta" }, `${p.no_show} ${p.no_show === 1 ? "assenza" : "assenze"} in passato`));
  if (p.origine !== "online") etichette.push(h("span", { class: "etichetta" }, ORIGINI[p.origine]));
  if (p.sconto) etichette.push(h("span", { class: "etichetta sconto" }, `Sconto ${p.sconto}%`));

  const azioni = azioniPer(p.stato).map(([testo, nuovo]) =>
    h("button", {
      type: "button",
      class: nuovo === "annullata" || nuovo === "no_show" ? "secondario pericolo" : "secondario",
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await cambiaStato(p.id, nuovo);
          avviso(`${p.nome}: ${STATI[nuovo].toLowerCase()}.`);
          await ricarica();
        } catch (err) {
          avviso(err.message, "errore");
          await ricarica();
        }
      },
    }, testo),
  );

  const tavolo = selettoreTavolo(p, dati.tavoli, dati.sale, async (valore, select) => {
    select.disabled = true;
    try {
      await cambiaTavolo(p.id, valore);
      avviso(valore ? `${p.nome} spostato al tavolo ${dati.tavoli.find((t) => t.id === valore).nome}.` : `${p.nome} è ora senza tavolo.`);
    } catch (err) {
      avviso(err.message, "errore");
    }
    await ricarica();
  });

  return h(
    "article",
    { class: "riga", dataset: { stato: p.stato } },
    h("div", { class: "quanti", title: "Persone" }, String(p.persone)),
    h(
      "div",
      { class: "chi" },
      h("p", { class: "nome-cliente" }, h("strong", {}, p.nome), h("span", { class: `badge-stato stato-${p.stato}` }, STATI[p.stato])),
      h(
        "p",
        { class: "contatti" },
        p.telefono ? h("a", { href: `tel:${p.telefono.replace(/[^\d+]/g, "")}` }, p.telefono) : null,
        p.email ? h("span", {}, p.email) : null,
        h("span", {}, `Codice ${p.codice}`),
      ),
      etichette.length ? h("p", { class: "etichette" }, etichette) : null,
      p.note ? h("p", { class: "nota" }, `Richiesta: ${p.note}`) : null,
      p.note_cliente ? h("p", { class: "nota" }, `Note sul cliente: ${p.note_cliente}`) : null,
      bloccoMessaggio(p, ricarica),
    ),
    h("div", { class: "gestione-riga" }, h("label", { class: "piccola" }, "Tavolo", tavolo), h("div", { class: "azioni" }, azioni)),
  );
}

export function apriNuovaPrenotazione({ tavoli, sale, data, ora, tavolo_id, onSalvata }) {
  const messaggio = h("p", { class: "messaggio", role: "alert", hidden: true });
  const forza = h("button", { type: "button", class: "secondario", hidden: true }, "Salva senza tavolo");
  const modulo = h(
    "form",
    { class: "modulo-dialogo", method: "dialog" },
    h("h2", {}, "Nuova prenotazione"),
    h(
      "fieldset",
      { class: "scelta-origine" },
      h("legend", { class: "piccola" }, "Come è arrivata"),
      h("label", { class: "spunta" }, h("input", { type: "radio", name: "origine", value: "telefono", checked: true }), "Al telefono"),
      h("label", { class: "spunta" }, h("input", { type: "radio", name: "origine", value: "walk_in" }), "Cliente senza prenotazione, già al tavolo"),
    ),
    h(
      "div",
      { class: "campi" },
      h("label", {}, "Giorno", h("input", { type: "date", name: "data", required: true, value: data })),
      h("label", {}, "Ora", h("input", { type: "time", name: "ora", required: true, step: 900, value: ora })),
      h("label", {}, "Persone", h("input", { type: "number", name: "persone", required: true, min: 1, max: 50, value: 2 })),
      h(
        "label",
        {},
        "Tavolo",
        h(
          "select",
          { name: "tavolo_id" },
          h("option", { value: "" }, "Scegli in automatico"),
          sale.map((s) =>
            h("optgroup", { label: s.nome }, tavoli.filter((t) => t.sala_id === s.id).map((t) => h("option", { value: t.id, selected: t.id === tavolo_id }, etichettaTavolo(t)))),
          ),
        ),
      ),
      h("label", {}, "Nome e cognome", h("input", { name: "nome", required: true, minlength: 2, maxlength: 80 })),
      h("label", {}, "Telefono", h("input", { name: "telefono", type: "tel", maxlength: 30 })),
      h("label", { class: "largo" }, "Email (facoltativa)", h("input", { name: "email", type: "email", maxlength: 254 })),
      h("label", { class: "largo" }, "Note", h("textarea", { name: "note", rows: 2, maxlength: 300 })),
    ),
    messaggio,
    h(
      "div",
      { class: "pulsanti-dialogo" },
      h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Chiudi"),
      forza,
      h("button", { type: "submit", class: "azione" }, "Salva prenotazione"),
    ),
  );

  const invia = async (forzata) => {
    const c = new FormData(modulo);
    messaggio.hidden = true;
    try {
      const r = await api("/api/admin/prenotazioni", {
        metodo: "POST",
        corpo: {
          origine: c.get("origine"),
          data: c.get("data"),
          ora: c.get("ora"),
          persone: Number(c.get("persone")),
          tavolo_id: c.get("tavolo_id") || null,
          nome: c.get("nome"),
          telefono: c.get("telefono"),
          email: c.get("email"),
          note: c.get("note"),
          forza: forzata,
        },
      });
      chiudiDialogo();
      avviso(r.tavolo_id ? `Prenotazione salvata al tavolo ${tavoli.find((t) => t.id === r.tavolo_id)?.nome}.` : "Prenotazione salvata senza tavolo.");
      await onSalvata(c.get("data"));
    } catch (e) {
      messaggio.textContent = e.message;
      messaggio.hidden = false;
      forza.hidden = e.status !== 409;
    }
  };
  modulo.addEventListener("submit", (e) => {
    e.preventDefault();
    if (modulo.reportValidity()) invia(false);
  });
  forza.addEventListener("click", () => {
    if (modulo.reportValidity()) invia(true);
  });
  apriDialogo(modulo);
  modulo.querySelector("[name=nome]").focus();
}


const VISTE = { giorno: "Giorno", settimana: "Settimana", mese: "Mese" };
const giornoSett = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const inizioSettimana = (iso) => spostaData(iso, -((giornoSett(iso) + 6) % 7));
const meseDopo = (iso, n) => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const fineMese = (iso) => spostaData(meseDopo(iso, 1), -1);

function totali(prenotazioni) {
  const attive = prenotazioni.filter((p) => ATTIVI.includes(p.stato));
  return {
    prenotazioni: attive.length,
    coperti: attive.reduce((s, p) => s + p.persone, 0),
    daConfermare: prenotazioni.filter((p) => p.stato === "in_attesa").length,
  };
}

export async function vistaAgenda(contenitore) {
  let vista = condiviso.vistaAgenda ?? "giorno";
  let filtro = "tutto";
  let dati = null;
  let sala = null;

  const titolo = h("h1");
  const riepilogo = h("p", { class: "riepilogo", "aria-live": "polite" });
  const corpo = h("div", { class: "corpo-agenda" });
  const dataInput = h("input", { type: "date", "aria-label": "Vai alla data" });
  const filtri = h(
    "div",
    { class: "filtri", role: "group", "aria-label": "Servizio" },
    Object.entries(FILTRI).map(([k, v]) =>
      h("button", {
        type: "button",
        class: "filtro",
        "aria-pressed": k === filtro ? "true" : "false",
        onclick: (e) => {
          filtro = k;
          filtri.querySelectorAll(".filtro").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          disegnaGiorno();
        },
      }, v),
    ),
  );
  const segmenti = h(
    "div",
    { class: "segmenti", role: "group", "aria-label": "Vista dell'agenda" },
    Object.entries(VISTE).map(([k, v]) =>
      h("button", { type: "button", "aria-pressed": k === vista ? "true" : "false", dataset: { vista: k }, onclick: () => cambiaVista(k) }, v),
    ),
  );

  function cambiaVista(k) {
    vista = k;
    condiviso.vistaAgenda = k;
    segmenti.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vista === k)));
    ricarica();
  }

  function apriGiorno(iso) {
    condiviso.data = iso;
    cambiaVista("giorno");
  }

  function sposta(n) {
    if (n === 0) condiviso.data = oggiRoma();
    else if (vista === "mese") condiviso.data = meseDopo(condiviso.data, n);
    else condiviso.data = spostaData(condiviso.data, vista === "settimana" ? n * 7 : n);
    ricarica();
  }

  dataInput.addEventListener("change", () => {
    if (!dataInput.value) return;
    condiviso.data = dataInput.value;
    ricarica();
  });

  const navigatore = h(
    "div",
    { class: "scegli-giorno" },
    h("button", { type: "button", class: "secondario", onclick: () => sposta(-1), "aria-label": "Periodo precedente" }, "‹"),
    dataInput,
    h("button", { type: "button", class: "secondario", onclick: () => sposta(1), "aria-label": "Periodo successivo" }, "›"),
    h("button", { type: "button", class: "secondario", onclick: () => sposta(0) }, "Oggi"),
  );

  async function ricarica() {
    dataInput.value = condiviso.data;
    filtri.hidden = vista !== "giorno";
    corpo.replaceChildren(h("p", { class: "legenda" }, "Carico l'agenda."));
    try {
      if (vista === "giorno") {
        dati = await api(`/api/admin/agenda?data=${condiviso.data}`);
        sala = { tavoli: dati.tavoli, sale: dati.sale };
        disegnaGiorno();
      } else {
        const da = vista === "settimana" ? inizioSettimana(condiviso.data) : inizioSettimana(`${condiviso.data.slice(0, 7)}-01`);
        const a = vista === "settimana" ? spostaData(da, 6) : spostaData(inizioSettimana(fineMese(condiviso.data)), 6);
        const periodo = await api(`/api/admin/periodo?da=${da}&a=${a}`);
        if (vista === "settimana") disegnaSettimana(periodo);
        else disegnaMese(periodo);
      }
    } catch (e) {
      if (e.status !== 401) corpo.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  }

  function disegnaGiorno() {
    titolo.textContent = testoData(condiviso.data);
    const visibili = dati.prenotazioni.filter((p) =>
      filtro === "tutto" ? true : filtro === "pranzo" ? p.inizio_min < 17 * 60 : p.inizio_min >= 17 * 60,
    );
    const t = totali(visibili);
    const senzaTavolo = visibili.filter((p) => ATTIVI.includes(p.stato) && !p.tavolo_id).length;
    riepilogo.replaceChildren(
      ...[
        `${t.prenotazioni} ${t.prenotazioni === 1 ? "prenotazione" : "prenotazioni"} per ${t.coperti} coperti.`,
        t.daConfermare ? h("strong", { class: "da-fare" }, ` ${t.daConfermare} da confermare.`) : null,
        senzaTavolo ? h("strong", { class: "da-fare" }, ` ${senzaTavolo} senza tavolo.`) : null,
      ].filter(Boolean),
    );
    corpo.replaceChildren();
    if (!visibili.length) {
      corpo.append(
        h(
          "div",
          { class: "vuoto" },
          h("p", {}, "Nessuna prenotazione per questo servizio."),
          h("button", { type: "button", class: "secondario", onclick: nuova }, "Aggiungi una prenotazione"),
        ),
      );
      return;
    }
    for (const ora of [...new Set(visibili.map((p) => p.ora))]) {
      const gruppo = visibili.filter((p) => p.ora === ora);
      corpo.append(
        h(
          "section",
          { class: "turno" },
          h("h2", {}, ora, h("small", {}, `${totali(gruppo).coperti} coperti`)),
          gruppo.map((p) => rigaPrenotazione(p, dati, ricarica)),
        ),
      );
    }
  }

  function vocePeriodo(p) {
    return h(
      "button",
      {
        type: "button",
        class: `voce stato-${p.stato}`,
        onclick: () => apriGiorno(p.data),
        "aria-label": `${p.ora}, ${p.nome}, ${persone(p.persone)}, ${STATI[p.stato].toLowerCase()}`,
      },
      h("span", { class: "voce-ora" }, p.ora),
      h("span", { class: "voce-nome" }, p.nome),
      h("span", { class: "voce-persone" }, String(p.persone)),
    );
  }

  const chiusoIl = (periodo, iso) =>
    periodo.chiusure.find((c) => c.data === iso)?.motivo || (!periodo.giorni_aperti.includes(giornoSett(iso)) ? "Chiuso" : null);

  function disegnaSettimana(periodo) {
    titolo.textContent = `Settimana dal ${testoData(periodo.da, { day: "numeric", month: "long" })} al ${testoData(periodo.a, { day: "numeric", month: "long" })}`;
    const t = totali(periodo.prenotazioni);
    riepilogo.replaceChildren(
      ...[
        `${t.prenotazioni} ${t.prenotazioni === 1 ? "prenotazione" : "prenotazioni"} per ${t.coperti} coperti.`,
        t.daConfermare ? h("strong", { class: "da-fare" }, ` ${t.daConfermare} da confermare.`) : null,
      ].filter(Boolean),
    );
    const colonne = [];
    for (let i = 0; i < 7; i += 1) {
      const iso = spostaData(periodo.da, i);
      const del = periodo.prenotazioni.filter((p) => p.data === iso);
      const tg = totali(del);
      const chiuso = chiusoIl(periodo, iso);
      colonne.push(
        h(
          "section",
          { class: `colonna-giorno${iso === oggiRoma() ? " oggi" : ""}${chiuso ? " chiuso" : ""}` },
          h(
            "button",
            { type: "button", class: "testa-giorno", onclick: () => apriGiorno(iso) },
            h("span", { class: "nome-giorno" }, testoData(iso, { weekday: "short", day: "numeric" })),
            h("span", { class: "legenda" }, chiuso ?? (tg.prenotazioni ? `${tg.coperti} coperti` : "Nessuna")),
          ),
          del.length ? h("div", { class: "voci" }, del.map(vocePeriodo)) : null,
        ),
      );
    }
    corpo.replaceChildren(h("div", { class: "settimana" }, colonne));
  }

  function disegnaMese(periodo) {
    const mese = condiviso.data.slice(0, 7);
    titolo.textContent = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mese}-15T12:00:00Z`));
    const delMese = periodo.prenotazioni.filter((p) => p.data.startsWith(mese));
    const t = totali(delMese);
    riepilogo.replaceChildren(
      ...[
        `${t.prenotazioni} ${t.prenotazioni === 1 ? "prenotazione" : "prenotazioni"} per ${t.coperti} coperti nel mese.`,
        t.daConfermare ? h("strong", { class: "da-fare" }, ` ${t.daConfermare} da confermare.`) : null,
      ].filter(Boolean),
    );
    const celle = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((g) => h("span", { class: "intestazione-mese" }, g));
    for (let iso = periodo.da; iso <= periodo.a; iso = spostaData(iso, 1)) {
      const del = periodo.prenotazioni.filter((p) => p.data === iso);
      const tg = totali(del);
      const chiuso = chiusoIl(periodo, iso);
      const fuori = !iso.startsWith(mese);
      celle.push(
        h(
          "button",
          {
            type: "button",
            class: `cella-mese${fuori ? " fuori" : ""}${iso === oggiRoma() ? " oggi" : ""}${chiuso ? " chiuso" : ""}`,
            onclick: () => apriGiorno(iso),
            "aria-label": `${testoData(iso)}: ${chiuso ? "chiuso" : `${tg.prenotazioni} prenotazioni, ${tg.coperti} coperti`}${tg.daConfermare ? `, ${tg.daConfermare} da confermare` : ""}`,
          },
          h("span", { class: "numero-giorno" }, String(Number(iso.slice(8)))),
          chiuso && !tg.prenotazioni
            ? h("span", { class: "legenda" }, "Chiuso")
            : tg.prenotazioni
              ? [h("span", { class: "conteggio-mese" }, `${tg.coperti} coperti`), h("span", { class: "legenda" }, `${tg.prenotazioni} pren.`)]
              : null,
          tg.daConfermare ? h("span", { class: "badge-mese" }, `${tg.daConfermare} da confermare`) : null,
        ),
      );
    }
    corpo.replaceChildren(h("div", { class: "mese" }, celle));
  }

  async function nuova() {
    if (!sala) sala = await api("/api/admin/sala");
    apriNuovaPrenotazione({
      tavoli: sala.tavoli,
      sale: sala.sale,
      data: condiviso.data,
      ora: condiviso.data === oggiRoma() ? daMinuti(Math.min(Math.floor(aMinuti(oraRoma()) / 15) * 15, 23 * 60 + 45)) : "20:00",
      onSalvata: async (data) => {
        condiviso.data = data;
        if (vista === "giorno") await ricarica();
        else apriGiorno(data);
      },
    });
  }

  contenitore.append(
    h(
      "div",
      { class: "testata-vista" },
      titolo,
      h("button", { type: "button", class: "azione compatta", onclick: () => nuova().catch((e) => avviso(e.message, "errore")) }, "Nuova prenotazione"),
    ),
    h("div", { class: "strumenti strumenti-agenda" }, segmenti, navigatore, filtri),
    riepilogo,
    corpo,
  );
  await ricarica();
  return {};
}
