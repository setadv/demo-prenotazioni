import { GIORNI, ORDINE_GIORNI, api, apriDialogo, avviso, chiudiDialogo, h, oggiRoma } from "./comune.js";

/** Riduce le immagini troppo grandi prima del caricamento. Il PNG resta PNG per conservare la trasparenza. */
async function ridimensiona(file, maxLato, maxByte) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Scegli un'immagine JPG, PNG o WebP.");
  const bitmap = await createImageBitmap(file);
  const scala = Math.min(1, maxLato / Math.max(bitmap.width, bitmap.height));
  if (scala === 1 && file.size <= maxByte) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scala);
  canvas.height = Math.round(bitmap.height * scala);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const tipo = file.type === "image/png" ? "image/png" : "image/jpeg";
  for (const qualita of [0.86, 0.75, 0.62]) {
    const blob = await new Promise((ok) => canvas.toBlob(ok, tipo, qualita));
    if (blob && blob.size <= maxByte) return blob;
    if (tipo === "image/png") break;
  }
  throw new Error(`L'immagine è ancora troppo pesante: usane una più leggera di ${Math.round(maxByte / 1024)} KB.`);
}

export async function vistaImpostazioni(contenitore) {
  let conf = await api("/api/admin/configurazione");
  let modificato = false;
  const modulo = h("form", { class: "impostazioni", novalidate: true });
  const salva = h("button", { type: "submit", class: "azione compatta" }, "Salva le impostazioni");
  const errore = h("p", { class: "messaggio", role: "alert", hidden: true });

  const segna = (e) => {
    if (e?.target?.type === "file") return;
    modificato = true;
  };
  modulo.addEventListener("input", segna);
  modulo.addEventListener("change", segna);

  function campo(etichetta, nome, valore, attributi = {}, aiuto) {
    return h(
      "label",
      { class: attributi.largo ? "largo" : null },
      etichetta,
      attributi.multiriga
        ? h("textarea", { name: nome, rows: 3, maxlength: attributi.maxlength, value: valore ?? "" })
        : h("input", { name: nome, value: valore ?? "", ...Object.fromEntries(Object.entries(attributi).filter(([k]) => !["largo", "multiriga"].includes(k))) }),
      aiuto ? h("span", { class: "aiuto" }, aiuto) : null,
    );
  }

  const orari = h("div", { class: "righe" });
  const chiusure = h("div", { class: "righe" });
  const promozioni = h("div", { class: "righe" });

  function rigaOrario(o = { giorno: 2, servizio: "Cena", inizio: "19:30", fine: "22:00" }) {
    const riga = h(
      "div",
      { class: "riga-modifica orario-riga" },
      h("label", {}, "Giorno", h("select", { name: "giorno" }, ORDINE_GIORNI.map((g) => h("option", { value: g, selected: g === o.giorno }, GIORNI[g])))),
      h("label", {}, "Servizio", h("input", { name: "servizio", value: o.servizio, maxlength: 30, required: true })),
      h("label", {}, "Primo orario", h("input", { type: "time", name: "inizio", value: o.inizio, step: 900, required: true })),
      h("label", {}, "Ultimo orario", h("input", { type: "time", name: "fine", value: o.fine, step: 900, required: true })),
      h("button", { type: "button", class: "secondario pericolo", onclick: () => { riga.remove(); segna(); } }, "Rimuovi"),
    );
    return riga;
  }

  function rigaChiusura(c = { data: oggiRoma(), motivo: "" }) {
    const riga = h(
      "div",
      { class: "riga-modifica" },
      h("label", {}, "Data", h("input", { type: "date", name: "data", value: c.data, min: oggiRoma(), required: true })),
      h("label", { class: "cresce" }, "Motivo (lo vedono i clienti)", h("input", { name: "motivo", value: c.motivo, maxlength: 80, placeholder: "Ferie, evento privato" })),
      h("button", { type: "button", class: "secondario pericolo", onclick: () => { riga.remove(); segna(); } }, "Rimuovi"),
    );
    return riga;
  }

  function rigaPromo(p = { giorni: [2, 3, 4], ora_da: "19:30", ora_a: "20:00", sconto: 20, attiva: true }) {
    const riga = h(
      "div",
      { class: "riga-modifica promo-riga" },
      h(
        "fieldset",
        { class: "giorni-promo" },
        h("legend", { class: "piccola" }, "Giorni"),
        ORDINE_GIORNI.map((g) =>
          h("label", { class: "spunta" }, h("input", { type: "checkbox", name: "giorni", value: g, checked: p.giorni.includes(g) }), GIORNI[g].slice(0, 3)),
        ),
      ),
      h("label", {}, "Dalle", h("input", { type: "time", name: "ora_da", value: p.ora_da, step: 900, required: true })),
      h("label", {}, "Alle", h("input", { type: "time", name: "ora_a", value: p.ora_a, step: 900, required: true })),
      h("label", {}, "Sconto %", h("input", { type: "number", name: "sconto", value: p.sconto, min: 5, max: 50, required: true })),
      h("label", { class: "spunta" }, h("input", { type: "checkbox", name: "attiva", checked: p.attiva }), "Attiva"),
      h("button", { type: "button", class: "secondario pericolo", onclick: () => { riga.remove(); segna(); } }, "Rimuovi"),
    );
    return riga;
  }

  function riempi() {
    const i = conf.impostazioni;
    orari.replaceChildren(...[...conf.orari].sort((a, b) => ORDINE_GIORNI.indexOf(a.giorno) - ORDINE_GIORNI.indexOf(b.giorno) || a.inizio.localeCompare(b.inizio)).map(rigaOrario));
    chiusure.replaceChildren(...conf.chiusure.map(rigaChiusura));
    promozioni.replaceChildren(...conf.promozioni.map(rigaPromo));
    const chiusi = [0, 1, 2, 3, 4, 5, 6].filter((g) => !conf.orari.some((o) => o.giorno === g));
    giorniChiusi.textContent = chiusi.length ? `Giorni di chiusura settimanale: ${chiusi.map((g) => GIORNI[g].toLowerCase()).join(", ")}.` : "Aperto tutti i giorni.";
    modulo.replaceChildren(
      ...[
      h(
        "section",
        { class: "blocco" },
        h("h2", {}, "Il ristorante"),
        h("p", { class: "legenda" }, "Questi dati compaiono nella pagina di prenotazione."),
        h(
          "div",
          { class: "campi" },
          campo("Nome", "nome", i.nome, { required: true, maxlength: 60 }),
          campo("Telefono", "telefono", i.telefono, { maxlength: 30 }),
          campo("Indirizzo", "indirizzo", i.indirizzo, { maxlength: 120, largo: true }),
          campo("Descrizione", "descrizione", i.descrizione, { maxlength: 500, multiriga: true, largo: true }),
          campo("Prezzo medio a persona (€)", "prezzo_medio", i.prezzo_medio, { type: "number", min: 0, max: 500 }),
        ),
      ),
      h(
        "section",
        { class: "blocco" },
        h("h2", {}, "Regole di prenotazione"),
        h(
          "div",
          { class: "campi" },
          campo("Durata di un tavolo (minuti)", "durata", i.durata, { type: "number", min: 30, max: 300, step: 15 }, "Per quanto tempo un tavolo resta occupato."),
          h(
            "label",
            {},
            "Orari proposti ogni",
            h("select", { name: "intervallo" }, [15, 30, 60].map((m) => h("option", { value: m, selected: m === i.intervallo }, `${m} minuti`))),
          ),
          campo("Preavviso minimo (minuti)", "anticipo", i.anticipo, { type: "number", min: 0, max: 1440, step: 15 }, "Quanto prima del pasto si può prenotare online."),
          campo("Prenotabile fino a (giorni)", "giorni_prenotabili", i.giorni_prenotabili, { type: "number", min: 1, max: 365 }, "183 giorni sono circa sei mesi."),
          campo("Persone massime online", "max_persone_online", i.max_persone_online, { type: "number", min: 1, max: 30 }, "Gruppi più grandi devono telefonare."),
          h(
            "label",
            { class: "spunta largo" },
            h("input", { type: "checkbox", name: "conferma_automatica", checked: Boolean(i.conferma_automatica) }),
            h("span", {}, "Conferma automaticamente le prenotazioni online. Se disattivato, le confermi tu dall'agenda."),
          ),
        ),
      ),
      h(
        "section",
        { class: "blocco" },
        h("h2", {}, "Orari dei servizi"),
        h("p", { class: "legenda" }, "Per ogni giorno indica il primo e l'ultimo orario in cui si può prenotare. Un giorno senza servizi è un giorno di chiusura."),
        giorniChiusi,
        orari,
        h("button", { type: "button", class: "secondario", onclick: () => { orari.append(rigaOrario()); segna(); } }, "Aggiungi un servizio"),
      ),
      h(
        "section",
        { class: "blocco" },
        h("h2", {}, "Chiusure straordinarie"),
        chiusure,
        h("button", { type: "button", class: "secondario", onclick: () => { chiusure.append(rigaChiusura()); segna(); } }, "Aggiungi una chiusura"),
      ),
      h(
        "section",
        { class: "blocco" },
        h("h2", {}, "Promozioni"),
        h("p", { class: "legenda" }, "Uno sconto sul conto alla carta, mostrato sugli orari che vuoi riempire. Se più promozioni coprono lo stesso orario vale la più alta."),
        promozioni,
        h("button", { type: "button", class: "secondario", onclick: () => { promozioni.append(rigaPromo()); segna(); } }, "Aggiungi una promozione"),
      ),
      sezioneMessaggi(),
      sezioneImmagini(),
      errore,
      h("div", { class: "barra-salva" }, salva),
      ].filter(Boolean),
    );
  }

  function sezioneMessaggi() {
    const c = conf.canali;
    const statoCanale = (attivo, nome, aiuto) =>
      h("li", {}, h("strong", {}, nome), attivo ? " parte da solo quando la prenotazione è confermata." : ` si invia con un clic dall'agenda. ${aiuto}`);
    return h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Messaggio di conferma"),
      h("p", { class: "legenda" }, "Il cliente lo riceve quando la prenotazione è confermata, sia in automatico sia quando la confermi tu dall'agenda."),
      h(
        "ul",
        { class: "canali-stato" },
        statoCanale(c.email, "Email", "Per l'invio automatico servono un account Resend e i secret RESEND_API_KEY ed EMAIL_MITTENTE."),
        statoCanale(c.sms, "SMS", "Per l'invio automatico servono un account Twilio e i secret TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_NUMERO."),
        statoCanale(false, "WhatsApp", "L'invio automatico richiede WhatsApp Business con modelli approvati da Meta."),
      ),
      h(
        "label",
        {},
        "Testo del messaggio",
        h("textarea", { name: "messaggio_conferma", rows: 4, maxlength: 600, value: conf.impostazioni.messaggio_conferma ?? "" }),
        h("span", { class: "aiuto" }, "Puoi usare: {nome}, {ristorante}, {persone}, {data}, {ora}, {codice}, {link}, {telefono}, {indirizzo}. Lascia {link}: serve al cliente per vedere o annullare."),
      ),
    );
  }

  function sezioneImmagini() {
    const blocco = (chiave, titolo, aiuto, maxKB, maxLato, femminile = false) => {
      const anteprima = h("img", { class: `anteprima-${chiave}`, alt: titolo, hidden: true });
      const esito = h("p", { class: "legenda", role: "status" });
      const rimuovi = h("button", { type: "button", class: "secondario pericolo", hidden: true }, "Rimuovi");
      const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", "aria-label": `Scegli ${titolo.toLowerCase()}` });
      const mostra = () => {
        anteprima.hidden = true;
        anteprima.onload = () => {
          anteprima.hidden = false;
          rimuovi.hidden = false;
        };
        anteprima.onerror = () => {
          rimuovi.hidden = true;
        };
        anteprima.src = `/api/media/${chiave}?v=${Date.now()}`;
      };
      file.addEventListener("change", async () => {
        const scelto = file.files[0];
        if (!scelto) return;
        esito.textContent = "Preparo l'immagine.";
        try {
          const dati = await ridimensiona(scelto, maxLato, maxKB * 1024);
          esito.textContent = "Carico l'immagine.";
          await api(`/api/admin/media/${chiave}`, { metodo: "PUT", corpo: dati, grezzo: true });
          esito.textContent = `${titolo} ${femminile ? "aggiornata" : "aggiornato"}. ${femminile ? "La" : "Lo"} vedi già nella pagina di prenotazione.`;
          mostra();
        } catch (e) {
          esito.textContent = e.message;
        }
        file.value = "";
      });
      rimuovi.addEventListener("click", async () => {
        try {
          await api(`/api/admin/media/${chiave}`, { metodo: "DELETE" });
          anteprima.hidden = true;
          rimuovi.hidden = true;
          esito.textContent = `${titolo} ${femminile ? "rimossa" : "rimosso"}.`;
        } catch (e) {
          esito.textContent = e.message;
        }
      });
      mostra();
      return h("div", { class: "immagine" }, h("h3", {}, titolo), h("p", { class: "legenda" }, aiuto), anteprima, h("div", { class: "azioni" }, file, rimuovi), esito);
    };
    return h(
      "section",
      { class: "blocco" },
      h("h2", {}, "Logo e foto"),
      h(
        "div",
        { class: "immagini" },
        blocco("logo", "Logo", "Compare in cima alla pagina di prenotazione. Meglio un PNG con sfondo trasparente.", 500, 800),
        blocco("foto", "Foto del locale", "Compare sotto il nome del ristorante. Le foto grandi vengono ridotte in automatico.", 1500, 1600, true),
      ),
    );
  }

  const giorniChiusi = h("p", { class: "legenda" });

  function leggi() {
    const f = new FormData(modulo);
    const righe = (box, fn) => [...box.querySelectorAll(":scope > .riga-modifica")].map(fn);
    const val = (r, n) => r.querySelector(`[name=${n}]`).value;
    return {
      impostazioni: {
        nome: f.get("nome"),
        telefono: f.get("telefono"),
        indirizzo: f.get("indirizzo"),
        descrizione: f.get("descrizione"),
        prezzo_medio: Number(f.get("prezzo_medio")),
        durata: Number(f.get("durata")),
        intervallo: Number(f.get("intervallo")),
        anticipo: Number(f.get("anticipo")),
        giorni_prenotabili: Number(f.get("giorni_prenotabili")),
        max_persone_online: Number(f.get("max_persone_online")),
        conferma_automatica: f.get("conferma_automatica") === "on",
        messaggio_conferma: f.get("messaggio_conferma"),
      },
      orari: righe(orari, (r) => ({ giorno: Number(val(r, "giorno")), servizio: val(r, "servizio"), inizio: val(r, "inizio"), fine: val(r, "fine") })),
      chiusure: righe(chiusure, (r) => ({ data: val(r, "data"), motivo: val(r, "motivo") })),
      promozioni: righe(promozioni, (r) => ({
        giorni: [...r.querySelectorAll("[name=giorni]:checked")].map((x) => Number(x.value)),
        ora_da: val(r, "ora_da"),
        ora_a: val(r, "ora_a"),
        sconto: Number(val(r, "sconto")),
        attiva: r.querySelector("[name=attiva]").checked,
      })),
    };
  }

  modulo.addEventListener("submit", async (e) => {
    e.preventDefault();
    errore.hidden = true;
    salva.disabled = true;
    try {
      conf = await api("/api/admin/configurazione", { metodo: "PUT", corpo: leggi() });
      modificato = false;
      riempi();
      document.getElementById("nome-locale").textContent = conf.impostazioni.nome;
      avviso("Impostazioni salvate. La pagina di prenotazione è già aggiornata.");
    } catch (err) {
      errore.textContent = err.message;
      errore.hidden = false;
      errore.scrollIntoView({ block: "center" });
    } finally {
      salva.disabled = false;
    }
  });

  contenitore.append(h("div", { class: "testata-vista" }, h("h1", {}, "Impostazioni")), modulo);
  riempi();

  return {
    esci(destinazione) {
      if (!modificato) return true;
      apriDialogo(
        h(
          "div",
          { class: "modulo-dialogo" },
          h("h2", {}, "Hai modifiche non salvate"),
          h("p", {}, "Se cambi sezione ora, le modifiche alle impostazioni andranno perse."),
          h(
            "div",
            { class: "pulsanti-dialogo" },
            h("button", {
              type: "button",
              class: "secondario pericolo",
              onclick: () => {
                modificato = false;
                chiudiDialogo();
                location.hash = destinazione;
              },
            }, "Esci senza salvare"),
            h("button", { type: "button", class: "azione", onclick: chiudiDialogo }, "Resta qui"),
          ),
        ),
      );
      return false;
    },
  };
}
