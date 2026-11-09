-- Migrazione additiva: le tabelle della prima versione restano intatte,
-- così la produzione continua a funzionare finché il nuovo codice non è pubblicato.

CREATE TABLE impostazioni (
  chiave TEXT PRIMARY KEY,
  valore TEXT NOT NULL
);

INSERT INTO impostazioni (chiave, valore) VALUES
  ('nome', 'Osteria del Melograno'),
  ('indirizzo', 'Via del Melograno 1, città di prova'),
  ('telefono', '000 000 0000'),
  ('descrizione', 'Cucina di stagione, paste fatte a mano e una piccola cantina di vini del territorio. Ristorante inventato per la demo.'),
  ('prezzo_medio', '35'),
  ('durata', '90'),
  ('intervallo', '15'),
  ('anticipo', '60'),
  ('giorni_prenotabili', '60'),
  ('max_persone_online', '8'),
  ('conferma_automatica', '0');

CREATE TABLE sale (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ordine INTEGER NOT NULL DEFAULT 0,
  larghezza INTEGER NOT NULL DEFAULT 1000,
  altezza INTEGER NOT NULL DEFAULT 600,
  attiva INTEGER NOT NULL DEFAULT 1
);

INSERT INTO sale (id, nome, ordine) VALUES
  ('sala-interna', 'Sala interna', 0),
  ('dehors', 'Dehors', 1);

CREATE TABLE tavoli (
  id TEXT PRIMARY KEY,
  sala_id TEXT NOT NULL REFERENCES sale (id),
  nome TEXT NOT NULL,
  posti_min INTEGER NOT NULL CHECK (posti_min >= 1),
  posti_max INTEGER NOT NULL CHECK (posti_max >= posti_min),
  forma TEXT NOT NULL CHECK (forma IN ('tondo', 'quadrato', 'rettangolo')),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  larghezza INTEGER NOT NULL,
  altezza INTEGER NOT NULL,
  online INTEGER NOT NULL DEFAULT 1,
  attivo INTEGER NOT NULL DEFAULT 1
);

INSERT INTO tavoli (id, sala_id, nome, posti_min, posti_max, forma, x, y, larghezza, altezza, online) VALUES
  ('t1', 'sala-interna', '1', 1, 2, 'quadrato', 80, 80, 90, 90, 1),
  ('t2', 'sala-interna', '2', 1, 2, 'quadrato', 80, 260, 90, 90, 1),
  ('t3', 'sala-interna', '3', 2, 4, 'tondo', 300, 80, 120, 120, 1),
  ('t4', 'sala-interna', '4', 2, 4, 'tondo', 300, 300, 120, 120, 1),
  ('t5', 'sala-interna', '5', 4, 6, 'rettangolo', 540, 90, 220, 100, 1),
  ('t6', 'sala-interna', '6', 4, 6, 'rettangolo', 540, 300, 220, 100, 1),
  ('t7', 'sala-interna', '7', 6, 10, 'rettangolo', 820, 160, 120, 300, 0),
  ('t8', 'sala-interna', '8', 1, 2, 'quadrato', 80, 440, 90, 90, 1),
  ('d1', 'dehors', 'D1', 1, 2, 'tondo', 100, 100, 100, 100, 1),
  ('d2', 'dehors', 'D2', 1, 2, 'tondo', 300, 100, 100, 100, 1),
  ('d3', 'dehors', 'D3', 2, 4, 'quadrato', 520, 90, 120, 120, 1),
  ('d4', 'dehors', 'D4', 4, 8, 'rettangolo', 200, 330, 300, 110, 1);

-- giorno: 0 domenica, 1 lunedì, ... 6 sabato. fine = ultimo orario prenotabile.
CREATE TABLE orari (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giorno INTEGER NOT NULL CHECK (giorno BETWEEN 0 AND 6),
  servizio TEXT NOT NULL,
  inizio TEXT NOT NULL,
  fine TEXT NOT NULL
);

