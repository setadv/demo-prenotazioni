-- Migrazione additiva: l'app diventa una piattaforma con più ristoranti.
-- Ogni dato porta l'id del ristorante; i dati esistenti appartengono al ristorante 'demo'.
-- Il codice già in produzione continua a funzionare: le colonne nuove hanno un valore predefinito
-- e le tabelle che servivano una chiave diversa (impostazioni, media, chiusure) sono copiate, non toccate.

CREATE TABLE ristoranti (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  stato TEXT NOT NULL CHECK (stato IN ('prova', 'attivo', 'sospeso', 'disattivato')),
  piano TEXT NOT NULL DEFAULT 'base',
  moduli TEXT NOT NULL DEFAULT '',
  prova_fino TEXT,
  pagato_fino TEXT,
  prezzo_mensile INTEGER NOT NULL DEFAULT 0,
  motivo_sospensione TEXT NOT NULL DEFAULT '',
  ragione_sociale TEXT NOT NULL DEFAULT '',
  partita_iva TEXT NOT NULL DEFAULT '',
  codice_destinatario TEXT NOT NULL DEFAULT '',
  pec TEXT NOT NULL DEFAULT '',
  indirizzo_fatturazione TEXT NOT NULL DEFAULT '',
  contatto_nome TEXT NOT NULL DEFAULT '',
  contatto_email TEXT NOT NULL DEFAULT '',
  contatto_telefono TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- Chiavi di Stripe e WhatsApp del ristorante, cifrate con AES-GCM.
  integrazioni TEXT NOT NULL DEFAULT '',
  creato_il TEXT NOT NULL,
  aggiornato_il TEXT NOT NULL
);

INSERT INTO ristoranti (id, slug, nome, stato, piano, moduli, prezzo_mensile, note, creato_il, aggiornato_il)
SELECT 'demo', 'melograno', COALESCE((SELECT valore FROM impostazioni WHERE chiave = 'nome'), 'Osteria del Melograno'),
  'attivo', 'completo', 'whatsapp,fidelity,gift,sondaggi,ordini', 0, 'Ristorante inventato per la demo.', datetime('now'), datetime('now');

CREATE TABLE utenti (
  id TEXT PRIMARY KEY,
  ristorante_id TEXT REFERENCES ristoranti (id),
  email TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '',
  ruolo TEXT NOT NULL CHECK (ruolo IN ('superadmin', 'titolare', 'staff', 'lettura')),
  password_hash TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  creato_il TEXT NOT NULL,
  ultimo_accesso TEXT
);
CREATE UNIQUE INDEX idx_utenti_email ON utenti (email);
CREATE INDEX idx_utenti_ristorante ON utenti (ristorante_id);

-- Link per attivare l'account (invito) o reimpostare la password: si salva solo l'impronta del token.
CREATE TABLE token_accesso (
  id TEXT PRIMARY KEY,
  utente_id TEXT NOT NULL REFERENCES utenti (id),
  tipo TEXT NOT NULL CHECK (tipo IN ('invito', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  scade_il TEXT NOT NULL,
  usato_il TEXT,
  creato_il TEXT NOT NULL
);

CREATE TABLE registro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ristorante_id TEXT,
  autore TEXT NOT NULL,
  azione TEXT NOT NULL,
  dettaglio TEXT NOT NULL DEFAULT '',
  creato_il TEXT NOT NULL
);
CREATE INDEX idx_registro ON registro (ristorante_id, creato_il);

-- Tabelle con chiave per ristorante.
CREATE TABLE impostazioni_r (
  ristorante_id TEXT NOT NULL,
  chiave TEXT NOT NULL,
  valore TEXT NOT NULL,
  PRIMARY KEY (ristorante_id, chiave)
);
INSERT INTO impostazioni_r (ristorante_id, chiave, valore) SELECT 'demo', chiave, valore FROM impostazioni;

CREATE TABLE media_r (
  ristorante_id TEXT NOT NULL,
  chiave TEXT NOT NULL,
  tipo TEXT NOT NULL,
  dati BLOB NOT NULL,
  aggiornato_il TEXT NOT NULL,
  PRIMARY KEY (ristorante_id, chiave)
);
INSERT INTO media_r (ristorante_id, chiave, tipo, dati, aggiornato_il) SELECT 'demo', chiave, tipo, dati, aggiornato_il FROM media;

CREATE TABLE chiusure_r (
  ristorante_id TEXT NOT NULL,
  data TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (ristorante_id, data)
);
INSERT INTO chiusure_r (ristorante_id, data, motivo) SELECT 'demo', data, motivo FROM chiusure;

-- Id del ristorante sulle tabelle che restano.
ALTER TABLE sale ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE tavoli ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE orari ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE promozioni ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE clienti ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE prenotazioni_v2 ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE notifiche ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE menu_categorie ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE menu_piatti ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE whatsapp_messaggi ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE punti_movimenti ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE premi ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE gift_card ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE sondaggi ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE ordini ADD COLUMN ristorante_id TEXT NOT NULL DEFAULT 'demo';

CREATE INDEX idx_sale_r ON sale (ristorante_id);
CREATE INDEX idx_tavoli_r ON tavoli (ristorante_id);
CREATE INDEX idx_orari_r ON orari (ristorante_id, giorno);
CREATE INDEX idx_promozioni_r ON promozioni (ristorante_id);
CREATE INDEX idx_pv2_r ON prenotazioni_v2 (ristorante_id, data, stato);
CREATE INDEX idx_notifiche_r ON notifiche (ristorante_id, creata_il);
CREATE INDEX idx_menu_cat_r ON menu_categorie (ristorante_id, ordine);
CREATE INDEX idx_menu_piatti_r ON menu_piatti (ristorante_id, categoria_id, ordine);
CREATE INDEX idx_whatsapp_r ON whatsapp_messaggi (ristorante_id, direzione, creato_il);
CREATE INDEX idx_premi_r ON premi (ristorante_id, stato);
CREATE INDEX idx_gift_r ON gift_card (ristorante_id, stato);
CREATE INDEX idx_sondaggi_r ON sondaggi (ristorante_id, creato_il);
CREATE INDEX idx_ordini_r ON ordini (ristorante_id, data, stato);

-- Lo stesso telefono può essere cliente di più ristoranti: l'unicità vale dentro ogni ristorante.
-- Con un solo ristorante ('demo') il vincolo resta identico a prima.
DROP INDEX idx_clienti_tel;
DROP INDEX idx_clienti_email;
CREATE UNIQUE INDEX idx_clienti_r_tel ON clienti (ristorante_id, tel_norm) WHERE tel_norm IS NOT NULL;
CREATE UNIQUE INDEX idx_clienti_r_email ON clienti (ristorante_id, email_norm) WHERE email_norm IS NOT NULL;
