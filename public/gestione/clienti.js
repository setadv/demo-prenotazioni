import { api, avviso, h, testoData } from "./comune.js";

export async function vistaClienti(contenitore) {
  const cerca = h("input", { type: "search", placeholder: "Nome, telefono o email", "aria-label": "Cerca un cliente" });
  const elenco = h("div", { class: "elenco-clienti", "aria-live": "polite" });
  let timer;
  let ultima = 0;

  async function carica() {
    const richiesta = ++ultima;
    try {
      const { clienti } = await api(`/api/admin/clienti?q=${encodeURIComponent(cerca.value.trim())}`);
      if (richiesta !== ultima) return;
      disegna(clienti);
    } catch (e) {
      if (e.status !== 401) elenco.replaceChildren(h("p", { class: "messaggio" }, e.message));
    }
  }

  function disegna(clienti) {
    if (!clienti.length) {
      elenco.replaceChildren(
        h("p", { class: "vuoto" }, cerca.value.trim() ? "Nessun cliente corrisponde alla ricerca." : "I clienti compaiono qui dopo la prima prenotazione."),
      );
      return;
    }
    elenco.replaceChildren(
      h("p", { class: "legenda" }, `${clienti.length} ${clienti.length === 1 ? "cliente" : "clienti"}${clienti.length === 100 ? ": mostro i primi 100, affina la ricerca" : ""}`),
      ...clienti.map(schedaCliente),
    );
  }

  function schedaCliente(c) {
    const note = h("textarea", { rows: 2, maxlength: 500, value: c.note ?? "", "aria-label": `Note su ${c.nome}` });
    const salva = h("button", { type: "button", class: "secondario", disabled: true }, "Salva nota");
    note.addEventListener("input", () => {
      salva.disabled = note.value === (c.note ?? "");
    });
    salva.addEventListener("click", async () => {
      salva.disabled = true;
      try {
        await api(`/api/admin/clienti/${c.id}`, { metodo: "PATCH", corpo: { note: note.value } });
        c.note = note.value;
        avviso(`Nota su ${c.nome} salvata.`);
      } catch (e) {
        salva.disabled = false;
        avviso(e.message, "errore");
      }
    });
    const dati = [
      `${c.visite ?? 0} ${c.visite === 1 ? "visita" : "visite"}`,
      `${c.prenotazioni} ${c.prenotazioni === 1 ? "prenotazione" : "prenotazioni"}`,
    ];
    if (c.ultima_visita) dati.push(`ultima visita ${testoData(c.ultima_visita, { day: "numeric", month: "short", year: "numeric" })}`);
    if (c.prossima) dati.push(`prossima ${testoData(c.prossima, { day: "numeric", month: "short" })}`);
    return h(
      "article",
      { class: "cliente" },
      h(
        "div",
        { class: "testa-cliente" },
        h("h2", {}, c.nome),
        c.no_show ? h("span", { class: "etichetta allerta" }, `${c.no_show} ${c.no_show === 1 ? "assenza" : "assenze"}`) : null,
        c.visite >= 2 ? h("span", { class: "etichetta abituale" }, "Abituale") : null,
      ),
      h(
        "p",
        { class: "contatti" },
        c.telefono ? h("a", { href: `tel:${c.telefono.replace(/[^\d+]/g, "")}` }, c.telefono) : null,
        c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : null,
      ),
      h("p", { class: "legenda" }, dati.join(", ")),
      h("div", { class: "nota-cliente" }, note, salva),
    );
  }

  cerca.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(carica, 250);
  });

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Clienti")),
    h("p", { class: "legenda" }, "Ogni cliente viene riconosciuto dal telefono o dall'email, così vedi visite, assenze e preferenze a ogni nuova prenotazione."),
    h("div", { class: "strumenti" }, cerca),
    elenco,
  );
  await carica();
  return {};
}