INSERT INTO orari (giorno, servizio, inizio, fine) VALUES
  (2, 'Pranzo', '12:30', '14:00'), (2, 'Cena', '19:30', '22:00'),
  (3, 'Pranzo', '12:30', '14:00'), (3, 'Cena', '19:30', '22:00'),
  (4, 'Pranzo', '12:30', '14:00'), (4, 'Cena', '19:30', '22:00'),
  (5, 'Pranzo', '12:30', '14:00'), (5, 'Cena', '19:30', '22:30'),
  (6, 'Pranzo', '12:30', '14:30'), (6, 'Cena', '19:30', '22:30'),
  (0, 'Pranzo', '12:30', '14:30');

CREATE TABLE chiusure (
  data TEXT PRIMARY KEY,
  motivo TEXT NOT NULL DEFAULT ''
);

CREATE TABLE promozioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giorni TEXT NOT NULL,
  ora_da TEXT NOT NULL,
  ora_a TEXT NOT NULL,
  sconto INTEGER NOT NULL CHECK (sconto BETWEEN 5 AND 50),
  attiva INTEGER NOT NULL DEFAULT 1
);

INSERT INTO promozioni (giorni, ora_da, ora_a, sconto) VALUES
  ('2,3,4', '19:30', '20:00', 20),
  ('2,3,4,5', '12:30', '13:00', 10);

CREATE TABLE clienti (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  telefono TEXT,
  tel_norm TEXT,
  email TEXT,
  email_norm TEXT,
  note TEXT NOT NULL DEFAULT '',
  creato_il TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_clienti_tel ON clienti (tel_norm) WHERE tel_norm IS NOT NULL;
CREATE UNIQUE INDEX idx_clienti_email ON clienti (email_norm) WHERE email_norm IS NOT NULL;

CREATE TABLE prenotazioni_v2 (
  id TEXT PRIMARY KEY,
  codice TEXT NOT NULL UNIQUE,
  token_hash TEXT,
  data TEXT NOT NULL,
  ora TEXT NOT NULL,
  inizio_min INTEGER NOT NULL,
  durata INTEGER NOT NULL,
  persone INTEGER NOT NULL CHECK (persone BETWEEN 1 AND 50),
  nome TEXT NOT NULL,
  telefono TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  occasione TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  note_interne TEXT NOT NULL DEFAULT '',
  stato TEXT NOT NULL CHECK (stato IN ('in_attesa', 'confermata', 'arrivata', 'no_show', 'annullata')),
  origine TEXT NOT NULL CHECK (origine IN ('online', 'telefono', 'walk_in')),
  tavolo_id TEXT REFERENCES tavoli (id),
  cliente_id TEXT REFERENCES clienti (id),
  sconto INTEGER NOT NULL DEFAULT 0,
  creata_il TEXT NOT NULL,
  aggiornata_il TEXT NOT NULL
);

CREATE INDEX idx_pv2_giorno ON prenotazioni_v2 (data, stato);
CREATE INDEX idx_pv2_tavolo ON prenotazioni_v2 (tavolo_id, data);
CREATE INDEX idx_pv2_cliente ON prenotazioni_v2 (cliente_id);

-- Le prenotazioni della prima versione passano nella nuova tabella senza tavolo:
-- il gestore le vede in agenda e può assegnarle a mano.
INSERT INTO prenotazioni_v2 (id, codice, data, ora, inizio_min, durata, persone, nome, telefono, note, stato, origine, creata_il, aggiornata_il)
SELECT id, upper(substr(replace(id, '-', ''), 1, 8)), data, ora,
       CAST(substr(ora, 1, 2) AS INTEGER) * 60 + CAST(substr(ora, 4, 2) AS INTEGER),
       90, persone, nome, contatto, note, stato, 'online', creata_il, creata_il
FROM prenotazioni;
