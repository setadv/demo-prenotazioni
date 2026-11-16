import { api, apriDialogo, avviso, chiudiDialogo, h, testoData, paginaPubblica } from "./comune.js";
import { impostazioniModulo, pulsantiInvio } from "./moduli.js";

const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);
const dataBreve = (iso) => testoData(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });
const NOMI_CANALE = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };

export async function vistaFidelity(contenitore) {
  let moduli = await api("/api/admin/moduli");
  const corpoFidelity = h("div", {});
  const corpoGift = h("div", {});
  const esitoCodice = h("div", { class: "esito-codice", "aria-live": "polite" });

  // ---------- Verifica di un codice alla cassa ----------
  const campoCodice = h("input", { placeholder: "GC-ABC123 o PR-ABC123", "aria-label": "Codice", autocapitalize: "characters", maxlength: 20 });
  async function verifica(e) {
    e?.preventDefault();
    try {
      const r = await api(`/api/admin/codice?c=${encodeURIComponent(campoCodice.value.trim())}`);
      esitoCodice.replaceChildren(r.tipo === "gift" ? esitoGift(r) : esitoPremio(r));
    } catch (err) {
      esitoCodice.replaceChildren(h("p", { class: "messaggio" }, err.message));
    }
  }
  function esitoPremio(p) {
    const valido = p.stato === "attivo" && !p.scaduto;
    return h(
      "div",
      { class: `esito ${valido ? "valido" : "non-valido"}` },
      h("p", {}, h("strong", {}, `Premio ${p.codice}`), ` · ${p.nome}`),
      h("p", {}, p.descrizione),
      h("p", { class: "legenda" }, valido ? `Valido fino al ${dataBreve(p.scade_il)}` : p.stato === "usato" ? "Già usato" : p.scaduto ? "Scaduto" : "Annullato"),
      valido
        ? h("button", {
            type: "button",
            class: "azione compatta",
            onclick: async () => {
              try {
                await api(`/api/admin/premi/${p.id}/usa`, { metodo: "POST" });
                avviso(`Premio ${p.codice} consegnato.`);
                verifica();
                caricaFidelity();
              } catch (err) {
                avviso(err.message, "errore");
              }
            },
          }, "Segna come consegnato")
        : null,
    );
  }
  function esitoGift(g) {
    const valido = g.stato === "attiva" && !g.scaduto && g.saldo > 0;
    const importo = h("input", { inputmode: "decimal", placeholder: "0,00", "aria-label": "Importo da scalare in euro" });
    return h(
      "div",
      { class: `esito ${valido ? "valido" : "non-valido"}` },
      h("p", {}, h("strong", {}, `Gift card ${g.codice}`), g.destinatario_nome ? ` · per ${g.destinatario_nome}` : ""),
      h("p", { class: "saldo-grande" }, `Saldo ${euro(g.saldo)}`, h("span", { class: "legenda" }, ` su ${euro(g.importo)}`)),
      h("p", { class: "legenda" }, g.stato !== "attiva" ? "Annullata" : g.scaduto ? `Scaduta il ${dataBreve(g.scade_il)}` : `Valida fino al ${dataBreve(g.scade_il)}`),
      valido
        ? h(
            "form",
            {
              class: "riga-input",
              onsubmit: async (e) => {
                e.preventDefault();
                try {
                  await api(`/api/admin/gift/${g.id}/usa`, { metodo: "POST", corpo: { importo: importo.value } });
                  avviso(`Scalati ${importo.value} € dalla gift card ${g.codice}.`);
                  verifica();
                  caricaGift();
                } catch (err) {
                  avviso(err.message, "errore");
                }
              },
            },
            importo,
            h("button", { type: "submit", class: "azione compatta" }, "Scala dal saldo"),
          )
        : null,
    );
  }

  // ---------- Raccolta punti ----------
  async function caricaFidelity() {
    const f = await api("/api/admin/fidelity");
    const i = moduli.impostazioni;
    corpoFidelity.replaceChildren(
      h(
        "p",
        { class: "legenda" },
        i.fidelity_attiva
          ? `${i.punti_visita} punti a visita e ${i.punti_euro} per euro di ordine. A ${i.premio_soglia} punti il cliente riceve in automatico: ${i.premio_descrizione.toLowerCase()}.`
          : "La raccolta punti è spenta: attivala dalle impostazioni qui sotto.",
      ),
      h(
        "dl",
        { class: "cifre" },
        h("div", {}, h("dt", {}, "Iscritti"), h("dd", {}, String(f.iscritti))),
        h("div", {}, h("dt", {}, "Premi da consegnare"), h("dd", {}, String(f.premi_attivi.filter((p) => !p.scaduto).length))),
        h("div", {}, h("dt", {}, "Premi consegnati"), h("dd", {}, String(f.premi_usati))),
      ),
      h("h3", {}, "Premi da consegnare"),
      f.premi_attivi.length
        ? h(
            "ul",
            { class: "lista-premi" },
            f.premi_attivi.map((p) => {
              const inviato = p.notifica && ["inviata", "manuale"].includes(p.notifica.esito);
              return h(
                "li",
                { class: p.scaduto ? "scaduto" : "" },
                h("p", {}, h("strong", {}, p.nome), ` · ${p.codice} · `, p.scaduto ? "scaduto" : `fino al ${dataBreve(p.scade_il)}`),
                h(
                  "div",
                  { class: "messaggi" },
                  inviato ? h("span", { class: "invio ok" }, `Avvisato via ${NOMI_CANALE[p.notifica.canale]}`) : h("span", { class: "invio attesa" }, "Da avvisare:"),
                  inviato ? null : pulsantiInvio({ testo: p.messaggio, telefono: p.telefono, email: p.email, canale: p.notifica?.canale, oggetto: "Hai un premio" }),
                ),
              );
            }),
          )
        : h("p", { class: "vuoto" }, "Nessun premio in attesa."),
      f.classifica.length
        ? h(
            "details",
            { class: "traduzioni" },
            h("summary", {}, "Clienti più fedeli"),
            h("ol", { class: "classifica" }, f.classifica.map((c) => h("li", {}, h("strong", {}, c.nome), ` · ${c.accumulati} punti accumulati, ${c.saldo} disponibili`))),
          )
        : null,
    );
  }

  // ---------- Gift card ----------
  const cercaGift = h("input", { type: "search", placeholder: "Codice o nome", "aria-label": "Cerca una gift card" });
  let timerGift;
  cercaGift.addEventListener("input", () => {
    clearTimeout(timerGift);
    timerGift = setTimeout(caricaGift, 250);
  });

  async function caricaGift() {
    const g = await api(`/api/admin/gift?q=${encodeURIComponent(cercaGift.value.trim())}`);
    corpoGift.replaceChildren(
      h(
        "p",
        { class: "legenda" },
        g.online ? "I clienti le comprano online con carta dalla pagina " : "Il pagamento online non è configurato: le vendi al ristorante e le emetti da qui. Pagina pubblica: ",
        h("a", { href: paginaPubblica("/regalo"), target: "_blank", rel: "noopener" }, "Regala una gift card"),
        ".",
      ),
      h(
        "dl",
        { class: "cifre" },
        h("div", {}, h("dt", {}, "Attive"), h("dd", {}, String(g.totali.emesse))),
        h("div", {}, h("dt", {}, "Vendute"), h("dd", {}, euro(g.totali.venduto))),
        h("div", {}, h("dt", {}, "Ancora da spendere"), h("dd", {}, euro(g.totali.da_spendere))),
      ),
      h("div", { class: "strumenti" }, cercaGift, h("button", { type: "button", class: "azione compatta", onclick: apriEmissione }, "Emetti una gift card")),
      g.gift_card.length
        ? h(
            "ul",
            { class: "lista-premi" },
            g.gift_card.map((c) => {
              const inviato = c.notifica && ["inviata", "manuale"].includes(c.notifica.esito);
              return h(
                "li",
                { class: c.stato !== "attiva" || c.scaduta ? "scaduto" : "" },
                h(
                  "p",
                  {},
                  h("strong", {}, `${c.codice} · ${euro(c.saldo)}`),
                  ` di ${euro(c.importo)} · per ${c.destinatario_nome || "?"}${c.acquirente_nome ? `, da ${c.acquirente_nome}` : ""} · `,
                  c.stato !== "attiva" ? "annullata" : c.scaduta ? "scaduta" : `fino al ${dataBreve(c.scade_il)}`,
                  c.origine === "online" ? h("span", { class: "etichetta" }, "online") : null,
                ),
                h(
                  "div",
                  { class: "messaggi" },
                  h("a", { href: c.link, target: "_blank", rel: "noopener" }, "Apri"),
                  ...(() => {
                    if (inviato) return [h("span", { class: "invio ok" }, `Inviata via ${NOMI_CANALE[c.notifica.canale]}`)];
                    const link = pulsantiInvio({ testo: c.messaggio, telefono: c.destinatario_telefono || c.acquirente_telefono, email: c.destinatario_email || c.acquirente_email, canale: "whatsapp", oggetto: "Una gift card per te" });
                    if (link.length) return [h("span", { class: "invio attesa" }, "Invia:"), ...link];
                    // Nessun contatto: il gestore copia il link e lo manda o lo stampa come preferisce.
                    return [h("button", { type: "button", class: "secondario", onclick: (e) => navigator.clipboard.writeText(c.link).then(() => { e.target.textContent = "Link copiato"; }).catch(() => {}) }, "Copia il link")];
                  })(),
                  c.stato === "attiva"
                    ? h("button", {
                        type: "button",
                        class: "secondario pericolo",
                        onclick: async () => {
                          if (!confirm(`Annullare la gift card ${c.codice}?`)) return;
                          await api(`/api/admin/gift/${c.id}/annulla`, { metodo: "POST" }).catch((e) => avviso(e.message, "errore"));
                          caricaGift();
                        },
                      }, "Annulla")
                    : null,
                ),
              );
            }),
          )
        : h("p", { class: "vuoto" }, "Nessuna gift card."),
    );
  }

  function apriEmissione() {
    const errore = h("p", { class: "messaggio", role: "alert", hidden: true });
    const importi = String(moduli.impostazioni.gift_importi).split(",");
    const modulo = h(
      "form",
      { class: "modulo-dialogo" },
      h("h2", {}, "Emetti una gift card"),
      h("p", { class: "legenda" }, "Per una gift card pagata al ristorante. Con email o telefono del destinatario, il messaggio con il link parte subito o resta pronto da inviare con un clic."),
      h(
        "div",
        { class: "campi" },
        h("label", {}, "Importo in euro", h("input", { name: "importo", type: "number", min: 1, max: 2000, required: true, value: importi[1] ?? importi[0], list: "importi-gift" }), h("datalist", { id: "importi-gift" }, importi.map((i) => h("option", { value: i })))),
        h("label", {}, "Lingua", h("select", { name: "lingua" }, Object.entries({ it: "Italiano", en: "Inglese", de: "Tedesco", fr: "Francese", es: "Spagnolo" }).map(([k, v]) => h("option", { value: k }, v)))),
        h("label", {}, "Per (nome)", h("input", { name: "destinatario_nome", required: true, maxlength: 80 })),
        h("label", {}, "Da parte di", h("input", { name: "acquirente_nome", maxlength: 80 })),
        h("label", {}, "Email del destinatario", h("input", { name: "destinatario_email", type: "email", maxlength: 254 })),
        h("label", {}, "Telefono del destinatario", h("input", { name: "destinatario_telefono", type: "tel", maxlength: 30 })),
        h("label", { class: "largo" }, "Dedica", h("textarea", { name: "messaggio", rows: 2, maxlength: 300 })),
      ),
      errore,
      h("div", { class: "pulsanti-dialogo" }, h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla"), h("button", { type: "submit", class: "azione" }, "Emetti")),
    );
    modulo.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!modulo.reportValidity()) return;
      try {
        const corpo = Object.fromEntries(new FormData(modulo));
        const r = await api("/api/admin/gift", { metodo: "POST", corpo: { ...corpo, importo: Number(corpo.importo) } });
        chiudiDialogo();
        avviso(`Gift card ${r.codice} emessa.`);
        caricaGift();
      } catch (err) {
        errore.textContent = err.message;
        errore.hidden = false;
      }
    });
    apriDialogo(modulo);
  }

  const ricarica = (r) => {
    moduli = r;
    caricaFidelity();
    caricaGift();
  };

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Fidelity e gift card")),
    h(
      "section",
      { class: "blocco verifica-codice" },
      h("h2", {}, "Verifica un codice"),
      h("p", { class: "legenda" }, "Il cliente mostra il codice o il QR: scrivilo qui per vedere saldo e validità, poi scala l'importo o consegna il premio."),
      h("form", { class: "riga-input", onsubmit: verifica }, campoCodice, h("button", { type: "submit", class: "azione compatta" }, "Verifica")),
      esitoCodice,
    ),
    h("section", { class: "blocco" }, h("h2", {}, "Raccolta punti"), corpoFidelity),
    impostazioniModulo({
      titolo: "Impostazioni della raccolta punti",
      modulo: "fidelity",
      impostazioni: moduli.impostazioni,
      onSalvato: ricarica,
      campi: [
        { chiave: "fidelity_attiva", tipo: "spunta", etichetta: "Raccolta punti attiva (i clienti si iscrivono con una casella in prenotazione e negli ordini)" },
        { chiave: "punti_visita", tipo: "numero", etichetta: "Punti per ogni visita", min: 0, max: 1000, aiuto: "Accreditati quando segni Arrivati." },
        { chiave: "punti_euro", tipo: "numero", etichetta: "Punti per euro di ordine", min: 0, max: 100, aiuto: "Accreditati quando l'ordine è completato." },
        { chiave: "premio_soglia", tipo: "numero", etichetta: "Punti per il premio", min: 10, max: 100000 },
        { chiave: "premio_validita_giorni", tipo: "numero", etichetta: "Giorni di validità del premio", min: 7, max: 730 },
        { chiave: "premio_descrizione", tipo: "tradotto", etichetta: "Il premio", max: 120, righe: 1 },
        { chiave: "messaggio_premio", tipo: "tradotto", etichetta: "Messaggio al cliente quando raggiunge il premio", aiuto: "Puoi usare: {nome}, {soglia}, {ristorante}, {premio}, {codice}, {scadenza}, {link}." },
      ],
    }),
    h("section", { class: "blocco" }, h("h2", {}, "Gift card"), corpoGift),
    impostazioniModulo({
      titolo: "Impostazioni delle gift card",
      modulo: "gift",
      impostazioni: moduli.impostazioni,
      onSalvato: ricarica,
      campi: [
        { chiave: "gift_attive", tipo: "spunta", etichetta: "Vendita online delle gift card attiva (serve Stripe)" },
        { chiave: "gift_importi", tipo: "testo", etichetta: "Importi proposti in euro", placeholder: "25, 50, 100", max: 60 },
        { chiave: "gift_validita_mesi", tipo: "numero", etichetta: "Mesi di validità", min: 1, max: 60 },
        { chiave: "messaggio_gift", tipo: "tradotto", etichetta: "Messaggio a chi riceve la gift card", aiuto: "Puoi usare: {destinatario}, {mittente}, {importo}, {ristorante}, {codice}, {scadenza}, {link}." },
      ],
    }),
  );
  await Promise.all([caricaFidelity(), caricaGift()]);
  return {};
}
