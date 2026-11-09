import { h } from "./comune.js";

/** Dispone le sedie intorno al tavolo: in cerchio per i tavoli tondi, lungo i lati per gli altri. */
function posizioniSedie(t) {
  const n = t.posti_max;
  if (t.forma === "tondo") {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: 50 + Math.cos(a) * 50, y: 50 + Math.sin(a) * 50, fuori: [Math.cos(a), Math.sin(a)] };
    });
  }
  const lati = [
    { lung: t.larghezza, punto: (f) => ({ x: f * 100, y: 0, fuori: [0, -1] }) },
    { lung: t.larghezza, punto: (f) => ({ x: f * 100, y: 100, fuori: [0, 1] }) },
    { lung: t.altezza, punto: (f) => ({ x: 0, y: f * 100, fuori: [-1, 0] }) },
    { lung: t.altezza, punto: (f) => ({ x: 100, y: f * 100, fuori: [1, 0] }) },
  ];
  const perimetro = lati.reduce((s, l) => s + l.lung, 0);
  const quote = lati.map((l) => Math.floor((n * l.lung) / perimetro));
  let resto = n - quote.reduce((s, q) => s + q, 0);
  const ordine = [0, 1, 2, 3].sort((a, b) => lati[b].lung - lati[a].lung || a - b);
  for (let i = 0; resto > 0; i = (i + 1) % 4, resto -= 1) quote[ordine[i]] += 1;
  return lati.flatMap((l, i) => Array.from({ length: quote[i] }, (_, k) => l.punto((k + 0.5) / quote[i])));
}

export function creaPianta(sala) {
  const pianta = h("div", { class: "pianta", role: "group", "aria-label": `Pianta: ${sala.nome}` });
  pianta.style.aspectRatio = `${sala.larghezza} / ${sala.altezza}`;
  return pianta;
}

export function posiziona(el, t, sala) {
  el.style.left = `${(t.x / sala.larghezza) * 100}%`;
  el.style.top = `${(t.y / sala.altezza) * 100}%`;
  el.style.width = `${(t.larghezza / sala.larghezza) * 100}%`;
  el.style.height = `${(t.altezza / sala.altezza) * 100}%`;
}

/**
 * Disegna un tavolo come pulsante. `info` contiene testo e stato da mostrare:
 * { stato, titolo, dettaglio, etichetta, selezionato }.
 */
export function creaTavolo(t, sala, info = {}) {
  const el = h("button", {
    type: "button",
    class: `tavolo forma-${t.forma} stato-${info.stato ?? "libero"}${info.selezionato ? " selezionato" : ""}`,
    "aria-label": info.etichetta ?? `Tavolo ${t.nome}`,
    "aria-pressed": info.selezionato ? "true" : "false",
    dataset: { id: t.id },
  });
  posiziona(el, t, sala);
  for (const s of posizioniSedie(t)) {
    const sedia = h("span", { class: "sedia", "aria-hidden": "true" });
    sedia.style.left = `calc(${s.x}% + ${s.fuori[0] * 9}px)`;
    sedia.style.top = `calc(${s.y}% + ${s.fuori[1] * 9}px)`;
    el.append(sedia);
  }
  el.append(
    h(
      "span",
      { class: "piano", "aria-hidden": "true" },
      h("span", { class: "nome-tavolo" }, t.nome),
      info.titolo ? h("span", { class: "titolo-tavolo" }, info.titolo) : null,
      h("span", { class: "dettaglio-tavolo" }, info.dettaglio ?? `${t.posti_min}-${t.posti_max} posti`),
    ),
  );
  return el;
}
