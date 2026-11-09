import { api, apriDialogo, avviso, chiudiDialogo, h } from "./comune.js";
import { creaPianta, creaTavolo, posiziona } from "./pianta.js";

const GRIGLIA = 10;
const MODELLI = {
  tondo: { forma: "tondo", posti_min: 2, posti_max: 4, larghezza: 120, altezza: 120 },
  quadrato: { forma: "quadrato", posti_min: 1, posti_max: 2, larghezza: 90, altezza: 90 },
  rettangolo: { forma: "rettangolo", posti_min: 4, posti_max: 6, larghezza: 220, altezza: 100 },
};
const NOMI_FORMA = { tondo: "Tondo", quadrato: "Quadrato", rettangolo: "Rettangolare" };

const clona = (x) => JSON.parse(JSON.stringify(x));
const limita = (v, min, max) => Math.min(Math.max(v, min), max);
const aGriglia = (v) => Math.round(v / GRIGLIA) * GRIGLIA;

export async function vistaMappa(contenitore) {
  let salvato = await api("/api/admin/sala");
  let stato = clona(salvato);
  let salaId = stato.sale[0]?.id;
  let sceltoId = null;
  let modificato = false;

  const schede = h("div", { class: "schede", role: "tablist", "aria-label": "Sale" });
  const area = h("div", { class: "area-pianta editor" });
  const proprieta = h("aside", { class: "pannello-laterale" });
  const salva = h("button", { type: "button", class: "azione compatta", disabled: true }, "Salva la mappa");
  const scarta = h("button", { type: "button", class: "secondario", disabled: true }, "Annulla le modifiche");
  const statoSalvataggio = h("p", { class: "legenda", "aria-live": "polite" }, "Nessuna modifica da salvare.");

  const sala = () => stato.sale.find((s) => s.id === salaId);
  const tavolo = () => stato.tavoli.find((t) => t.id === sceltoId);
  const postiTotali = () => stato.tavoli.filter((t) => t.sala_id === salaId).reduce((s, t) => s + t.posti_max, 0);

  function segnaModificato() {
    modificato = true;
    salva.disabled = false;
    scarta.disabled = false;
    statoSalvataggio.textContent = "Ci sono modifiche non salvate.";
  }

  function disegna() {
    schede.replaceChildren(
      ...stato.sale.map((s) =>
        h("button", {
          type: "button",
          role: "tab",
          class: "scheda-sala",
          "aria-selected": s.id === salaId ? "true" : "false",
          onclick: () => {
            salaId = s.id;
            sceltoId = null;
            disegna();
          },
        }, s.nome),
      ),
      h("button", { type: "button", class: "scheda-sala aggiungi", onclick: aggiungiSala }, "Aggiungi sala"),
    );
    const s = sala();
    if (!s) {
      area.replaceChildren(h("p", { class: "vuoto" }, "Aggiungi una sala per iniziare a disegnare i tavoli."));
      proprieta.replaceChildren();
      return;
    }
    const pianta = creaPianta(s);
    pianta.classList.add("modificabile");
    for (const t of stato.tavoli.filter((x) => x.sala_id === s.id)) pianta.append(tavoloModificabile(t, s, pianta));
    pianta.addEventListener("pointerdown", (e) => {
      if (e.target === pianta) {
        sceltoId = null;
        disegna();
      }
    });
    area.replaceChildren(
      h(
        "div",
        { class: "strumenti-mappa" },
        h("span", { class: "legenda" }, "Aggiungi tavolo:"),
        Object.keys(MODELLI).map((f) =>
          h("button", { type: "button", class: "secondario", onclick: () => aggiungiTavolo(f) }, NOMI_FORMA[f]),
        ),
        h("span", { class: "legenda conteggio" }, `${stato.tavoli.filter((t) => t.sala_id === s.id).length} tavoli, ${postiTotali()} posti`),
      ),
      pianta,
      h("p", { class: "legenda" }, "Trascina i tavoli per spostarli. Con un tavolo selezionato puoi usare le frecce della tastiera: tieni premuto Maiusc per spostamenti più ampi."),
    );
    disegnaProprieta();
  }

  function tavoloModificabile(t, s, pianta) {
    const el = creaTavolo(t, s, {
      selezionato: t.id === sceltoId,
      stato: t.online ? "libero" : "solo-sala",
      etichetta: `Tavolo ${t.nome}, ${t.posti_min}-${t.posti_max} posti. Selezionalo per modificarlo.`,
    });
    let partenza = null;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const box = pianta.getBoundingClientRect();
      partenza = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, scala: s.larghezza / box.width, mosso: false };
      if (sceltoId !== t.id) {
        sceltoId = t.id;
        pianta.querySelectorAll(".tavolo").forEach((x) => {
          const sel = x.dataset.id === t.id;
          x.classList.toggle("selezionato", sel);
          x.setAttribute("aria-pressed", String(sel));
        });
        disegnaProprieta();
      }
      el.focus({ preventScroll: true });
    });
    el.addEventListener("pointermove", (e) => {
      if (!partenza) return;
      const dx = (e.clientX - partenza.x) * partenza.scala;
      const dy = (e.clientY - partenza.y) * partenza.scala;
      if (!partenza.mosso && Math.hypot(dx, dy) < 4) return;
      partenza.mosso = true;
      t.x = limita(aGriglia(partenza.tx + dx), 0, s.larghezza - t.larghezza);
      t.y = limita(aGriglia(partenza.ty + dy), 0, s.altezza - t.altezza);
      posiziona(el, t, s);
    });
    const fine = () => {
      if (partenza?.mosso) {
        segnaModificato();
        disegnaProprieta();
      }
      partenza = null;
    };
    el.addEventListener("pointerup", fine);
    el.addEventListener("pointercancel", fine);
    el.addEventListener("keydown", (e) => {
      const passo = e.shiftKey ? 50 : GRIGLIA;
      const spostamenti = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] };
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        eliminaTavolo(t);
        return;
      }
      const d = spostamenti[e.key];
      if (!d) return;
      e.preventDefault();
      sceltoId = t.id;
      t.x = limita(t.x + d[0], 0, s.larghezza - t.larghezza);
      t.y = limita(t.y + d[1], 0, s.altezza - t.altezza);
      posiziona(el, t, s);
      segnaModificato();
      disegnaProprieta();
    });
    return el;
  }

  function nomeLibero() {
    const usati = new Set(stato.tavoli.map((t) => t.nome.toLowerCase()));
    for (let n = 1; ; n += 1) if (!usati.has(String(n))) return String(n);
  }

  function aggiungiTavolo(forma) {
    const s = sala();
    const m = MODELLI[forma];
    let x = aGriglia((s.larghezza - m.larghezza) / 2);
    let y = aGriglia((s.altezza - m.altezza) / 2);
    const sovrapposto = () =>
      stato.tavoli.some((o) => o.sala_id === s.id && x < o.x + o.larghezza && o.x < x + m.larghezza && y < o.y + o.altezza && o.y < y + m.altezza);
    for (let i = 0; i < 40 && sovrapposto(); i += 1) {
      x = limita(x + 40, 0, s.larghezza - m.larghezza);
      y = limita(y + 30, 0, s.altezza - m.altezza);
    }
    const nuovo = { id: crypto.randomUUID(), sala_id: s.id, nome: nomeLibero(), online: 1, x, y, ...m };
    stato.tavoli.push(nuovo);
    sceltoId = nuovo.id;
    segnaModificato();
    disegna();
    proprieta.querySelector("input[name=nome]")?.focus();
  }

  function eliminaTavolo(t) {
    stato.tavoli = stato.tavoli.filter((x) => x.id !== t.id);
    sceltoId = null;
    segnaModificato();
    disegna();
    avviso(`Tavolo ${t.nome} rimosso. Salva la mappa per confermare.`);
  }

  function aggiungiSala() {
    const nuova = { id: crypto.randomUUID(), nome: `Sala ${stato.sale.length + 1}`, larghezza: 1000, altezza: 600 };
    stato.sale.push(nuova);
    salaId = nuova.id;
    sceltoId = null;
    segnaModificato();
    disegna();
  }

  function campoNumero(etichetta, nome, valore, min, max, onCambia) {
    const input = h("input", { type: "number", name: nome, value: valore, min, max, required: true });
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (!Number.isInteger(v) || v < min || v > max) {
        input.value = valore;
        avviso(`${etichetta}: inserisci un numero da ${min} a ${max}.`, "errore");
        return;
      }
      onCambia(v);
      segnaModificato();
      disegna();
    });
    return h("label", {}, etichetta, input);
  }

  function disegnaProprieta() {
    const s = sala();
    const t = tavolo();
    const blocchi = [];
    if (t) {
      const nome = h("input", { name: "nome", value: t.nome, maxlength: 12, required: true });
      nome.addEventListener("change", () => {
        const v = nome.value.trim();
        if (!v) {
          nome.value = t.nome;
          return;
        }
        t.nome = v;
        segnaModificato();
        disegna();
      });
      const forma = h(
        "select",
        { name: "forma" },
        Object.entries(NOMI_FORMA).map(([k, v]) => h("option", { value: k, selected: k === t.forma }, v)),
      );
      forma.addEventListener("change", () => {
        t.forma = forma.value;
        if (t.forma === "tondo") t.altezza = t.larghezza = Math.max(t.larghezza, t.altezza);
        t.x = limita(t.x, 0, s.larghezza - t.larghezza);
        t.y = limita(t.y, 0, s.altezza - t.altezza);
        segnaModificato();
        disegna();
      });
      const sposta = h(
        "select",
        { name: "sala" },
        stato.sale.map((x) => h("option", { value: x.id, selected: x.id === t.sala_id }, x.nome)),
      );
      sposta.addEventListener("change", () => {
        const dest = stato.sale.find((x) => x.id === sposta.value);
        t.sala_id = dest.id;
        t.x = limita(t.x, 0, dest.larghezza - t.larghezza);
        t.y = limita(t.y, 0, dest.altezza - t.altezza);
        salaId = dest.id;
        segnaModificato();
        disegna();
      });
      const online = h("input", { type: "checkbox", checked: Boolean(t.online) });
      online.addEventListener("change", () => {
        t.online = online.checked ? 1 : 0;
        segnaModificato();
        disegna();
      });
      blocchi.push(
        h("h2", {}, `Tavolo ${t.nome}`),
        h(
          "div",
          { class: "campi stretti" },
          h("label", { class: "largo" }, "Nome", nome),
          campoNumero("Posti minimi", "posti_min", t.posti_min, 1, 30, (v) => {
            t.posti_min = v;
            if (t.posti_max < v) t.posti_max = v;
          }),
          campoNumero("Posti massimi", "posti_max", t.posti_max, 1, 30, (v) => {
            t.posti_max = v;
            if (t.posti_min > v) t.posti_min = v;
          }),
          h("label", {}, "Forma", forma),
          h("label", {}, "Sala", sposta),
          campoNumero("Larghezza", "larghezza", t.larghezza, 40, Math.min(600, s.larghezza), (v) => {
            t.larghezza = v;
            if (t.forma === "tondo") t.altezza = v;
            t.x = limita(t.x, 0, s.larghezza - t.larghezza);
            t.y = limita(t.y, 0, s.altezza - t.altezza);
          }),
          campoNumero("Profondità", "altezza", t.altezza, 40, Math.min(600, s.altezza), (v) => {
            t.altezza = v;
            if (t.forma === "tondo") t.larghezza = v;
            t.x = limita(t.x, 0, s.larghezza - t.larghezza);
            t.y = limita(t.y, 0, s.altezza - t.altezza);
          }),
          h("label", { class: "spunta largo" }, online, h("span", {}, "Prenotabile online")),
        ),
        h(
          "p",
          { class: "legenda" },
          "Il sistema assegna online questo tavolo a gruppi da ",
          String(t.posti_min),
          " a ",
          String(t.posti_max),
          " persone.",
        ),
        h("button", { type: "button", class: "secondario pericolo", onclick: () => eliminaTavolo(t) }, "Elimina tavolo"),
      );
    } else {
      blocchi.push(h("h2", {}, "Seleziona un tavolo"), h("p", { class: "legenda" }, "Clicca un tavolo sulla pianta per cambiarne nome, posti, forma e dimensioni."));
    }
    if (s) {
      const nomeSala = h("input", { value: s.nome, maxlength: 40 });
      nomeSala.addEventListener("change", () => {
        const v = nomeSala.value.trim();
        if (!v) {
          nomeSala.value = s.nome;
          return;
        }
        s.nome = v;
        segnaModificato();
        disegna();
      });
      const vuota = !stato.tavoli.some((t2) => t2.sala_id === s.id);
      blocchi.push(
        h("hr"),
        h("h2", {}, "Sala"),
        h("div", { class: "campi stretti" }, h("label", { class: "largo" }, "Nome della sala", nomeSala)),
        h("button", {
          type: "button",
          class: "secondario pericolo",
          disabled: !vuota || stato.sale.length === 1,
          onclick: () => {
            stato.sale = stato.sale.filter((x) => x.id !== s.id);
            salaId = stato.sale[0]?.id;
            segnaModificato();
            disegna();
          },
        }, "Elimina sala"),
        !vuota ? h("p", { class: "legenda" }, "Per eliminare la sala sposta o elimina prima i suoi tavoli.") : null,
      );
    }
    proprieta.replaceChildren(...blocchi.filter(Boolean));
  }

  salva.addEventListener("click", async () => {
    salva.disabled = true;
    statoSalvataggio.textContent = "Salvo la mappa.";
    try {
      salvato = await api("/api/admin/sala", { metodo: "PUT", corpo: stato });
      stato = clona(salvato);
      if (!stato.sale.some((s) => s.id === salaId)) salaId = stato.sale[0]?.id;
      modificato = false;
      scarta.disabled = true;
      statoSalvataggio.textContent = "Mappa salvata.";
      avviso("Mappa salvata. Le nuove disponibilità sono già online.");
      disegna();
    } catch (e) {
      salva.disabled = false;
      statoSalvataggio.textContent = "La mappa non è stata salvata.";
      avviso(e.message, "errore");
    }
  });

  scarta.addEventListener("click", () => {
    stato = clona(salvato);
    if (!stato.sale.some((s) => s.id === salaId)) salaId = stato.sale[0]?.id;
    sceltoId = null;
    modificato = false;
    salva.disabled = true;
    scarta.disabled = true;
    statoSalvataggio.textContent = "Modifiche annullate.";
    disegna();
  });

  contenitore.append(
    h("div", { class: "testata-vista" }, h("h1", {}, "Mappa tavoli"), h("div", { class: "pulsanti-testata" }, scarta, salva)),
    statoSalvataggio,
    schede,
    h("div", { class: "layout-sala" }, area, proprieta),
  );
  disegna();

  return {
    esci(destinazione) {
      if (!modificato) return true;
      const conferma = h(
        "div",
        { class: "modulo-dialogo" },
        h("h2", {}, "Hai modifiche non salvate"),
        h("p", {}, "Se cambi sezione ora, le modifiche alla mappa andranno perse."),
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
          h("button", { type: "button", class: "azione", onclick: chiudiDialogo }, "Resta sulla mappa"),
        ),
      );
      apriDialogo(conferma);
      return false;
    },
  };
}
