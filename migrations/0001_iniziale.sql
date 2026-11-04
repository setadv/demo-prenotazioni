CREATE TABLE fasce (
  ora TEXT PRIMARY KEY,
  servizio TEXT NOT NULL CHECK (servizio IN ('pranzo', 'cena')),
  coperti INTEGER NOT NULL CHECK (coperti > 0)
);

INSERT INTO fasce (ora, servizio, coperti) VALUES
  ('12:30', 'pranzo', 20),
  ('13:30', 'pranzo', 20),
  ('19:30', 'cena', 20),
  ('20:30', 'cena', 20),
  ('21:30', 'cena', 20);

CREATE TABLE prenotazioni (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  ora TEXT NOT NULL REFERENCES fasce (ora),
  persone INTEGER NOT NULL CHECK (persone BETWEEN 1 AND 12),
  nome TEXT NOT NULL,
  contatto TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  stato TEXT NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa', 'confermata', 'annullata')),
  creata_il TEXT NOT NULL
);

CREATE INDEX idx_prenotazioni_giorno ON prenotazioni (data, ora, stato);

CREATE TABLE tentativi (
  chiave TEXT NOT NULL,
  momento INTEGER NOT NULL
);

CREATE INDEX idx_tentativi ON tentativi (chiave, momento);
