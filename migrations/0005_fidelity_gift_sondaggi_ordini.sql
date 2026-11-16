-- Migrazione additiva: fidelity a punti, gift card, sondaggi dopo la visita, asporto e consegna.

-- Fidelity: ogni movimento di punti ha un riferimento unico (visita, ordine, premio), così non si conta due volte.
ALTER TABLE clienti ADD COLUMN fidelity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clienti ADD COLUMN fidelity_il TEXT;

CREATE TABLE punti_movimenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id TEXT NOT NULL REFERENCES clienti (id),
  punti INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  riferimento TEXT,
  creato_il TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_punti_riferimento ON punti_movimenti (riferimento) WHERE riferimento IS NOT NULL;
CREATE INDEX idx_punti_cliente ON punti_movimenti (cliente_id);

CREATE TABLE premi (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clienti (id),
  codice TEXT NOT NULL UNIQUE,
  descrizione TEXT NOT NULL,
  punti INTEGER NOT NULL,
  stato TEXT NOT NULL DEFAULT 'attivo' CHECK (stato IN ('attivo', 'usato', 'annullato')),
  creato_il TEXT NOT NULL,
  scade_il TEXT NOT NULL,
  usato_il TEXT
);
CREATE INDEX idx_premi_cliente ON premi (cliente_id, stato);

-- Gift card digitali: importi in centesimi, il saldo scende a ogni utilizzo.
CREATE TABLE gift_card (
  id TEXT PRIMARY KEY,
  codice TEXT NOT NULL UNIQUE,
  importo INTEGER NOT NULL CHECK (importo > 0),
  saldo INTEGER NOT NULL CHECK (saldo >= 0),
  acquirente_nome TEXT NOT NULL DEFAULT '',
  acquirente_email TEXT NOT NULL DEFAULT '',
  acquirente_telefono TEXT NOT NULL DEFAULT '',
  destinatario_nome TEXT NOT NULL DEFAULT '',
  destinatario_email TEXT NOT NULL DEFAULT '',
  destinatario_telefono TEXT NOT NULL DEFAULT '',
  messaggio TEXT NOT NULL DEFAULT '',
  lingua TEXT NOT NULL DEFAULT 'it',
  stato TEXT NOT NULL CHECK (stato IN ('in_attesa_pagamento', 'attiva', 'annullata')),
  origine TEXT NOT NULL CHECK (origine IN ('online', 'gestore')),
  pagamento_id TEXT,
  creata_il TEXT NOT NULL,
  attivata_il TEXT,
  scade_il TEXT NOT NULL
);
CREATE INDEX idx_gift_stato ON gift_card (stato, creata_il);

CREATE TABLE gift_card_movimenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_card_id TEXT NOT NULL REFERENCES gift_card (id),
  importo INTEGER NOT NULL,
  nota TEXT NOT NULL DEFAULT '',
  creato_il TEXT NOT NULL
);
CREATE INDEX idx_gift_movimenti ON gift_card_movimenti (gift_card_id);

-- Sondaggio dopo la visita: uno per prenotazione.
CREATE TABLE sondaggi (
  prenotazione_id TEXT PRIMARY KEY,
  cliente_id TEXT,
  voto_cibo INTEGER CHECK (voto_cibo BETWEEN 1 AND 5),
  voto_servizio INTEGER CHECK (voto_servizio BETWEEN 1 AND 5),
  voto_ambiente INTEGER CHECK (voto_ambiente BETWEEN 1 AND 5),
  voto_prezzo INTEGER CHECK (voto_prezzo BETWEEN 1 AND 5),
  consiglio INTEGER CHECK (consiglio BETWEEN 0 AND 10),
  commento TEXT NOT NULL DEFAULT '',
  lingua TEXT NOT NULL DEFAULT 'it',
  creato_il TEXT NOT NULL,
  gestito INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sondaggi_data ON sondaggi (creato_il);

-- Asporto e consegna, ordinati dal sito senza piattaforme intermediarie.
ALTER TABLE menu_piatti ADD COLUMN asporto INTEGER NOT NULL DEFAULT 1;

CREATE TABLE ordini (
  id TEXT PRIMARY KEY,
  codice TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('asporto', 'consegna')),
  data TEXT NOT NULL,
  ora TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefono TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  indirizzo TEXT NOT NULL DEFAULT '',
  cap TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  subtotale INTEGER NOT NULL,
  spese_consegna INTEGER NOT NULL DEFAULT 0,
  totale INTEGER NOT NULL,
  pagamento TEXT NOT NULL CHECK (pagamento IN ('alla_consegna', 'online')),
  pagato INTEGER NOT NULL DEFAULT 0,
  pagamento_id TEXT,
  stato TEXT NOT NULL CHECK (stato IN ('in_attesa_pagamento', 'nuovo', 'in_preparazione', 'pronto', 'in_consegna', 'completato', 'annullato')),
  cliente_id TEXT,
  lingua TEXT NOT NULL DEFAULT 'it',
  canale TEXT NOT NULL DEFAULT 'sms',
  creato_il TEXT NOT NULL,
  aggiornato_il TEXT NOT NULL
);
CREATE INDEX idx_ordini_giorno ON ordini (data, stato);

CREATE TABLE ordini_righe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ordine_id TEXT NOT NULL REFERENCES ordini (id),
  piatto_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  prezzo INTEGER NOT NULL,
  quantita INTEGER NOT NULL CHECK (quantita BETWEEN 1 AND 50)
);
CREATE INDEX idx_righe_ordine ON ordini_righe (ordine_id);

