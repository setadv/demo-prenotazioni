import { fidelityCliente } from "./fidelity.js";
import { LINGUE } from "./lingue.js";
import { ErroreRichiesta, SQL_ATTIVI, json, leggiJson, oraRoma, spostaData, testo } from "./util.js";

export const SEGMENTI = ["tutti", "abituali", "vip", "nuovi", "riconquistare", "assenze", "compleanno", "marketing", "fidelity"];

/** Riepilogo per cliente, calcolato dalle prenotazioni: base comune di elenco, conteggi ed esportazione. */
const RIEPILOGO = `
  SELECT c.id, c.nome, c.telefono, c.email, c.note, c.etichette, c.compleanno, c.marketing, c.marketing_il, c.lingua, c.creato_il,
    c.fidelity, (SELECT COALESCE(SUM(m.punti), 0) FROM punti_movimenti m WHERE m.cliente_id = c.id) AS punti,
    COUNT(p.id) AS prenotazioni,
    COALESCE(SUM(p.stato = 'arrivata'), 0) AS visite,
    COALESCE(SUM(p.stato = 'no_show'), 0) AS no_show,
    COALESCE(SUM(CASE WHEN p.stato = 'arrivata' THEN p.persone END), 0) AS coperti,
    MAX(CASE WHEN p.stato = 'arrivata' THEN p.data END) AS ultima_visita,
    MIN(CASE WHEN p.stato IN ${SQL_ATTIVI} AND p.data >= :oggi THEN p.data END) AS prossima
  FROM clienti c LEFT JOIN prenotazioni_v2 p ON p.cliente_id = c.id
  GROUP BY c.id`;

/** Condizione SQL di ogni segmento, applicata al riepilogo (alias r). */
const CONDIZIONI = {
  tutti: "1",
  abituali: "r.visite >= 2",
  vip: "(',' || r.etichette || ',') LIKE '%,VIP,%'",
  nuovi: "r.creato_il >= :trenta_giorni",
  riconquistare: "r.ultima_visita < :novanta_giorni AND r.prossima IS NULL",
  assenze: "r.no_show >= 1",
  compleanno: "r.compleanno LIKE :mese",
  marketing: "r.marketing = 1",
  fidelity: "r.fidelity = 1",
};

function parametri(url) {
  const oggi = oraRoma().data;
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const segmento = SEGMENTI.includes(url.searchParams.get("segmento")) ? url.searchParams.get("segmento") : "tutti";
  return {
    segmento,
    valori: {
      oggi,
      trenta_giorni: `${spostaData(oggi, -30)}T00:00:00`,
      novanta_giorni: spostaData(oggi, -90),
      mese: `${oggi.slice(5, 7)}-%`,
      q: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    },
  };
}

const RICERCA = "(:q = '%%' OR r.nome LIKE :q ESCAPE '\\' OR r.telefono LIKE :q ESCAPE '\\' OR r.email LIKE :q ESCAPE '\\' OR r.etichette LIKE :q ESCAPE '\\')";

/** D1 accetta solo parametri posizionali: i nomi :xxx diventano ?N, nello stesso ordine per tutta la query. */
function prepara(env, sql, valori) {
  const nomi = [];
  const testoSql = sql.replace(/:(\w+)/g, (_, nome) => {
    if (!nomi.includes(nome)) nomi.push(nome);
    return `?${nomi.indexOf(nome) + 1}`;
  });
  return env.DB.prepare(testoSql).bind(...nomi.map((n) => valori[n]));
}

const pulisciCliente = (c) => ({
  ...c,
  etichette: c.etichette ? c.etichette.split(",") : [],
  marketing: Boolean(c.marketing),
  fidelity: Boolean(c.fidelity),
});

export async function elencoClienti(url, env) {
  const { segmento, valori } = parametri(url);
  const conteggi = SEGMENTI.map((s) => `SUM(${CONDIZIONI[s]}) AS ${s}`).join(", ");
  const [elenco, totali] = await env.DB.batch([
    prepara(
      env,
      `WITH r AS (${RIEPILOGO}) SELECT * FROM r WHERE ${CONDIZIONI[segmento]} AND ${RICERCA}
       ORDER BY COALESCE(r.prossima, r.ultima_visita, r.creato_il) DESC LIMIT 200`,
      valori,
    ),
    prepara(env, `WITH r AS (${RIEPILOGO}) SELECT ${conteggi} FROM r`, valori),
  ]);
  const conteggiSegmenti = Object.fromEntries(SEGMENTI.map((s) => [s, totali.results[0]?.[s] ?? 0]));
  return json({ segmento, clienti: elenco.results.map(pulisciCliente), conteggi: conteggiSegmenti });
}

