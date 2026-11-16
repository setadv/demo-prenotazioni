import { ALTRE_LINGUE } from "./lingue.js";
import { MODELLI_WHATSAPP, PARAMETRI_WHATSAPP, canaliAttivi } from "./notifiche.js";
import { stripeAttivo } from "./pagamenti.js";
import { ErroreRichiesta, intero, json, leggiImpostazioni, leggiJson, testo } from "./util.js";

const NOMI_LINGUE = { en: "inglese", de: "tedesco", fr: "francese", es: "spagnolo" };
const si = (v) => (v ? 1 : 0);

function tradotto(valori, chiave, campo, { max = 600, min = 20, richiesto } = {}) {
  const risultato = {};
  for (const l of ["it", ...ALTRE_LINGUE]) {
    const k = l === "it" ? chiave : `${chiave}_${l}`;
    const nomeLingua = l === "it" ? "in italiano" : `in ${NOMI_LINGUE[l]}`;
    const t = testo(valori[k], max, { min: l === "it" ? min : 0, campo: `${campo} ${nomeLingua}` });
    if (t && richiesto && !t.includes(richiesto)) throw new ErroreRichiesta(`${campo} ${nomeLingua} deve contenere ${richiesto}.`);
    risultato[k] = t;
  }
  return risultato;
}

/** Impostazioni di ogni modulo, validate a parte: ogni vista del pannello salva solo le sue. */
const MODULI = {
  fidelity: (v) => ({
    fidelity_attiva: si(v.fidelity_attiva),
    punti_visita: intero(v.punti_visita, 0, 1000, "Punti per visita"),
    punti_euro: intero(v.punti_euro, 0, 100, "Punti per euro di ordine"),
    premio_soglia: intero(v.premio_soglia, 10, 100000, "Punti per il premio"),
    premio_validita_giorni: intero(v.premio_validita_giorni, 7, 730, "Validità del premio"),
    ...tradotto(v, "premio_descrizione", "Il premio", { max: 120, min: 3 }),
    ...tradotto(v, "messaggio_premio", "Il messaggio del premio", { richiesto: "{link}" }),
  }),
  gift: (v) => {
    const importi = String(v.gift_importi ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => intero(x, 5, 1000, "Importo della gift card"));
    if (!importi.length || importi.length > 8) throw new ErroreRichiesta("Indica da 1 a 8 importi per le gift card, separati da virgola.");
    return {
      gift_attive: si(v.gift_attive),
      gift_importi: [...new Set(importi)].sort((a, b) => a - b).join(","),
      gift_validita_mesi: intero(v.gift_validita_mesi, 1, 60, "Validità della gift card"),
      ...tradotto(v, "messaggio_gift", "Il messaggio della gift card", { richiesto: "{link}" }),
    };
  },
  sondaggio: (v) => ({
    sondaggio_attivo: si(v.sondaggio_attivo),
    ...tradotto(v, "messaggio_sondaggio", "Il messaggio del sondaggio", { richiesto: "{sondaggio}" }),
  }),
  ordini: (v, env) => {
    const cap = String(v.consegna_cap ?? "")
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (cap.some((c) => !/^\d{5}$/.test(c))) throw new ErroreRichiesta("I CAP di consegna devono avere 5 cifre, separati da virgola.");
    const valori = {
      ordini_attivi: si(v.ordini_attivi),
      asporto_attivo: si(v.asporto_attivo),
      consegna_attiva: si(v.consegna_attiva),
      ordini_preparazione: intero(v.ordini_preparazione, 10, 240, "Tempo di preparazione"),
      ordini_max_fascia: intero(v.ordini_max_fascia, 1, 50, "Ordini per fascia"),
      consegna_costo: intero(v.consegna_costo, 0, 5000, "Costo della consegna"),
      consegna_minimo: intero(v.consegna_minimo, 0, 20000, "Ordine minimo"),
      consegna_gratis_da: intero(v.consegna_gratis_da, 0, 100000, "Consegna gratuita da"),
      consegna_cap: [...new Set(cap)].join(","),
      pagamento_alla_consegna: si(v.pagamento_alla_consegna),
      ...tradotto(v, "messaggio_ordine", "Il messaggio dell'ordine", { richiesto: "{link}" }),
    };
    if (valori.ordini_attivi && !valori.pagamento_alla_consegna && !stripeAttivo(env)) {
      throw new ErroreRichiesta("Attiva il pagamento al ritiro o alla consegna, oppure configura Stripe per i pagamenti online.");
    }
    return valori;
  },
};

/** Testi dei modelli WhatsApp da far approvare, ricavati dai messaggi italiani con i parametri numerati. */
function modelliWhatsApp(imp) {
  const chiavi = { conferma: "messaggio_conferma", recensione: "messaggio_recensione", sondaggio: "messaggio_sondaggio", premio: "messaggio_premio", ordine: "messaggio_ordine", gift: "messaggio_gift" };
  return Object.fromEntries(
    Object.entries(chiavi).map(([tipo, chiave]) => {
      let t = String(imp[chiave] ?? "");
      PARAMETRI_WHATSAPP[tipo].forEach((nome, i) => {
        t = t.replaceAll(`{${nome}}`, `{{${i + 1}}}`);
      });
      return [tipo, { secret: MODELLI_WHATSAPP[tipo], testo: t }];
    }),
  );
}

export async function leggiModuli(env) {
  const imp = await leggiImpostazioni(env);
  return json({ impostazioni: imp, stripe: stripeAttivo(env), canali: canaliAttivi(env), modelli_whatsapp: modelliWhatsApp(imp) });
}

export async function salvaModulo(request, env, modulo) {
  const valida = MODULI[modulo];
  if (!valida) throw new ErroreRichiesta("Modulo non trovato.", 404);
  const corpo = await leggiJson(request);
  const valori = valida(corpo.impostazioni ?? {}, env);
  await env.DB.batch(
    Object.entries(valori).map(([k, v]) =>
      env.DB.prepare("INSERT INTO impostazioni (chiave, valore) VALUES (?1, ?2) ON CONFLICT (chiave) DO UPDATE SET valore = ?2").bind(k, String(v)),
    ),
  );
  return leggiModuli(env);
}