INSERT OR IGNORE INTO impostazioni (chiave, valore) VALUES
  ('fidelity_attiva', '1'),
  ('punti_visita', '10'),
  ('punti_euro', '1'),
  ('premio_soglia', '100'),
  ('premio_descrizione', 'Un dolce o un calice di vino offerto'),
  ('premio_descrizione_en', 'A dessert or a glass of wine on us'),
  ('premio_descrizione_de', 'Ein Dessert oder ein Glas Wein aufs Haus'),
  ('premio_descrizione_fr', 'Un dessert ou un verre de vin offert'),
  ('premio_descrizione_es', 'Un postre o una copa de vino por cuenta de la casa'),
  ('premio_validita_giorni', '90'),
  ('messaggio_premio', 'Ciao {nome}, hai raggiunto {soglia} punti da {ristorante}! Il tuo premio: {premio}. Codice {codice}, valido fino al {scadenza}: {link}'),
  ('messaggio_premio_en', 'Hi {nome}, you reached {soglia} points at {ristorante}! Your reward: {premio}. Code {codice}, valid until {scadenza}: {link}'),
  ('messaggio_premio_de', 'Hallo {nome}, Sie haben {soglia} Punkte im {ristorante} gesammelt! Ihre Prämie: {premio}. Code {codice}, gültig bis {scadenza}: {link}'),
  ('messaggio_premio_fr', 'Bonjour {nome}, vous avez atteint {soglia} points chez {ristorante} ! Votre cadeau : {premio}. Code {codice}, valable jusqu''au {scadenza} : {link}'),
  ('messaggio_premio_es', 'Hola {nome}, ¡has llegado a {soglia} puntos en {ristorante}! Tu premio: {premio}. Código {codice}, válido hasta el {scadenza}: {link}'),
  ('gift_attive', '1'),
  ('gift_importi', '25,50,100'),
  ('gift_validita_mesi', '12'),
  ('messaggio_gift', 'Ciao {destinatario}, {mittente} ti ha regalato una gift card da {importo} da {ristorante}! Codice {codice}, valida fino al {scadenza}: {link}'),
  ('messaggio_gift_en', 'Hi {destinatario}, {mittente} has given you a {importo} gift card for {ristorante}! Code {codice}, valid until {scadenza}: {link}'),
  ('messaggio_gift_de', 'Hallo {destinatario}, {mittente} schenkt Ihnen einen Gutschein über {importo} für das {ristorante}! Code {codice}, gültig bis {scadenza}: {link}'),
  ('messaggio_gift_fr', 'Bonjour {destinatario}, {mittente} vous offre une carte cadeau de {importo} chez {ristorante} ! Code {codice}, valable jusqu''au {scadenza} : {link}'),
  ('messaggio_gift_es', 'Hola {destinatario}, ¡{mittente} te ha regalado una tarjeta regalo de {importo} en {ristorante}! Código {codice}, válida hasta el {scadenza}: {link}'),
  ('sondaggio_attivo', '1'),
  ('messaggio_sondaggio', 'Ciao {nome}, grazie per essere stati da {ristorante}! Ci dici com''è andata? Bastano 30 secondi: {sondaggio}'),
  ('messaggio_sondaggio_en', 'Hi {nome}, thank you for dining at {ristorante}! How was it? It only takes 30 seconds: {sondaggio}'),
  ('messaggio_sondaggio_de', 'Hallo {nome}, vielen Dank für Ihren Besuch im {ristorante}! Wie war es? Es dauert nur 30 Sekunden: {sondaggio}'),
  ('messaggio_sondaggio_fr', 'Bonjour {nome}, merci d''être venus chez {ristorante} ! Comment cela s''est-il passé ? 30 secondes suffisent : {sondaggio}'),
  ('messaggio_sondaggio_es', 'Hola {nome}, ¡gracias por visitar {ristorante}! ¿Qué tal fue? Solo 30 segundos: {sondaggio}'),
  ('ordini_attivi', '1'),
  ('asporto_attivo', '1'),
  ('consegna_attiva', '1'),
  ('ordini_preparazione', '30'),
  ('ordini_max_fascia', '4'),
  ('consegna_costo', '300'),
  ('consegna_minimo', '1500'),
  ('consegna_gratis_da', '4000'),
  ('consegna_cap', ''),
  ('pagamento_alla_consegna', '1'),
  ('messaggio_ordine', 'Ciao {nome}, il tuo ordine {codice} da {ristorante} è confermato: {tipo} {data} alle {ora}. Totale {totale}. Segui l''ordine: {link}'),
  ('messaggio_ordine_en', 'Hi {nome}, your order {codice} from {ristorante} is confirmed: {tipo} {data} at {ora}. Total {totale}. Track your order: {link}'),
  ('messaggio_ordine_de', 'Hallo {nome}, Ihre Bestellung {codice} beim {ristorante} ist bestätigt: {tipo} am {data} um {ora}. Gesamt {totale}. Bestellung verfolgen: {link}'),
  ('messaggio_ordine_fr', 'Bonjour {nome}, votre commande {codice} chez {ristorante} est confirmée : {tipo} le {data} à {ora}. Total {totale}. Suivre la commande : {link}'),
  ('messaggio_ordine_es', 'Hola {nome}, tu pedido {codice} de {ristorante} está confirmado: {tipo} el {data} a las {ora}. Total {totale}. Sigue tu pedido: {link}');
