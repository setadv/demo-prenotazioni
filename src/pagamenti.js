import { hmac, uguali } from "./util.js";

/** Pagamenti online con Stripe Checkout: attivi solo se sono impostati i secret. */
export const stripeAttivo = (env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

const LINGUE_STRIPE = { it: "it", en: "en", de: "de", fr: "fr", es: "es" };

/**
 * Crea una sessione di pagamento e restituisce l'indirizzo della pagina Stripe.
 * `metadati.tipo` e `metadati.id` tornano nel webhook e dicono cosa è stato pagato.
 */
export async function creaPagamento(env, { descrizione, importo, email, lingua, successo, annullato, metadati }) {
  const campi = new URLSearchParams({
    mode: "payment",
    success_url: successo,
    cancel_url: annullato,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(importo),
    "line_items[0][price_data][product_data][name]": descrizione.slice(0, 120),
    locale: LINGUE_STRIPE[lingua] ?? "auto",
    // La sessione scade dopo 30 minuti: l'orario o il buono non restano bloccati a lungo.
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
  });
  if (email) campi.set("customer_email", email);
  for (const [k, v] of Object.entries(metadati)) campi.set(`metadata[${k}]`, String(v));
  const r = await fetch(`${env.STRIPE_ENDPOINT ?? "https://api.stripe.com"}/v1/checkout/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: campi,
  });
  const dati = await r.json().catch(() => ({}));
  if (!r.ok || !dati.url) throw new Error(`Pagamento non creato (${r.status}): ${dati.error?.message ?? ""}`.slice(0, 200));
  return { id: dati.id, url: dati.url };
}

const esadecimale = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Legge un evento del webhook Stripe dopo aver verificato la firma (header Stripe-Signature).
 * Restituisce null se la firma non è valida o è più vecchia di 5 minuti.
 */
export async function eventoStripe(request, env) {
  const corpo = await request.text();
  const intestazione = request.headers.get("stripe-signature") ?? "";
  const parti = Object.fromEntries(intestazione.split(",").map((p) => p.split("=")).filter((p) => p.length === 2));
  const momento = Number(parti.t);
  if (!momento || Math.abs(Date.now() / 1000 - momento) > 300 || !parti.v1) return null;
  const attesa = esadecimale(await hmac(env.STRIPE_WEBHOOK_SECRET, `${parti.t}.${corpo}`));
  const firme = intestazione.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!firme.some((f) => uguali(f, attesa))) return null;
  try {
    return JSON.parse(corpo);
  } catch {
    return null;
  }
}
