-- Momento in cui il cliente è stato segnato come arrivato: da qui parte il conto delle ore per la richiesta di recensione.
-- Migrazione additiva: il codice in produzione non usa ancora la colonna.
ALTER TABLE prenotazioni_v2 ADD COLUMN arrivata_il TEXT;