export async function dettaglioCliente(env, id) {
  const [cliente, storico] = await env.DB.batch([
    prepara(env, `WITH r AS (${RIEPILOGO}) SELECT * FROM r WHERE r.id = :id`, { id, oggi: oraRoma().data }),
    env.DB.prepare(
      `SELECT p.id, p.data, p.ora, p.persone, p.stato, p.origine, p.occasione, p.note, t.nome AS tavolo
       FROM prenotazioni_v2 p LEFT JOIN tavoli t ON t.id = p.tavolo_id
       WHERE p.cliente_id = ? ORDER BY p.data DESC, p.inizio_min DESC LIMIT 30`,
    ).bind(id),
  ]);
  if (!cliente.results.length) throw new ErroreRichiesta("Cliente non trovato.", 404);
  return json({ cliente: pulisciCliente(cliente.results[0]), storico: storico.results, fidelity: await fidelityCliente(env, id) });
}

function compleannoValido(valore) {
  if (valore == null || valore === "") return null;
  const m = /^(\d{2})-(\d{2})$/.exec(valore);
  if (!m) throw new ErroreRichiesta("Compleanno non valido: usa mese e giorno.");
  const giorniMese = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const mese = Number(m[1]);
  const giorno = Number(m[2]);
  if (mese < 1 || mese > 12 || giorno < 1 || giorno > giorniMese[mese - 1]) throw new ErroreRichiesta("Compleanno non valido.");
  return valore;
}

/** Aggiorna solo i campi inviati: note, etichette, compleanno, consenso promozionale e lingua. */
export async function modificaCliente(request, env, id) {
  const corpo = await leggiJson(request);
  const attuale = await env.DB.prepare("SELECT marketing, fidelity FROM clienti WHERE id = ?").bind(id).first();
  if (!attuale) throw new ErroreRichiesta("Cliente non trovato.", 404);
  const campi = [];
  const valori = [];
  if ("note" in corpo) {
    campi.push("note = ?");
    valori.push(testo(corpo.note, 500, { campo: "Le note" }));
  }
  if ("etichette" in corpo) {
    if (!Array.isArray(corpo.etichette) || corpo.etichette.length > 12) throw new ErroreRichiesta("Puoi usare al massimo 12 etichette.");
    const etichette = [
      ...new Set(corpo.etichette.map((e) => testo(String(e).replaceAll(",", " "), 24, { min: 1, campo: "L'etichetta" }))),
    ];
    campi.push("etichette = ?");
    valori.push(etichette.join(","));
  }
  if ("compleanno" in corpo) {
    campi.push("compleanno = ?");
    valori.push(compleannoValido(corpo.compleanno));
  }
  if ("marketing" in corpo) {
    // La data del consenso resta quella del primo sì; un no la cancella.
    if (corpo.marketing !== true) campi.push("marketing = 0", "marketing_il = NULL");
    else if (attuale.marketing) campi.push("marketing = 1");
    else {
      campi.push("marketing = 1", "marketing_il = ?");
      valori.push(new Date().toISOString());
    }
  }
  if ("fidelity" in corpo) {
    if (corpo.fidelity !== true) campi.push("fidelity = 0");
    else if (!attuale.fidelity) {
      campi.push("fidelity = 1", "fidelity_il = ?");
      valori.push(new Date().toISOString());
    }
  }
  if ("lingua" in corpo) {
    if (!LINGUE.includes(corpo.lingua)) throw new ErroreRichiesta("Lingua non valida.");
    campi.push("lingua = ?");
    valori.push(corpo.lingua);
  }
  if (!campi.length) throw new ErroreRichiesta("Nessuna modifica da salvare.");
  await env.DB.prepare(`UPDATE clienti SET ${campi.join(", ")} WHERE id = ?`).bind(...valori, id).run();
  return dettaglioCliente(env, id);
}

/** Celle CSV sicure anche se aperte in Excel: niente formule eseguite dai testi dei clienti. */
function cella(valore) {
  let t = valore == null ? "" : String(valore);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

export async function esportaClienti(url, env) {
  const { segmento, valori } = parametri(url);
  const { results } = await prepara(
    env,
    `WITH r AS (${RIEPILOGO}) SELECT * FROM r WHERE ${CONDIZIONI[segmento]} AND ${RICERCA} ORDER BY r.nome LIMIT 10000`,
    valori,
  ).all();
  const intestazione = [
    "Nome",
    "Telefono",
    "Email",
    "Visite",
    "Prenotazioni",
    "Assenze",
    "Ultima visita",
    "Prossima prenotazione",
    "Compleanno",
    "Etichette",
    "Consenso promozioni",
    "Data consenso",
    "Lingua",
    "Raccolta punti",
    "Punti",
    "Note",
  ];
  const righe = results.map((c) =>
    [
      c.nome,
      c.telefono,
      c.email,
      c.visite,
      c.prenotazioni,
      c.no_show,
      c.ultima_visita,
      c.prossima,
      c.compleanno,
      (c.etichette ?? "").replaceAll(",", ", "),
      c.marketing ? "sì" : "no",
      c.marketing_il?.slice(0, 10),
      c.lingua,
      c.fidelity ? "sì" : "no",
      c.punti,
      c.note,
    ]
      .map(cella)
      .join(";"),
  );
  // Separatore punto e virgola e BOM: Excel in italiano apre il file con colonne e accenti corretti.
  return new Response(`﻿${[intestazione.join(";"), ...righe].join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clienti-${segmento}-${oraRoma().data}.csv"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
