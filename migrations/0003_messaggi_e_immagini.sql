-- Migrazione additiva: nuove tabelle e una colonna con valore predefinito.

-- Logo e foto del locale, salvati nel database: non serve un bucket R2.
CREATE TABLE media (
  chiave TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  dati BLOB NOT NULL,
  aggiornato_il TEXT NOT NULL
);

-- Canale scelto dal cliente per ricevere la conferma.
ALTER TABLE prenotazioni_v2 ADD COLUMN canale TEXT NOT NULL DEFAULT 'email';

-- Registro dei messaggi di conferma: automatici o inviati a mano dal gestore.
CREATE TABLE notifiche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prenotazione_id TEXT NOT NULL,
  canale TEXT NOT NULL,
  esito TEXT NOT NULL CHECK (esito IN ('inviata', 'errore', 'da_inviare', 'manuale')),
  dettaglio TEXT NOT NULL DEFAULT '',
  creata_il TEXT NOT NULL
);

CREATE INDEX idx_notifiche_prenotazione ON notifiche (prenotazione_id, id);

INSERT OR IGNORE INTO impostazioni (chiave, valore) VALUES
  ('messaggio_conferma', 'Ciao {nome}, la tua prenotazione da {ristorante} per {persone} {data} alle {ora} è confermata. Codice {codice}. Per vederla o annullarla: {link}');

-- Prenotazioni aperte fino a sei mesi.
UPDATE impostazioni SET valore = '183' WHERE chiave = 'giorni_prenotabili' AND CAST(valore AS INTEGER) < 183;
