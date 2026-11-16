import { applicaTesti, euro, lingua, quandoCambia, selettoreLingua, t, testoData, tradotto } from "./lingue.js";

const $ = (id) => document.getElementById(id);
const modulo = $("modulo");
const stato = { info: null, menu: null, tipo: "asporto", carrello: new Map(), fasce: [], fatto: null };
const NOMI_CANALE = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };

function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo != null) el.textContent = testo;
  return el;
}

const piatti = () => (stato.menu?.categorie ?? []).flatMap((c) => c.piatti).filter((p) => p.asporto && p.prezzo != null);
const perId = (id) => piatti().find((p) => p.id === id);

function conti() {
  const subtotale = [...stato.carrello].reduce((s, [id, q]) => s + (perId(id)?.prezzo ?? 0) * q, 0);
  const i = stato.info;
  let spese = 0;
  if (stato.tipo === "consegna") spese = i.consegna_gratis_da > 0 && subtotale >= i.consegna_gratis_da ? 0 : i.consegna_costo;
  const sottoMinimo = stato.tipo === "consegna" && subtotale < i.consegna_minimo;
  return { subtotale, spese, totale: subtotale + spese, sottoMinimo };
}

async function carica() {
  const [info, menu] = await Promise.all([fetch("/api/ordini/info").then((r) => r.json()), fetch("/api/menu").then((r) => r.json())]);
  stato.info = info;
  stato.menu = menu;
  if (!info.asporto) stato.tipo = "consegna";
  $("nome-ristorante").textContent = info.ristorante.nome;
  if (!info.attivi) {
    $("stato").textContent = t("ordini_chiusi", { telefono: info.ristorante.telefono });
    return;
  }
  if (!piatti().length) {
    $("stato").textContent = t("nessun_piatto");
    return;
  }
  $("stato").hidden = true;
  $("contenuto").hidden = false;
  $("riga-fidelity").hidden = !info.fidelity;
  disegnaTutto();
  await caricaFasce();
}

function disegnaTutto() {
  document.title = t("titolo_documento_ordina", { nome: stato.info.ristorante.nome });
  disegnaTipi();
  disegnaPiatti();
  disegnaGiorni();
  disegnaPagamenti();
  aggiorna();
}

function disegnaTipi() {
  const box = $("tipi");
  box.setAttribute("aria-label", t("tipo_domanda"));
  const tipi = ["asporto", "consegna"].filter((x) => stato.info[x]);
  box.replaceChildren(
    ...tipi.map((tipo) => {
      const b = crea("button", "scelta-tipo-pulsante", t(`tipo_${tipo}`));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(stato.tipo === tipo));
      b.addEventListener("click", () => {
        stato.tipo = tipo;
        disegnaTipi();
        disegnaPagamenti();
        aggiorna();
      });
      return b;
    }),
  );
  const i = stato.info;
  const consegna = stato.tipo === "consegna";
  $("info-consegna").hidden = !consegna;
  if (consegna) {
    const valori = { costo: euro(i.consegna_costo), gratis: euro(i.consegna_gratis_da), minimo: euro(i.consegna_minimo) };
    const zone = i.cap.length ? ` ${t("zone_consegna", { cap: i.cap.join(", ") })}` : "";
    $("info-consegna").textContent = t(i.consegna_gratis_da > 0 ? "info_consegna_gratis" : "info_consegna", valori) + zone;
  }
  $("riga-indirizzo").hidden = !consegna;
  $("riga-cap").hidden = !consegna;
  modulo.indirizzo.required = consegna;
  modulo.cap.required = consegna;
}

function stepper(p) {
  const q = stato.carrello.get(p.id) ?? 0;
  const nome = tradotto(p, "nome");
  const box = crea("div", "stepper");
  const meno = crea("button", "secondario", "−");
  meno.type = "button";
  meno.disabled = !q;
  meno.setAttribute("aria-label", t("togli", { nome }));
  meno.addEventListener("click", () => cambia(p.id, -1));
  const piu = crea("button", "secondario", "+");
  piu.type = "button";
  piu.disabled = !p.disponibile || q >= 20;
  piu.setAttribute("aria-label", t("aggiungi", { nome }));
  piu.addEventListener("click", () => cambia(p.id, 1));
  const n = crea("span", "quantita", String(q));
  n.setAttribute("aria-label", t("nel_carrello", { n: q }));
  box.append(meno, n, piu);
  return box;
}

