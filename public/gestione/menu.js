import { $, api, apriDialogo, avviso, chiudiDialogo, h, paginaPubblica, ridimensiona } from "./comune.js";

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

  /** Chiede al server le traduzioni dall'italiano; non salva nulla. */
  async function chiediTraduzione(testi) {
    return (await api("/api/admin/menu/traduci", { metodo: "POST", corpo: { testi } })).traduzioni;
  }

  /** Campi delle traduzioni con il pulsante che riempie quelli vuoti a partire dal testo italiano (letto da `sorgente`). */
  function campiTraduzioni(traduzioni, campi, sorgente) {
    const stato = h("span", { class: "aiuto", role: "status" });
    const pulsante = h(
      "button",
      {
        type: "button",
        class: "secondario compatta",
        onclick: async () => {
          const testi = sorgente();
          if (!Object.values(testi).some((v) => v.trim())) {
            stato.textContent = "Scrivi prima il testo in italiano.";
            return;
          }
          pulsante.disabled = true;
          stato.textContent = "Traduzione in corso…";
          try {
            const tradotte = await chiediTraduzione(testi);
            let riempiti = 0;
            for (const el of dettagli.querySelectorAll("[data-lingua]")) {
              const valore = tradotte[el.dataset.lingua]?.[el.dataset.campo];
              if (valore && !el.value.trim()) {
                el.value = el.maxLength > 0 ? valore.slice(0, el.maxLength) : valore;
                riempiti += 1;
              }
            }
            dettagli.open = true;
            stato.textContent = riempiti
              ? "Fatto. Rileggi le traduzioni, correggi se serve e salva."
              : "Le traduzioni erano già scritte. Per rifarne una, svuota il campo e premi di nuovo.";
          } catch (e) {
            stato.textContent = e.message;
          } finally {
            pulsante.disabled = false;
          }
        },
      },
      "Traduci in automatico",
    );
    const dettagli = h(
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
    return h(
      "div",
      { class: "blocco-traduzioni" },
      h("div", { class: "riga-traduci" }, pulsante, stato),
      dettagli,
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

  /** Aggiorna la foto di un piatto nella copia del menù già salvata, senza salvare di nuovo tutto il menù. */
  function segnaFoto(id, foto) {
    for (const c of menu.categorie) for (const x of c.piatti) if (x.id === id) x.foto = foto;
    disegna();
  }

  /** Foto facoltativa del piatto: si carica e si toglie subito, a parte dal salvataggio della scheda. */
  function bloccoFoto(piatto) {
    const titolo = h("legend", { class: "piccola" }, "Foto del piatto (facoltativa)");
    if (!piatto) return h("fieldset", { class: "foto-piatto" }, titolo, h("p", { class: "legenda" }, "Salva il piatto, poi riaprilo per aggiungere una foto."));
    const anteprima = h("img", { class: "anteprima-foto-piatto", alt: `Foto di ${piatto.nome}`, hidden: true });
    const esito = h("p", { class: "legenda", role: "status" });
    const rimuovi = h("button", { type: "button", class: "secondario pericolo", hidden: true }, "Togli la foto");
    const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", "aria-label": `Scegli la foto di ${piatto.nome}` });
    const etichetta = h("span", { class: "legenda" });
    const mostra = (versione) => {
      anteprima.hidden = !versione;
      rimuovi.hidden = !versione;
      etichetta.textContent = versione ? "Scegli un'altra immagine per sostituirla." : "Senza foto il menù mostra solo il testo del piatto.";
      if (versione) anteprima.src = `/api/menu/foto/${encodeURIComponent(piatto.id)}?v=${encodeURIComponent(versione)}`;
      else anteprima.removeAttribute("src");
    };
    file.addEventListener("change", async () => {
      const scelto = file.files[0];
      if (!scelto) return;
      esito.textContent = "Preparo la foto.";
      try {
        const dati = await ridimensiona(scelto, 1200, 380 * 1024, { jpg: true });
        esito.textContent = "Carico la foto.";
        const r = await api(`/api/admin/menu/foto/${encodeURIComponent(piatto.id)}`, { metodo: "PUT", corpo: dati, grezzo: true });
        piatto.foto = r.foto;
        segnaFoto(piatto.id, r.foto);
        mostra(r.foto);
        esito.textContent = "Foto salvata. La vedi già nel menù online.";
      } catch (e) {
        esito.textContent = e.message;
      }
      file.value = "";
    });
    rimuovi.addEventListener("click", async () => {
      try {
        await api(`/api/admin/menu/foto/${encodeURIComponent(piatto.id)}`, { metodo: "DELETE" });
        piatto.foto = null;
        segnaFoto(piatto.id, null);
        mostra(null);
        esito.textContent = "Foto tolta.";
      } catch (e) {
        esito.textContent = e.message;
      }
    });
    mostra(piatto.foto);
    return h(
      "fieldset",
      { class: "foto-piatto" },
      titolo,
      anteprima,
      h("div", { class: "azioni" }, file, rimuovi),
      etichetta,
      h("p", { class: "legenda" }, "JPG, PNG o WebP. Meglio orizzontale o quadrata, almeno 800 px: le foto grandi vengono ridotte da sole."),
      esito,
    );
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
      bloccoFoto(piatto),
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
      campiTraduzioni(
        p.traduzioni,
        [
          ["nome", "Nome", 80, false],
          ["descrizione", "Descrizione", 300, true],
        ],
        () => ({ nome: modulo.querySelector("[name=nome]").value, descrizione: modulo.querySelector("[name=descrizione]").value }),
      ),
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
      campiTraduzioni(c.traduzioni, [["nome", "Nome", 60, false]], () => ({ nome: modulo.querySelector("[name=nome]").value })),
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
      { class: `voce-menu${p.disponibile ? "" : " esaurito"}${p.foto ? " con-foto" : ""}` },
      p.foto
        ? h("img", { class: "voce-menu-foto", src: `/api/menu/foto/${encodeURIComponent(p.id)}?v=${encodeURIComponent(p.foto)}`, alt: "", loading: "lazy", width: 56, height: 56 })
        : null,
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

  /** Elementi del menù (categorie e piatti) a cui manca almeno una traduzione di un testo scritto in italiano. */
  function daTradurre(menuCopia) {
    const manca = (el, campi) => campi.some((c) => el[c]?.trim() && Object.keys(LINGUE).some((l) => !el.traduzioni?.[l]?.[c]));
    return [
      ...menuCopia.categorie.filter((c) => manca(c, ["nome"])).map((el) => ({ el, campi: { nome: 60 } })),
      ...menuCopia.categorie.flatMap((c) => c.piatti).filter((p) => manca(p, ["nome", "descrizione"])).map((el) => ({ el, campi: { nome: 80, descrizione: 300 } })),
    ];
  }

  /** Traduce in automatico tutte le portate e le categorie: riempie solo le traduzioni mancanti, poi salva una volta. */
  function apriTraduciTutto() {
    const nuovo = copia();
    const voci = daTradurre(nuovo);
    const piatti = voci.filter((v) => "descrizione" in v.campi).length;
    const categorie = voci.length - piatti;
    const stato = h("p", { class: "legenda", role: "status" });
    const avvia = h("button", { type: "button", class: "azione" }, "Traduci");
    const annulla = h("button", { type: "button", class: "secondario", onclick: chiudiDialogo }, voci.length ? "Annulla" : "Chiudi");
    const elenco = [piatti ? `${piatti} ${piatti === 1 ? "piatto" : "piatti"}` : "", categorie ? `${categorie} ${categorie === 1 ? "categoria" : "categorie"}` : ""].filter(Boolean).join(" e ");

    avvia.addEventListener("click", async () => {
      avvia.disabled = true;
      annulla.disabled = true;
      let fatti = 0;
      let errore = null;
      for (const { el, campi } of voci) {
        stato.textContent = `Traduzione in corso: ${fatti + 1} di ${voci.length}…`;
        const testi = Object.fromEntries(Object.keys(campi).filter((c) => el[c]?.trim()).map((c) => [c, el[c]]));
        try {
          const tradotte = await chiediTraduzione(testi);
          el.traduzioni ??= {};
          for (const l of Object.keys(LINGUE)) {
            for (const [c, max] of Object.entries(campi)) {
              const valore = tradotte[l]?.[c];
              if (valore && !el.traduzioni[l]?.[c]) (el.traduzioni[l] ??= {})[c] = valore.slice(0, max);
            }
          }
          fatti += 1;
        } catch (e) {
          errore = e.message;
          break;
        }
      }
      if (fatti) {
        const salvato = await salva(nuovo, errore ? null : `${fatti === 1 ? "Tradotto 1 elemento" : `Tradotti ${fatti} elementi`} del menù. Rileggi le traduzioni dalla scheda di ogni piatto.`);
        if (salvato && !errore) return chiudiDialogo();
      }
      stato.textContent = errore ? `${errore}${fatti ? ` Ho salvato i ${fatti} già tradotti: riprova per gli altri.` : ""}` : "Salvataggio non riuscito. Riprova.";
      annulla.disabled = false;
      annulla.textContent = "Chiudi";
    });

    apriDialogo(
      h(
        "div",
        { class: "modulo-dialogo" },
        h("h2", {}, "Traduci il menù"),
        voci.length
          ? h(
              "p",
              {},
              `Da tradurre: ${elenco}. Traduco dall'italiano in inglese, tedesco, francese e spagnolo, riempiendo solo le traduzioni che mancano: quelle già scritte restano come sono.`,
            )
          : h("p", {}, "Tutte le portate e le categorie hanno già le traduzioni nelle quattro lingue."),
        voci.length ? h("p", { class: "aiuto" }, "È una traduzione automatica: rileggila, soprattutto i nomi dei piatti tipici.") : null,
        stato,
        h("div", { class: "pulsanti-dialogo" }, annulla, voci.length ? avvia : null),
      ),
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
        h("a", { class: "secondario pulsante-link", href: paginaPubblica("/menu"), target: "_blank", rel: "noopener" }, "Apri il menù"),
        h("button", { type: "button", class: "secondario compatta", onclick: apriTraduciTutto }, "Traduci in automatico"),
        h("button", { type: "button", class: "azione compatta", onclick: apriQr }, "QR code per i tavoli"),
      ),
    ),
    h("p", { class: "legenda" }, "I clienti lo leggono dal QR sul tavolo, nella loro lingua. Ogni modifica è subito online; togli la spunta Disponibile per i piatti finiti."),
    corpo,
  );
  disegna();
  return {};
}
