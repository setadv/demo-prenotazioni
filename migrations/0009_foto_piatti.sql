-- Migrazione additiva: foto facoltativa di ogni piatto del menù, salvata nel database come logo e foto del locale.
-- Tabella a parte: il menù si salva cancellando e reinserendo i piatti, e le foto non devono sparire a ogni modifica.
CREATE TABLE menu_foto (
  ristorante_id TEXT NOT NULL,
  piatto_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  dati BLOB NOT NULL,
  aggiornato_il TEXT NOT NULL,
  PRIMARY KEY (ristorante_id, piatto_id)
);