function cambia(id, delta) {
  const q = Math.max(0, Math.min(20, (stato.carrello.get(id) ?? 0) + delta));
  if (q) stato.carrello.set(id, q);
  else stato.carrello.delete(id);
  disegnaPiatti();
  aggiorna();
  document.querySelector(`[data-piatto="${id}"] .stepper button:last-child`)?.focus();
}

function disegnaPiatti() {
  const sezioni = [];
  for (const c of stato.menu.categorie) {
    const lista = c.piatti.filter((p) => p.asporto && p.prezzo != null);
    if (!lista.length) continue;
    const sezione = crea("section", "categoria-menu");
    sezione.append(crea("h3", "titolo-categoria", tradotto(c, "nome")));
    for (const p of lista) {
      const riga = crea("article", `piatto piatto-ordine${p.disponibile ? "" : " esaurito"}${stato.carrello.has(p.id) ? " scelto" : ""}`);
      riga.dataset.piatto = p.id;
      const testo = crea("div", "testo-piatto");
      testo.append(crea("h4", null, tradotto(p, "nome")));
      const d = tradotto(p, "descrizione");
      if (d) testo.append(crea("p", "desc", d));
      if (!p.disponibile) testo.append(crea("p", "etichetta-esaurito", t("esaurito")));
      riga.append(testo, crea("span", "prezzo", euro(p.prezzo)), stepper(p));
      sezione.append(riga);
    }
    sezioni.push(sezione);
  }
  $("categorie").replaceChildren(...sezioni);
}

function disegnaCarrello(c) {
  const box = $("carrello");
  if (!stato.carrello.size) {
    box.replaceChildren(crea("p", "stato", t("carrello_vuoto")));
    return;
  }
  const lista = crea("ul", "righe-carrello");
  for (const [id, q] of stato.carrello) {
    const p = perId(id);
    if (!p) continue;
    const li = crea("li");
    li.append(crea("span", null, `${q} × ${tradotto(p, "nome")}`), crea("span", null, euro(p.prezzo * q)));
    lista.append(li);
  }
  const totali = crea("dl", "totali-ordine");
  const voce = (nome, valore, classe) => {
    const div = crea("div", classe);
    div.append(crea("dt", null, nome), crea("dd", null, valore));
    totali.append(div);
  };
  voce(t("subtotale"), euro(c.subtotale));
  if (stato.tipo === "consegna") voce(t("spese"), c.spese ? euro(c.spese) : t("gratis"));
  voce(t("totale"), euro(c.totale), "grande");
  box.replaceChildren(lista, totali);
  if (c.sottoMinimo) box.append(crea("p", "messaggio", t("minimo", { minimo: euro(stato.info.consegna_minimo) })));
}

function disegnaGiorni() {
  const sel = $("giorno");
  const scelto = sel.value;
  sel.replaceChildren(
    ...stato.info.giorni.map((d, i) => {
      const o = crea("option", null, testoData(d));
      o.value = d;
      o.selected = d === scelto || (!scelto && i === 0);
      return o;
    }),
  );
}

async function caricaFasce() {
  const data = $("giorno").value;
  if (!data) return;
  const r = await fetch(`/api/ordini/fasce?data=${data}&lingua=${lingua()}`);
  const dati = await r.json();
  stato.fasce = r.ok ? dati.fasce : [];
  const sel = $("ora");
  const prima = sel.value;
  sel.replaceChildren(
    ...stato.fasce.map((f) => {
      const o = crea("option", null, f.ora);
      o.value = f.ora;
      o.selected = f.ora === prima;
      return o;
    }),
  );
  $("nessuna-fascia").hidden = stato.fasce.length > 0;
  aggiorna();
}

