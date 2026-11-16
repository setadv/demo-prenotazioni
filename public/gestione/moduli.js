import { api, avviso, h } from "./comune.js";

const LINGUE = { en: "Inglese", de: "Tedesco", fr: "Francese", es: "Spagnolo" };
const daCentesimi = (c) => (Number(c || 0) / 100).toFixed(2).replace(".", ",");
const aCentesimi = (v) => Math.round(Number(String(v).replace(",", ".").trim() || 0) * 100);

/**
 * Riquadro con le impostazioni di un modulo (fidelity, gift, sondaggio, ordini).
 * Ogni campo: { chiave, tipo: "spunta" | "numero" | "euro" | "testo" | "tradotto", etichetta, aiuto, min, max, righe }.
 * Salva con PUT /api/admin/moduli/<modulo> e chiama onSalvato con le impostazioni aggiornate.
 */
export function impostazioniModulo({ titolo, modulo, impostazioni, campi, aperto = false, onSalvato }) {
  const errore = h("p", { class: "messaggio", role: "alert", hidden: true });
  const form = h("form", { class: "campi" });

  for (const c of campi) {
    const valore = impostazioni[c.chiave];
    if (c.tipo === "spunta") {
      form.append(h("label", { class: "spunta largo" }, h("input", { type: "checkbox", name: c.chiave, checked: Boolean(valore) }), h("span", {}, c.etichetta)));
    } else if (c.tipo === "tradotto") {
      form.append(
        h(
          "label",
          { class: "largo" },
          c.etichetta,
          h("textarea", { name: c.chiave, rows: c.righe ?? 3, maxlength: c.max ?? 600, value: valore ?? "" }),
          c.aiuto ? h("span", { class: "aiuto" }, c.aiuto) : null,
        ),
        h(
          "details",
          { class: "traduzioni largo" },
          h("summary", {}, "Nelle altre lingue"),
          Object.entries(LINGUE).map(([l, nome]) =>
            h("label", {}, nome, h("textarea", { name: `${c.chiave}_${l}`, rows: c.righe ?? 3, maxlength: c.max ?? 600, value: impostazioni[`${c.chiave}_${l}`] ?? "" })),
          ),
        ),
      );
    } else {
      const attributi =
        c.tipo === "numero"
          ? { type: "number", min: c.min, max: c.max, value: valore }
          : c.tipo === "euro"
            ? { inputmode: "decimal", value: daCentesimi(valore) }
            : { value: valore ?? "", maxlength: c.max ?? 200, placeholder: c.placeholder };
      form.append(h("label", { class: c.largo ? "largo" : null }, c.etichetta, h("input", { name: c.chiave, ...attributi }), c.aiuto ? h("span", { class: "aiuto" }, c.aiuto) : null));
    }
  }
  const salva = h("button", { type: "submit", class: "azione compatta" }, "Salva");
  form.append(errore, h("div", { class: "pulsanti-dialogo largo" }, salva));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errore.hidden = true;
    const f = new FormData(form);
    const valori = { ...impostazioni };
    for (const c of campi) {
      if (c.tipo === "spunta") valori[c.chiave] = f.get(c.chiave) === "on";
      else if (c.tipo === "numero") valori[c.chiave] = Number(f.get(c.chiave));
      else if (c.tipo === "euro") valori[c.chiave] = aCentesimi(f.get(c.chiave));
      else valori[c.chiave] = f.get(c.chiave);
      if (c.tipo === "tradotto") for (const l of Object.keys(LINGUE)) valori[`${c.chiave}_${l}`] = f.get(`${c.chiave}_${l}`);
    }
    salva.disabled = true;
    try {
      const r = await api(`/api/admin/moduli/${modulo}`, { metodo: "PUT", corpo: { impostazioni: valori } });
      Object.assign(impostazioni, r.impostazioni);
      avviso(`${titolo}: impostazioni salvate.`);
      onSalvato?.(r);
    } catch (err) {
      errore.textContent = err.message;
      errore.hidden = false;
    } finally {
      salva.disabled = false;
    }
  });

  return h("details", { class: "blocco impostazioni-modulo", open: aperto }, h("summary", {}, h("h2", {}, titolo)), form);
}

/** Pulsanti per mandare a mano un messaggio già pronto, con il canale preferito evidenziato. */
export function pulsantiInvio({ testo, telefono, email, canale, oggetto, onInviato }) {
  const numero = (() => {
    const pulito = String(telefono ?? "").trim();
    let cifre = pulito.replace(/\D/g, "");
    if (pulito.startsWith("+")) return cifre.length >= 8 ? cifre : null;
    if (cifre.startsWith("00")) cifre = cifre.slice(2);
    else if (/^3\d{8,9}$/.test(cifre) || /^0\d{5,10}$/.test(cifre)) cifre = `39${cifre}`;
    return cifre.length >= 10 ? cifre : null;
  })();
  const t = encodeURIComponent(testo);
  const link = [];
  if (numero) {
    link.push(h("a", { class: `invia-link${canale === "whatsapp" ? " preferito" : ""}`, href: `https://wa.me/${numero}?text=${t}`, target: "_blank", rel: "noopener", onclick: () => onInviato?.("whatsapp") }, "WhatsApp"));
    link.push(h("a", { class: `invia-link${canale === "sms" ? " preferito" : ""}`, href: `sms:+${numero}?body=${t}`, onclick: () => onInviato?.("sms") }, "SMS"));
  }
  if (email) {
    link.push(h("a", { class: `invia-link${canale === "email" ? " preferito" : ""}`, href: `mailto:${email}?subject=${encodeURIComponent(oggetto)}&body=${t}`, onclick: () => onInviato?.("email") }, "Email"));
  }
  return link;
}

export { daCentesimi, aCentesimi };
