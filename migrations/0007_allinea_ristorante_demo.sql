-- Si applica insieme al codice multi-ristorante, quando il ramo entra in produzione.
-- Fino a quel momento il sito in produzione ha continuato a scrivere impostazioni, immagini e chiusure
-- nelle tabelle vecchie: qui le ricopiamo nelle tabelle per ristorante, così non si perde nessuna modifica.
INSERT INTO impostazioni_r (ristorante_id, chiave, valore)
SELECT 'demo', chiave, valore FROM impostazioni WHERE true
ON CONFLICT (ristorante_id, chiave) DO UPDATE SET valore = excluded.valore;

DELETE FROM media_r WHERE ristorante_id = 'demo';
INSERT INTO media_r (ristorante_id, chiave, tipo, dati, aggiornato_il) SELECT 'demo', chiave, tipo, dati, aggiornato_il FROM media;

DELETE FROM chiusure_r WHERE ristorante_id = 'demo';
INSERT INTO chiusure_r (ristorante_id, data, motivo) SELECT 'demo', data, motivo FROM chiusure;