function disegnaPagamenti() {
  const p = stato.info.pagamenti;
  const box = $("pagamenti");
  const attuale = new FormData(modulo).get("pagamento");
  const metodi = [];
  if (p.alla_consegna) metodi.push(["alla_consegna", t(stato.tipo === "consegna" ? "paga_consegna" : "paga_ritiro")]);
  if (p.online) metodi.push(["online", t("paga_online")]);
  box.replaceChildren(
    ...metodi.map(([valore, nome], i) => {
      const l = crea("label", "spunta");
      const input = crea("input");
      input.type = "radio";
      input.name = "pagamento";
      input.value = valore;
      input.checked = attuale ? attuale === valore : i === 0;
      input.addEventListener("change", aggiorna);
      l.append(input, ` ${nome}`);
      return l;
    }),
  );
}

function aggiorna() {
  const c = conti();
  disegnaCarrello(c);
  const online = new FormData(modulo).get("pagamento") === "online";
  const invia = $("invia");
  invia.textContent = t(online ? "vai_pagamento" : "invia_ordine", { totale: euro(c.totale) });
  invia.disabled = !stato.carrello.size || c.sottoMinimo || !stato.fasce.length;
  const canale = new FormData(modulo).get("canale");
  modulo.email.required = canale === "email";
  $("etichetta-email").textContent = canale === "email" ? t("email") : t("email_facoltativa");
  $("barra-totale").hidden = !stato.carrello.size || !$("conferma").hidden;
  $("totale-barra").textContent = `${t("totale")} ${euro(c.totale)}`;
}

function mostraErrore(testo) {
  $("messaggio").textContent = testo;
  $("messaggio").hidden = !testo;
}

$("giorno").addEventListener("change", caricaFasce);
modulo.addEventListener("change", (e) => {
  if (e.target.name === "canale") aggiorna();
});

modulo.addEventListener("submit", async (e) => {
  e.preventDefault();
  mostraErrore("");
  if (!modulo.reportValidity()) return;
  const f = new FormData(modulo);
  const invia = $("invia");
  invia.disabled = true;
  invia.textContent = t("invio_ordine");
  try {
    const r = await fetch("/api/ordini", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tipo: stato.tipo,
        data: f.get("data"),
        ora: f.get("ora"),
        righe: [...stato.carrello].map(([id, quantita]) => ({ id, quantita })),
        nome: f.get("nome"),
        telefono: f.get("telefono"),
        email: f.get("email"),
        indirizzo: f.get("indirizzo"),
        cap: f.get("cap"),
        note: f.get("note"),
        canale: f.get("canale"),
        pagamento: f.get("pagamento"),
        privacy: f.get("privacy") === "on",
        fidelity: f.get("fidelity") === "on",
        marketing: f.get("marketing") === "on",
        sito: f.get("sito"),
        lingua: lingua(),
      }),
    });
    const dati = await r.json();
    if (!r.ok) throw new Error(dati.errore);
    if (dati.url_pagamento) {
      location.href = dati.url_pagamento;
      return;
    }
    stato.fatto = { ...dati, canale: f.get("canale") };
    mostraConferma();
  } catch (err) {
    mostraErrore(err.message || t("errore_invio"));
    await caricaFasce();
  }
});

function mostraConferma() {
  const d = stato.fatto;
  if (!d) return;
  modulo.hidden = true;
  $("conferma").hidden = false;
  $("codice").textContent = d.codice;
  $("testo-conferma").textContent = t("ordine_ricevuto_testo", { via: NOMI_CANALE[d.canale] });
  const l = lingua() === "it" ? "" : `&l=${lingua()}`;
  $("link-ordine").href = `/ordine#id=${d.id}&t=${d.token}${l}`;
  $("barra-totale").hidden = true;
  $("conferma").focus();
}

quandoCambia(async () => {
  if (!stato.info) return;
  if (!stato.info.attivi) {
    $("stato").textContent = t("ordini_chiusi", { telefono: stato.info.ristorante.telefono });
    return;
  }
  disegnaTutto();
  if (stato.fatto) mostraConferma();
});

selettoreLingua($("scelta-lingua"));
applicaTesti();
carica().catch(() => {
  $("stato").textContent = t("errore_menu");
});
