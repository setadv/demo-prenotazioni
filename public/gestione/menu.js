import { $, api, apriDialogo, avviso, chiudiDialogo, h } from "./comune.js";

const ALLERGENI = {
  glutine: "Glutine",
  crostacei: "Crostacei",
  uova: "Uova",
  pesce: "Pesce",
  arachidi: "Arachidi",
  soia: "Soia",
  latte: "Latte",
  frutta_guscio: "Frutta a guscio",
  sedano: "Sedano",
  senape: "Senape",
  sesamo: "Sesamo",
  solfiti: "Solfiti",
  lupini: "Lupini",
  molluschi: "Molluschi",
};
const CARATTERISTICHE = { vegetariano: "Vegetariano", vegano: "Vegano", senza_glutine: "Senza glutine", piccante: "Piccante", novita: "Novità" };
const LINGUE = { en: "Inglese", de: "Tedesco", fr: "Francese", es: "Spagnolo" };

const nuovoId = (prefisso) => `${prefisso}-${crypto.randomUUID().slice(0, 8)}`;
const euro = (c) => (c == null ? "" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100));
const testoPrezzo = (c) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

function leggiPrezzo(valore) {
  const t = valore.trim().replace(/\s|€/g, "");
  if (!t) return null;
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(t)) throw new Error("Scrivi il prezzo in euro, per esempio 12 oppure 12,50.");
  return Math.round(Number(t.replace(",", ".")) * 100);
}

function sposta(lista, i, verso) {
  const j = i + verso;
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
}

