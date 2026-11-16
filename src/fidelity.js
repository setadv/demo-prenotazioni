import { linkPubblico } from "./ristoranti.js";
import { dataIn, linguaValida, modelloIn } from "./lingue.js";
import { consegna, testoModello, tokenPer } from "./notifiche.js";
import { ErroreRichiesta, codiceCasuale, json, leggiImpostazioni, oraRoma, spostaData } from "./util.js";

export async function saldoPunti(env, clienteId) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(punti), 0) AS saldo FROM punti_movimenti WHERE cliente_id = ? AND ristorante_id = ?").bind(clienteId, env.RID).first();
  return r.saldo;
}

export async function linkPremio(env, origine, id, lingua = "it") {
  const l = lingua !== "it" ? `&l=${lingua}` : "";
  return linkPubblico(env, "/buono", { origine, frammento: `tipo=premio&id=${id}&t=${await tokenPer(env, "premio", id)}${l}` });
}

/**
 * Accredita punti a un cliente iscritto alla raccolta. Il riferimento (visita:<id>, ordine:<id>)
 * è unico: la stessa visita non dà punti due volte. Al raggiungimento della soglia
 * il premio viene creato e comunicato al cliente in automatico.
 */
export async function accreditaPunti(env, { clienteId, punti, motivo, riferimento, origine, canale }) {
  try {
    const imp = await leggiImpostazioni(env);
    if (!imp.fidelity_attiva || !clienteId || punti <= 0) return;
    const cliente = await env.DB.prepare("SELECT id, nome, telefono, email, lingua, fidelity FROM clienti WHERE id = ? AND ristorante_id = ?").bind(clienteId, env.RID).first();
    if (!cliente?.fidelity) return;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO punti_movimenti (cliente_id, punti, motivo, riferimento, creato_il, ristorante_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(clienteId, punti, motivo, riferimento, new Date().toISOString(), env.RID)
      .run();
    for (let i = 0; i < 5; i += 1) {
      if (!(await emettiPremio(env, imp, cliente, origine, canale))) break;
    }
  } catch (e) {
    console.error("Punti non accreditati", e);
  }
}

/** Toglie i punti di una visita o di un ordine annullati dopo l'accredito. */
export async function stornaPunti(env, riferimento) {
  await env.DB.prepare("DELETE FROM punti_movimenti WHERE riferimento = ? AND ristorante_id = ?").bind(riferimento, env.RID).run();
}

async function valoriPremio(env, imp, premio, lingua, origine) {
  return {
    nome: premio.nome.split(" ")[0],
    soglia: String(imp.premio_soglia),
    ristorante: imp.nome,
    premio: modelloIn(imp, "premio_descrizione", lingua),
    codice: premio.codice,
    scadenza: dataIn(lingua, premio.scade_il),
    link: await linkPremio(env, origine, premio.id, lingua),
  };
}

async function emettiPremio(env, imp, cliente, origine, canale) {
  const id = crypto.randomUUID();
  const adesso = new Date().toISOString();
  // Scalare i punti e controllare il saldo nella stessa istruzione: due accrediti simultanei non creano due premi.
  const scalati = await env.DB.prepare(
    `INSERT INTO punti_movimenti (cliente_id, punti, motivo, riferimento, creato_il, ristorante_id)
     SELECT ?1, -?2, 'Premio', ?3, ?4, ?5
     WHERE (SELECT COALESCE(SUM(punti), 0) FROM punti_movimenti WHERE cliente_id = ?1) >= ?2`,
  )
    .bind(cliente.id, imp.premio_soglia, `premio:${id}`, adesso, env.RID)
    .run();
  if (!scalati.meta.changes) return false;
  const lingua = linguaValida(cliente.lingua);
  const scadenza = spostaData(oraRoma().data, imp.premio_validita_giorni);
  let codice = `PR-${codiceCasuale()}`;
  for (let prova = 0; prova < 3; prova += 1) {
    try {
      await env.DB.prepare(
        "INSERT INTO premi (id, cliente_id, codice, descrizione, punti, stato, creato_il, scade_il, ristorante_id) VALUES (?, ?, ?, ?, ?, 'attivo', ?, ?, ?)",
      )
        .bind(id, cliente.id, codice, imp.premio_descrizione, imp.premio_soglia, adesso, scadenza, env.RID)
        .run();
      break;
    } catch (e) {
      if (!String(e.message).includes("UNIQUE")) throw e;
      codice = `PR-${codiceCasuale()}`;
    }
  }
  if (origine && (cliente.telefono || cliente.email)) {
    const valori = await valoriPremio(env, imp, { id, codice, scade_il: scadenza, nome: cliente.nome }, lingua, origine);
    await consegna(env, imp, {
      rif: id,
      tipo: "premio",
      canale: canale ?? (cliente.email ? "email" : "whatsapp"),
      telefono: cliente.telefono,
      email: cliente.email,
      lingua,
      valori,
      testo: testoModello(imp, "messaggio_premio", lingua, valori),
    });
  }
  return true;
}

/** Riepilogo per il pannello: iscritti, punti in circolo, premi attivi e clienti più fedeli. */
export async function riepilogoFidelity(url, env) {
  const [totali, premi, classifica] = await env.DB.batch([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM clienti WHERE ristorante_id = ?1 AND fidelity = 1) AS iscritti,
              (SELECT COALESCE(SUM(punti), 0) FROM punti_movimenti WHERE ristorante_id = ?1) AS punti,
              (SELECT COUNT(*) FROM premi WHERE ristorante_id = ?1 AND stato = 'usato') AS premi_usati`,
    ).bind(env.RID),
    env.DB.prepare(
      `SELECT p.id, p.codice, p.descrizione, p.stato, p.creato_il, p.scade_il, p.usato_il, c.nome, c.id AS cliente_id,
         c.telefono, c.email, c.lingua,
         (SELECT n.esito || '|' || n.canale FROM notifiche n WHERE n.prenotazione_id = p.id AND n.tipo = 'premio' ORDER BY n.id DESC LIMIT 1) AS notifica
       FROM premi p JOIN clienti c ON c.id = p.cliente_id
       WHERE p.ristorante_id = ? AND p.stato = 'attivo' ORDER BY p.creato_il DESC LIMIT 100`,
    ).bind(env.RID),
    env.DB.prepare(
      `SELECT c.id, c.nome, COALESCE(SUM(m.punti), 0) AS saldo,
              COALESCE(SUM(CASE WHEN m.punti > 0 THEN m.punti END), 0) AS accumulati
       FROM clienti c LEFT JOIN punti_movimenti m ON m.cliente_id = c.id
       WHERE c.ristorante_id = ? AND c.fidelity = 1 GROUP BY c.id ORDER BY accumulati DESC, c.nome LIMIT 20`,
    ).bind(env.RID),
  ]);
  const oggi = oraRoma().data;
  const imp = await leggiImpostazioni(env);
  const attivi = await Promise.all(
    premi.results.map(async (p) => {
      const lingua = linguaValida(p.lingua);
      const [esito, canale] = p.notifica ? p.notifica.split("|") : [];
      return {
        ...p,
        scaduto: p.scade_il < oggi,
        notifica: p.notifica ? { esito, canale } : null,
        messaggio: testoModello(imp, "messaggio_premio", lingua, await valoriPremio(env, imp, p, lingua, url.origin)),
      };
    }),
  );
  return json({
    ...totali.results[0],
    premi_attivi: attivi,
    classifica: classifica.results,
  });
}

/** Il gestore segna il premio come usato al momento di darlo al cliente. */
export async function usaPremio(env, id) {
  const p = await env.DB.prepare("SELECT stato, scade_il FROM premi WHERE id = ? AND ristorante_id = ?").bind(id, env.RID).first();
  if (!p) throw new ErroreRichiesta("Premio non trovato.", 404);
  if (p.stato !== "attivo") throw new ErroreRichiesta("Questo premio è già stato usato o annullato.", 409);
  if (p.scade_il < oraRoma().data) throw new ErroreRichiesta("Questo premio è scaduto.", 409);
  await env.DB.prepare("UPDATE premi SET stato = 'usato', usato_il = ? WHERE id = ? AND ristorante_id = ? AND stato = 'attivo'").bind(new Date().toISOString(), id, env.RID).run();
  return json({ ok: true });
}

/** Movimenti e premi di un cliente, per la sua scheda. */
export async function fidelityCliente(env, clienteId) {
  const [saldo, movimenti, premi] = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(SUM(punti), 0) AS saldo FROM punti_movimenti WHERE cliente_id = ? AND ristorante_id = ?").bind(clienteId, env.RID),
    env.DB.prepare("SELECT punti, motivo, creato_il FROM punti_movimenti WHERE cliente_id = ? AND ristorante_id = ? ORDER BY id DESC LIMIT 20").bind(clienteId, env.RID),
    env.DB.prepare("SELECT id, codice, descrizione, stato, scade_il, usato_il FROM premi WHERE cliente_id = ? AND ristorante_id = ? ORDER BY creato_il DESC LIMIT 20").bind(clienteId, env.RID),
  ]);
  return { saldo: saldo.results[0].saldo, movimenti: movimenti.results, premi: premi.results };
}
