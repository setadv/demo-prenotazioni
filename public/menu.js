import { ALLERGENI, CARATTERISTICHE, applicaTesti, lingua, locale, quandoCambia, selettoreLingua, t, tradotto, voce } from "./lingue.js";

const $ = (id) => document.getElementById(id);
const tavolo = new URLSearchParams(location.search).get("t");
let menu = null;
const esclusi = new Set();

function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo != null) el.textContent = testo;
  return el;
}

function prezzo(centesimi) {
  if (centesimi == null) return "";
  const intero = centesimi % 100 === 0;
  return new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: intero ? 0 : 2,
    maximumFractionDigits: intero ? 0 : 2,
  }).format(centesimi / 100);
}

async function carica() {
  try {
    const r = await fetch(`/api/menu${tavolo ? `?t=${encodeURIComponent(tavolo)}` : ""}`);
    if (!r.ok) throw new Error();
    menu = await r.json();
    if (menu.ristorante.logo) {
      const logo = $("logo");
      logo.addEventListener("load", () => {
        logo.hidden = false;
      });
      logo.src = `/api/media/logo?v=${encodeURIComponent(menu.ristorante.logo)}`;
    }
    disegna();
  } catch {
    $("stato").textContent = t("errore_menu");
  }
}

function disegnaFiltro(presenti) {
  const box = $("scelte-allergeni");
  box.replaceChildren(
    ...Object.keys(ALLERGENI)
      .filter((a) => presenti.has(a))
      .map((a) => {
        const b = crea("button", "chip", voce(ALLERGENI, a));
        b.type = "button";
        b.setAttribute("aria-pressed", String(esclusi.has(a)));
        b.addEventListener("click", () => {
          if (esclusi.has(a)) esclusi.delete(a);
          else esclusi.add(a);
          disegna();
        });
        return b;
      }),
  );
  if (esclusi.size) {
    const tutti = crea("button", "chip", t("nascondi_nessuno"));
    tutti.type = "button";
    tutti.addEventListener("click", () => {
      esclusi.clear();
      disegna();
    });
    box.append(tutti);
  }
  $("filtro").hidden = presenti.size === 0;
}

/** Foto del piatto a schermo intero: si chiude con la X, con Esc o toccando fuori dalla foto. */
function apriFoto(src, nome) {
  const box = $("lightbox");
  $("lightbox-foto").src = src;
  $("lightbox-foto").alt = nome;
  $("lightbox-titolo").textContent = nome;
  box.showModal();
}

$("lightbox-chiudi").addEventListener("click", () => $("lightbox").close());
$("lightbox").addEventListener("click", (e) => {
  if (e.target === e.currentTarget || e.target.id === "lightbox-foto") $("lightbox").close();
});

function schedaPiatto(p) {
  const art = crea("article", `piatto${p.disponibile ? "" : " esaurito"}`);
  // La foto c'è solo se il ristorante l'ha caricata; se non si carica sparisce senza lasciare spazio.
  if (p.foto) {
    const nome = tradotto(p, "nome");
    const src = `/api/menu/foto/${encodeURIComponent(p.id)}?v=${encodeURIComponent(p.foto)}`;
    // La miniatura è un pulsante: con un tocco la foto si apre grande.
    const apri = crea("button", "foto-piatto");
    apri.type = "button";
    apri.setAttribute("aria-label", t("ingrandisci_foto", { nome }));
    const img = crea("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 96;
    img.height = 96;
    img.addEventListener("error", () => {
      apri.remove();
      art.classList.remove("con-foto");
    });
    img.src = src;
    apri.append(img);
    apri.addEventListener("click", () => apriFoto(src, nome));
    art.classList.add("con-foto");
    art.append(apri);
  }
  art.append(crea("h3", null, tradotto(p, "nome")), crea("span", "prezzo", prezzo(p.prezzo)));
  const descrizione = tradotto(p, "descrizione");
  if (descrizione) art.append(crea("p", "desc", descrizione));
  const segni = crea("p", "segni");
  if (!p.disponibile) segni.append(crea("span", "etichetta-esaurito", t("esaurito")));
  for (const tag of p.tag) segni.append(crea("span", `segno ${tag}`, voce(CARATTERISTICHE, tag)));
  if (p.allergeni.length) segni.append(crea("span", "allergeni-piatto", `${t("allergeni")}: ${p.allergeni.map((a) => voce(ALLERGENI, a).toLowerCase()).join(", ")}`));
  if (segni.childNodes.length) art.append(segni);
  return art;
}

function disegna() {
  if (!menu) return;
  const { ristorante } = menu;
  document.title = t("titolo_menu", { nome: ristorante.nome });
  $("nome-ristorante").textContent = ristorante.nome;
  $("sottotitolo").textContent = [t("menu"), ristorante.indirizzo].filter(Boolean).join(" · ");
  $("tavolo").hidden = !menu.tavolo;
  if (menu.tavolo) $("tavolo").textContent = t("tavolo", { nome: menu.tavolo });

  if (!menu.categorie.length) {
    $("stato").textContent = t("menu_vuoto");
    return;
  }
  $("stato").hidden = true;

  const presenti = new Set(menu.categorie.flatMap((c) => c.piatti.flatMap((p) => p.allergeni)));
  disegnaFiltro(presenti);

  let nascosti = 0;
  const sezioni = [];
  for (const c of menu.categorie) {
    const visibili = c.piatti.filter((p) => !p.allergeni.some((a) => esclusi.has(a)));
    nascosti += c.piatti.length - visibili.length;
    if (!visibili.length) continue;
    const sezione = crea("section", "categoria-menu");
    sezione.id = `cat-${c.id}`;
    sezione.append(crea("h2", null, tradotto(c, "nome")), ...visibili.map(schedaPiatto));
    sezioni.push([c, sezione]);
  }
  $("categorie").replaceChildren(...sezioni.map(([, s]) => s));

  const indice = $("indice");
  const lista = crea("ul");
  for (const [c] of sezioni) {
    const li = crea("li");
    const a = crea("a", null, tradotto(c, "nome"));
    a.href = `#cat-${c.id}`;
    li.append(a);
    lista.append(li);
  }
  indice.replaceChildren(lista);
  indice.hidden = sezioni.length < 2;

  $("nascosti").hidden = !nascosti;
  $("nascosti").textContent = nascosti === 1 ? t("nascosto_uno") : t("nascosti", { n: nascosti });

  const nota = menu.nota?.[lingua()] || menu.nota?.it || "";
  $("nota").hidden = !nota;
  $("nota").textContent = nota;
}

quandoCambia(disegna);
selettoreLingua($("scelta-lingua"));
applicaTesti();
carica();
