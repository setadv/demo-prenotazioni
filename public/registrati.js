const $ = (id) => document.getElementById(id);
const euro = (c) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(c / 100);
let piano = new URLSearchParams(location.search).get("piano") || "pro";

function el(tag, classe, testo) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

function link(href, testo) {
  const a = el("a", null, testo);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function disegnaPiani(piani) {
  if (!piani[piano]) piano = "base";
  const box = $("piani");
  box.replaceChildren(
    ...Object.entries(piani).map(([k, p]) => {
      const b = el("button", "piano");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(k === piano));
      b.append(el("span", "nome-piano", p.nome), el("span", "prezzo-piano", `${euro(p.prezzo)} / mese`));
      const lista = el("ul", "funzioni-piano");
      for (const f of ["Prenotazioni, menù e QR, CRM, recensioni", ...p.moduli]) lista.append(el("li", null, f));
      b.append(lista);
      b.addEventListener("click", () => {
        piano = k;
        disegnaPiani(piani);
      });
      return b;
    }),
  );
}

async function avvia() {
  const info = await fetch("/api/registrati").then((r) => r.json());
  if (!info.aperte) {
    $("modulo").hidden = true;
    $("chiuse").hidden = false;
    return;
  }
  document.querySelectorAll(".giorni-prova").forEach((e) => (e.textContent = String(info.giorni_prova)));
  disegnaPiani(info.piani);
  if (info.termini || info.privacy) {
    const t = $("testo-consenso");
    t.replaceChildren("Accetto ");
    if (info.termini) t.append(link(info.termini, "le condizioni del servizio"));
    if (info.termini && info.privacy) t.append(" e ");
    if (info.privacy) t.append(link(info.privacy, "l'informativa privacy"));
    t.append(".");
  }
}

$("modulo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errore = $("errore");
  errore.hidden = true;
  const d = new FormData(e.target);
  const corpo = Object.fromEntries(d);
  corpo.consenso = d.get("consenso") === "on";
  corpo.piano = piano;
  if (!e.target.checkValidity() || !corpo.consenso) {
    errore.textContent = !corpo.consenso ? "Per continuare accetta le condizioni del servizio." : "Completa i campi obbligatori: nome del locale, il tuo nome, email e una password di almeno 10 caratteri.";
    errore.hidden = false;
    return;
  }
  const bottone = $("invia");
  bottone.disabled = true;
  bottone.textContent = "Creo il tuo ristorante…";
  try {
    const r = await fetch("/api/registrati", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const dati = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dati.errore || "Iscrizione non riuscita. Riprova.");
    location.href = "/admin#impostazioni";
  } catch (err) {
    errore.textContent = err.message;
    errore.hidden = false;
    bottone.disabled = false;
    bottone.textContent = "Crea il mio account gratis";
  }
});

avvia().catch(() => {});