export async function vistaMenu(contenitore) {
  let [menu, sala] = await Promise.all([api("/api/admin/menu"), api("/api/admin/sala")]);
  const corpo = h("div", { class: "editor-menu" });

  /** Salva il menù intero; se il server rifiuta, la vista torna allo stato salvato. */
  async function salva(nuovo, messaggio) {
    try {
      menu = await api("/api/admin/menu", { metodo: "PUT", corpo: { categorie: nuovo.categorie, nota: nuovo.nota } });
      disegna();
      if (messaggio) avviso(messaggio);
      return true;
    } catch (e) {
      avviso(e.message, "errore");
      disegna();
      return false;
    }
  }

  const copia = () => structuredClone({ categorie: menu.categorie, nota: menu.nota });

  function campiTraduzioni(traduzioni, campi) {
    return h(
      "details",
      { class: "traduzioni" },
      h("summary", {}, "Traduzioni per i clienti stranieri"),
      h("p", { class: "aiuto" }, "Se lasci vuoto, il cliente vede il testo in italiano."),
      Object.entries(LINGUE).map(([l, nome]) =>
        h(
          "fieldset",
          { class: "lingua-traduzione" },
          h("legend", { class: "piccola" }, nome),
          campi.map(([campo, etichetta, max, multiriga]) =>
            h(
              "label",
              {},
              etichetta,
              multiriga
                ? h("textarea", { rows: 2, maxlength: max, dataset: { lingua: l, campo }, value: traduzioni?.[l]?.[campo] ?? "" })
                : h("input", { maxlength: max, dataset: { lingua: l, campo }, value: traduzioni?.[l]?.[campo] ?? "" }),
            ),
          ),
        ),
      ),
    );
  }

  function leggiTraduzioni(radice) {
    const risultato = {};
    for (const el of radice.querySelectorAll("[data-lingua]")) {
      const valore = el.value.trim();
      if (!valore) continue;
      risultato[el.dataset.lingua] ??= {};
      risultato[el.dataset.lingua][el.dataset.campo] = valore;
    }
    return risultato;
  }

  function apriPiatto(categoriaId, piatto = null) {
    const p = piatto ?? { nome: "", descrizione: "", prezzo: null, allergeni: [], tag: [], traduzioni: {}, disponibile: true, asporto: true };
    const errore = h("p", { class: "messaggio", role: "alert", hidden: true });
    const modulo = h(
      "form",
      { class: "modulo-dialogo modulo-piatto" },
      h("h2", {}, piatto ? `Modifica ${piatto.nome}` : "Nuovo piatto"),
      h(
        "div",
        { class: "campi" },
        h("label", { class: "largo" }, "Nome", h("input", { name: "nome", required: true, maxlength: 80, value: p.nome })),
        h("label", { class: "largo" }, "Descrizione", h("textarea", { name: "descrizione", rows: 2, maxlength: 300, value: p.descrizione })),
        h("label", {}, "Prezzo in euro", h("input", { name: "prezzo", inputmode: "decimal", placeholder: "12,50", value: testoPrezzo(p.prezzo) }), h("span", { class: "aiuto" }, "Vuoto se il prezzo varia.")),
        h(
          "label",
          {},
          "Categoria",
          h("select", { name: "categoria" }, menu.categorie.map((c) => h("option", { value: c.id, selected: c.id === categoriaId }, c.nome))),
        ),
        h("label", { class: "spunta largo" }, h("input", { type: "checkbox", name: "disponibile", checked: p.disponibile }), h("span", {}, "Disponibile oggi")),
        h("label", { class: "spunta largo" }, h("input", { type: "checkbox", name: "asporto", checked: p.asporto !== false }), h("span", {}, "Ordinabile da asporto e a domicilio (serve il prezzo)")),
      ),
      h(
        "fieldset",
        { class: "griglia-spunte" },
        h("legend", { class: "piccola" }, "Caratteristiche"),
        Object.entries(CARATTERISTICHE).map(([k, nome]) => h("label", { class: "spunta" }, h("input", { type: "checkbox", name: "tag", value: k, checked: p.tag.includes(k) }), nome)),
      ),
      h(
        "fieldset",
        { class: "griglia-spunte" },
        h("legend", { class: "piccola" }, "Allergeni (Reg. UE 1169/2011)"),
        Object.entries(ALLERGENI).map(([k, nome]) =>
          h("label", { class: "spunta" }, h("input", { type: "checkbox", name: "allergeni", value: k, checked: p.allergeni.includes(k) }), nome),
        ),
      ),
      campiTraduzioni(p.traduzioni, [
        ["nome", "Nome", 80, false],
        ["descrizione", "Descrizione", 300, true],
      ]),
      errore,
      h(
        "div",
        { class: "pulsanti-dialogo" },
        piatto
          ? h("button", {
              type: "button",
              class: "secondario pericolo spingi-sinistra",
              onclick: async () => {
                const nuovo = copia();
                for (const c of nuovo.categorie) c.piatti = c.piatti.filter((x) => x.id !== piatto.id);
                if (await salva(nuovo, `${piatto.nome} eliminato dal menù.`)) chiudiDialogo();
              },
            }, "Elimina")
          : null,
        h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla"),
        h("button", { type: "submit", class: "azione" }, "Salva"),
      ),
    );
    modulo.addEventListener("submit", async (e) => {
      e.preventDefault();
      errore.hidden = true;
      const f = new FormData(modulo);
      let prezzo;
      try {
        prezzo = leggiPrezzo(f.get("prezzo"));
      } catch (err) {
        errore.textContent = err.message;
        errore.hidden = false;
        return;
      }
      const aggiornato = {
        id: piatto?.id ?? nuovoId("p"),
        nome: f.get("nome").trim(),
        descrizione: f.get("descrizione").trim(),
        prezzo,
        allergeni: f.getAll("allergeni"),
        tag: f.getAll("tag"),
        disponibile: f.get("disponibile") === "on",
        asporto: f.get("asporto") === "on",
        traduzioni: leggiTraduzioni(modulo),
      };
      if (!aggiornato.nome) {
        errore.textContent = "Scrivi il nome del piatto.";
        errore.hidden = false;
        return;
      }
      const nuovo = copia();
      const destinazione = f.get("categoria");
      for (const c of nuovo.categorie) {
        const i = c.piatti.findIndex((x) => x.id === aggiornato.id);
        if (i >= 0 && c.id === destinazione) c.piatti[i] = aggiornato;
        else if (i >= 0) c.piatti.splice(i, 1);
      }
      const cat = nuovo.categorie.find((c) => c.id === destinazione);
      if (!cat.piatti.some((x) => x.id === aggiornato.id)) cat.piatti.push(aggiornato);
      if (await salva(nuovo, `${aggiornato.nome} salvato.`)) chiudiDialogo();
    });
    apriDialogo(modulo);
    modulo.querySelector("[name=nome]").focus();
  }

  function apriCategoria(categoria = null) {
    const c = categoria ?? { nome: "", traduzioni: {} };
    const modulo = h(
      "form",
      { class: "modulo-dialogo" },
      h("h2", {}, categoria ? `Modifica ${categoria.nome}` : "Nuova categoria"),
      h("label", {}, "Nome", h("input", { name: "nome", required: true, maxlength: 60, value: c.nome, placeholder: "Antipasti, Pizze, Vini" })),
      campiTraduzioni(c.traduzioni, [["nome", "Nome", 60, false]]),
      h(
        "div",
        { class: "pulsanti-dialogo" },
        h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla"),
        h("button", { type: "submit", class: "azione" }, "Salva"),
      ),
    );
    modulo.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nome = new FormData(modulo).get("nome").trim();
      if (!nome) return;
      const nuovo = copia();
      if (categoria) Object.assign(nuovo.categorie.find((x) => x.id === categoria.id), { nome, traduzioni: leggiTraduzioni(modulo) });
      else nuovo.categorie.push({ id: nuovoId("c"), nome, traduzioni: leggiTraduzioni(modulo), piatti: [] });
      if (await salva(nuovo, `Categoria ${nome} salvata.`)) chiudiDialogo();
    });
    apriDialogo(modulo);
    modulo.querySelector("[name=nome]").focus();
  }

  function eliminaCategoria(c) {
    apriDialogo(
      h(
        "div",
        { class: "modulo-dialogo" },
        h("h2", {}, `Eliminare ${c.nome}?`),
        h("p", {}, c.piatti.length ? `Spariscono anche i suoi ${c.piatti.length} piatti.` : "La categoria è vuota."),
        h(
          "div",
          { class: "pulsanti-dialogo" },
          h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Annulla"),
          h("button", {
            type: "button",
            class: "azione",
            onclick: async () => {
              const nuovo = copia();
              nuovo.categorie = nuovo.categorie.filter((x) => x.id !== c.id);
              if (await salva(nuovo, `Categoria ${c.nome} eliminata.`)) chiudiDialogo();
            },
          }, "Elimina"),
        ),
      ),
    );
  }

  function rigaPiatto(c, p, i) {
    const disponibile = h("input", {
      type: "checkbox",
      checked: p.disponibile,
      "aria-label": `${p.nome} disponibile`,
      onchange: async (e) => {
        const nuovo = copia();
        nuovo.categorie.find((x) => x.id === c.id).piatti[i].disponibile = e.target.checked;
        await salva(nuovo, e.target.checked ? `${p.nome} di nuovo disponibile.` : `${p.nome} segnato come esaurito.`);
      },
    });
    const dettagli = [
      ...(p.asporto && p.prezzo != null ? ["Ordinabile da asporto"] : []),
      ...p.tag.map((t) => CARATTERISTICHE[t]),
      p.allergeni.length ? `Allergeni: ${p.allergeni.map((a) => ALLERGENI[a].toLowerCase()).join(", ")}` : "Nessun allergene indicato",
    ];
    const lingue = Object.keys(p.traduzioni ?? {}).length;
    return h(
      "li",
      { class: `voce-menu${p.disponibile ? "" : " esaurito"}` },
      h(
        "div",
        { class: "voce-menu-testo" },
        h("p", { class: "voce-menu-nome" }, h("strong", {}, p.nome), h("span", {}, euro(p.prezzo))),
        p.descrizione ? h("p", { class: "legenda" }, p.descrizione) : null,
        h("p", { class: "legenda" }, `${dettagli.join(" · ")}${lingue ? ` · tradotto in ${lingue} ${lingue === 1 ? "lingua" : "lingue"}` : ""}`),
      ),
      h(
        "div",
        { class: "voce-menu-azioni" },
        h("label", { class: "spunta interruttore" }, disponibile, "Disponibile"),
        h("button", { type: "button", class: "secondario", "aria-label": `Sposta su ${p.nome}`, disabled: i === 0, onclick: () => riordina(c.id, i, -1) }, "↑"),
        h("button", { type: "button", class: "secondario", "aria-label": `Sposta giù ${p.nome}`, disabled: i === c.piatti.length - 1, onclick: () => riordina(c.id, i, 1) }, "↓"),
        h("button", { type: "button", class: "secondario", onclick: () => apriPiatto(c.id, p) }, "Modifica"),
      ),
    );
  }

  async function riordina(categoriaId, i, verso) {
    const nuovo = copia();
    sposta(nuovo.categorie.find((x) => x.id === categoriaId).piatti, i, verso);
    await salva(nuovo);
  }

  async function riordinaCategoria(i, verso) {
    const nuovo = copia();
    sposta(nuovo.categorie, i, verso);
    await salva(nuovo);
  }

  function sezioneNota() {
    const modulo = h(
      "form",
      { class: "blocco" },
      h("h2", {}, "Nota in fondo al menù"),
      h("p", { class: "legenda" }, "Coperto, servizio, avvisi su allergie e intolleranze."),
      h("label", {}, "In italiano", h("textarea", { name: "it", rows: 2, maxlength: 300, value: menu.nota.it ?? "" })),
      h(
        "details",
        { class: "traduzioni" },
        h("summary", {}, "Traduzioni"),
        Object.entries(LINGUE).map(([l, nome]) => h("label", {}, nome, h("textarea", { name: l, rows: 2, maxlength: 300, value: menu.nota[l] ?? "" }))),
      ),
      h("div", { class: "pulsanti-dialogo" }, h("button", { type: "submit", class: "azione compatta" }, "Salva la nota")),
    );
    modulo.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(modulo);
      const nuovo = copia();
      nuovo.nota = Object.fromEntries(["it", ...Object.keys(LINGUE)].map((l) => [l, f.get(l) ?? ""]));
      await salva(nuovo, "Nota del menù salvata.");
    });
    return modulo;
  }

  function disegna() {
    const totale = menu.categorie.reduce((n, c) => n + c.piatti.length, 0);
    const esauriti = menu.categorie.reduce((n, c) => n + c.piatti.filter((p) => !p.disponibile).length, 0);
    corpo.replaceChildren(
      h("p", { class: "riepilogo" }, `${totale} ${totale === 1 ? "piatto" : "piatti"} in ${menu.categorie.length} ${menu.categorie.length === 1 ? "categoria" : "categorie"}${esauriti ? `, ${esauriti} esauriti oggi` : ""}.`),
      ...menu.categorie.map((c, i) =>
        h(
          "section",
          { class: "blocco categoria-editor" },
          h(
            "div",
            { class: "testa-categoria" },
            h("h2", {}, c.nome),
            h(
              "div",
              { class: "azioni" },
              h("button", { type: "button", class: "secondario", "aria-label": `Sposta su ${c.nome}`, disabled: i === 0, onclick: () => riordinaCategoria(i, -1) }, "↑"),
              h("button", { type: "button", class: "secondario", "aria-label": `Sposta giù ${c.nome}`, disabled: i === menu.categorie.length - 1, onclick: () => riordinaCategoria(i, 1) }, "↓"),
              h("button", { type: "button", class: "secondario", onclick: () => apriCategoria(c) }, "Rinomina"),
              h("button", { type: "button", class: "secondario pericolo", onclick: () => eliminaCategoria(c) }, "Elimina"),
            ),
          ),
          c.piatti.length ? h("ul", { class: "voci-menu" }, c.piatti.map((p, j) => rigaPiatto(c, p, j))) : h("p", { class: "vuoto" }, "Nessun piatto in questa categoria."),
          h("button", { type: "button", class: "secondario", onclick: () => apriPiatto(c.id) }, "Aggiungi un piatto"),
        ),
      ),
      h("button", { type: "button", class: "secondario aggiungi-categoria", onclick: () => apriCategoria() }, "Aggiungi una categoria"),
      sezioneNota(),
    );
  }

  /** QR code da stampare: uno generale, uno per la prenotazione e uno per ogni tavolo (indica il tavolo nel menù). */
  function apriQr() {
    const tavoli = [...sala.tavoli].sort((a, b) => a.nome.localeCompare(b.nome, "it", { numeric: true }));
    const scheda = (titolo, sottotitolo, src) =>
      h(
        "figure",
        { class: "qr-scheda" },
        h("img", { src, alt: `QR code: ${titolo}`, width: 160, height: 160 }),
        h("figcaption", {}, h("strong", {}, titolo), h("span", {}, sottotitolo), h("a", { href: `${src}${src.includes("?") ? "&" : "?"}scarica=1` }, "Scarica SVG")),
      );
    apriDialogo(
      h(
        "div",
        { class: "modulo-dialogo dialogo-largo" },
        h("h2", {}, "QR code"),
        h("p", { class: "legenda" }, "Il QR del tavolo apre il menù con il numero del tavolo. Stampali e mettili nei segnaposto o sui portamenù."),
        h(
          "div",
          { class: "griglia-qr" },
          scheda("Menù", "Per vetrina, bancone e social", "/api/qr"),
          scheda("Prenota un tavolo", "Per biglietti da visita e volantini", "/api/qr?pagina=prenota"),
          tavoli.map((t) => scheda(`Tavolo ${t.nome}`, sala.sale.find((s) => s.id === t.sala_id)?.nome ?? "", `/api/qr?t=${encodeURIComponent(t.id)}`)),
        ),
        h(
          "div",
          { class: "pulsanti-dialogo" },
          h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, "Chiudi"),
          h("button", { type: "button", class: "azione", onclick: () => stampa(tavoli) }, "Stampa i QR dei tavoli"),
        ),
      ),
    );
  }

  async function stampa(tavoli) {
    const nomeLocale = $("nome-locale").textContent;
    const foglio = $("stampa");
    const schede = [{ titolo: "Menù", src: "/api/qr" }, ...tavoli.map((t) => ({ titolo: `Tavolo ${t.nome}`, src: `/api/qr?t=${encodeURIComponent(t.id)}` }))];
    foglio.replaceChildren(
      ...schede.map((s) =>
        h(
          "div",
          { class: "segnaposto" },
          h("p", { class: "segnaposto-locale" }, nomeLocale),
          h("img", { src: s.src, alt: "" }),
          h("p", { class: "segnaposto-titolo" }, s.titolo),
          h("p", { class: "segnaposto-invito" }, "Inquadra per il menù · Scan for the menu"),
        ),
      ),
    );
    await Promise.all([...foglio.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
    document.body.classList.add("stampa-qr");
    window.addEventListener("afterprint", () => document.body.classList.remove("stampa-qr"), { once: true });
    window.print();
  }

  contenitore.append(
    h(
      "div",
      { class: "testata-vista" },
      h("h1", {}, "Menù"),
      h(
        "div",
        { class: "pulsanti-testata" },
        h("a", { class: "secondario pulsante-link", href: "/menu", target: "_blank", rel: "noopener" }, "Apri il menù"),
        h("button", { type: "button", class: "azione compatta", onclick: apriQr }, "QR code per i tavoli"),
      ),
    ),
    h("p", { class: "legenda" }, "I clienti lo leggono dal QR sul tavolo, nella loro lingua. Ogni modifica è subito online; togli la spunta Disponibile per i piatti finiti."),
    corpo,
  );
  disegna();
  return {};
}
