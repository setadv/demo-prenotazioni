-- Migrazione additiva: nuove tabelle, nuove colonne con valore predefinito e nuove impostazioni.
-- Il codice già in produzione non le usa e continua a funzionare.

-- Menù online, consultabile dal QR code sul tavolo.
CREATE TABLE menu_categorie (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  traduzioni TEXT NOT NULL DEFAULT '{}',
  ordine INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE menu_piatti (
  id TEXT PRIMARY KEY,
  categoria_id TEXT NOT NULL REFERENCES menu_categorie (id),
  nome TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT '',
  -- Prezzo in centesimi; NULL se il piatto non ha un prezzo fisso.
  prezzo INTEGER,
  -- Codici separati da virgola, tra i 14 allergeni del Reg. UE 1169/2011.
  allergeni TEXT NOT NULL DEFAULT '',
  -- vegetariano, vegano, senza_glutine, piccante, novita.
  tag TEXT NOT NULL DEFAULT '',
  traduzioni TEXT NOT NULL DEFAULT '{}',
  disponibile INTEGER NOT NULL DEFAULT 1,
  ordine INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_menu_piatti_categoria ON menu_piatti (categoria_id, ordine);

INSERT INTO menu_categorie (id, nome, traduzioni, ordine) VALUES
  ('antipasti', 'Antipasti', '{"en":{"nome":"Starters"},"de":{"nome":"Vorspeisen"},"fr":{"nome":"Entrées"},"es":{"nome":"Entrantes"}}', 0),
  ('primi', 'Primi', '{"en":{"nome":"Pasta and risotto"},"de":{"nome":"Erste Gänge"},"fr":{"nome":"Pâtes et risottos"},"es":{"nome":"Primeros"}}', 1),
  ('secondi', 'Secondi', '{"en":{"nome":"Mains"},"de":{"nome":"Hauptgerichte"},"fr":{"nome":"Plats"},"es":{"nome":"Segundos"}}', 2),
  ('dolci', 'Dolci', '{"en":{"nome":"Desserts"},"de":{"nome":"Desserts"},"fr":{"nome":"Desserts"},"es":{"nome":"Postres"}}', 3);

INSERT INTO menu_piatti (id, categoria_id, nome, descrizione, prezzo, allergeni, tag, traduzioni, ordine) VALUES
  ('burrata', 'antipasti', 'Burrata, melograno e nocciole', 'Burrata di Andria con chicchi di melograno, nocciole tostate e olio nuovo.', 1200, 'latte,frutta_guscio', 'vegetariano',
   '{"en":{"nome":"Burrata, pomegranate and hazelnuts","descrizione":"Burrata from Andria with pomegranate seeds, toasted hazelnuts and new-season olive oil."},"de":{"nome":"Burrata, Granatapfel und Haselnüsse","descrizione":"Burrata aus Andria mit Granatapfelkernen, gerösteten Haselnüssen und frischem Olivenöl."},"fr":{"nome":"Burrata, grenade et noisettes","descrizione":"Burrata d''Andria, grains de grenade, noisettes torréfiées et huile d''olive nouvelle."},"es":{"nome":"Burrata, granada y avellanas","descrizione":"Burrata de Andria con granos de granada, avellanas tostadas y aceite nuevo."}}', 0),
  ('alici', 'antipasti', 'Alici marinate', 'Alici marinate agli agrumi con finocchio e pane tostato.', 1000, 'pesce,glutine', '',
   '{"en":{"nome":"Marinated anchovies","descrizione":"Citrus-marinated anchovies with fennel and toasted bread."},"de":{"nome":"Marinierte Sardellen","descrizione":"Sardellen in Zitrusmarinade mit Fenchel und geröstetem Brot."},"fr":{"nome":"Anchois marinés","descrizione":"Anchois marinés aux agrumes, fenouil et pain grillé."},"es":{"nome":"Boquerones marinados","descrizione":"Boquerones marinados en cítricos con hinojo y pan tostado."}}', 1),
  ('tagliatelle', 'primi', 'Tagliatelle al ragù bianco', 'Pasta all''uovo tirata a mano, ragù bianco di vitello e pecorino.', 1400, 'glutine,uova,latte,sedano', '',
   '{"en":{"nome":"Tagliatelle with white ragù","descrizione":"Hand-rolled egg pasta, white veal ragù and pecorino."},"de":{"nome":"Tagliatelle mit weißem Ragù","descrizione":"Handgemachte Eiernudeln, weißes Kalbsragù und Pecorino."},"fr":{"nome":"Tagliatelles au ragù blanc","descrizione":"Pâtes aux œufs faites main, ragù blanc de veau et pecorino."},"es":{"nome":"Tagliatelle con ragú blanco","descrizione":"Pasta al huevo hecha a mano, ragú blanco de ternera y pecorino."}}', 0),
  ('risotto', 'primi', 'Risotto alla zucca', 'Zucca arrosto, salvia croccante e amaretto sbriciolato.', 1300, 'latte,frutta_guscio,solfiti', 'vegetariano,senza_glutine',
   '{"en":{"nome":"Pumpkin risotto","descrizione":"Roasted pumpkin, crispy sage and crumbled amaretto."},"de":{"nome":"Kürbisrisotto","descrizione":"Gerösteter Kürbis, knuspriger Salbei und zerbröselte Amaretti."},"fr":{"nome":"Risotto à la courge","descrizione":"Courge rôtie, sauge croustillante et amaretto émietté."},"es":{"nome":"Risotto de calabaza","descrizione":"Calabaza asada, salvia crujiente y amaretto desmenuzado."}}', 1),
  ('guancia', 'secondi', 'Guancia brasata al vino rosso', 'Guancia di manzo cotta otto ore, purè di patate e cipolla in agrodolce.', 1900, 'latte,sedano,solfiti', 'senza_glutine',
   '{"en":{"nome":"Beef cheek braised in red wine","descrizione":"Beef cheek slow-cooked for eight hours, mashed potatoes and sweet-and-sour onion."},"de":{"nome":"In Rotwein geschmorte Rinderbacke","descrizione":"Acht Stunden gegarte Rinderbacke, Kartoffelpüree und süßsaure Zwiebel."},"fr":{"nome":"Joue de bœuf braisée au vin rouge","descrizione":"Joue de bœuf cuite huit heures, purée de pommes de terre et oignon aigre-doux."},"es":{"nome":"Carrillera al vino tinto","descrizione":"Carrillera de ternera cocinada ocho horas, puré de patatas y cebolla agridulce."}}', 0),
  ('verdure', 'secondi', 'Verdure dell''orto alla brace', 'Verdure di stagione alla brace con salsa verde.', 1400, 'senape', 'vegano,senza_glutine',
   '{"en":{"nome":"Grilled garden vegetables","descrizione":"Seasonal vegetables from the grill with salsa verde."},"de":{"nome":"Gegrilltes Gartengemüse","descrizione":"Saisonales Gemüse vom Grill mit grüner Soße."},"fr":{"nome":"Légumes du potager grillés","descrizione":"Légumes de saison grillés, sauce verte."},"es":{"nome":"Verduras de la huerta a la brasa","descrizione":"Verduras de temporada a la brasa con salsa verde."}}', 1),
  ('tiramisu', 'dolci', 'Tiramisù della casa', 'Savoiardi, mascarpone e caffè.', 700, 'glutine,uova,latte', 'vegetariano',
   '{"en":{"nome":"House tiramisù","descrizione":"Ladyfingers, mascarpone and coffee."},"de":{"nome":"Tiramisù des Hauses","descrizione":"Löffelbiskuits, Mascarpone und Kaffee."},"fr":{"nome":"Tiramisù maison","descrizione":"Biscuits à la cuillère, mascarpone et café."},"es":{"nome":"Tiramisú de la casa","descrizione":"Bizcochos, mascarpone y café."}}', 0);

-- Lingua del cliente: messaggi e pagina personale arrivano nella sua lingua.
ALTER TABLE prenotazioni_v2 ADD COLUMN lingua TEXT NOT NULL DEFAULT 'it';

-- CRM: etichette libere, compleanno (MM-GG), consenso alle comunicazioni promozionali, lingua.
ALTER TABLE clienti ADD COLUMN etichette TEXT NOT NULL DEFAULT '';
ALTER TABLE clienti ADD COLUMN compleanno TEXT;
ALTER TABLE clienti ADD COLUMN marketing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clienti ADD COLUMN marketing_il TEXT;
ALTER TABLE clienti ADD COLUMN lingua TEXT NOT NULL DEFAULT 'it';

-- Lo stesso registro tiene conferme e richieste di recensione.
ALTER TABLE notifiche ADD COLUMN tipo TEXT NOT NULL DEFAULT 'conferma';
CREATE INDEX idx_notifiche_tipo ON notifiche (tipo, prenotazione_id);

-- Messaggi WhatsApp inviati e ricevuti tramite l'API Cloud di Meta, con il loro stato di consegna.
CREATE TABLE whatsapp_messaggi (
  id TEXT PRIMARY KEY,
  direzione TEXT NOT NULL CHECK (direzione IN ('in', 'out')),
  numero TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '',
  testo TEXT NOT NULL DEFAULT '',
  stato TEXT NOT NULL DEFAULT '',
  prenotazione_id TEXT,
  creato_il TEXT NOT NULL,
  aggiornato_il TEXT NOT NULL
);

CREATE INDEX idx_whatsapp_data ON whatsapp_messaggi (direzione, creato_il);

INSERT OR IGNORE INTO impostazioni (chiave, valore) VALUES
  ('link_recensioni', ''),
  ('recensioni_automatiche', '1'),
  ('recensione_dopo_ore', '2'),
  ('messaggio_recensione', 'Ciao {nome}, grazie per essere stati da {ristorante}! Se ti va, lasciaci una recensione: ci aiuta molto. {recensione}'),
  ('messaggio_recensione_en', 'Hi {nome}, thank you for dining at {ristorante}! If you have a moment, we would love a review: {recensione}'),
  ('messaggio_recensione_de', 'Hallo {nome}, vielen Dank für Ihren Besuch im {ristorante}! Über eine Bewertung würden wir uns sehr freuen: {recensione}'),
  ('messaggio_recensione_fr', 'Bonjour {nome}, merci d''être venus chez {ristorante} ! Si vous avez un instant, laissez-nous un avis : {recensione}'),
  ('messaggio_recensione_es', 'Hola {nome}, ¡gracias por visitar {ristorante}! Si tienes un momento, nos encantaría tu reseña: {recensione}'),
  ('messaggio_conferma_en', 'Hi {nome}, your table at {ristorante} for {persone} on {data} at {ora} is confirmed. Code {codice}. To view or cancel: {link}'),
  ('messaggio_conferma_de', 'Hallo {nome}, Ihre Reservierung im {ristorante} für {persone} am {data} um {ora} ist bestätigt. Code {codice}. Ansehen oder stornieren: {link}'),
  ('messaggio_conferma_fr', 'Bonjour {nome}, votre réservation chez {ristorante} pour {persone} le {data} à {ora} est confirmée. Code {codice}. Pour la consulter ou l''annuler : {link}'),
  ('messaggio_conferma_es', 'Hola {nome}, tu reserva en {ristorante} para {persone} el {data} a las {ora} está confirmada. Código {codice}. Para verla o cancelarla: {link}'),
  ('descrizione_en', 'Seasonal cooking, handmade pasta and a small cellar of local wines. A fictional restaurant for the demo.'),
  ('descrizione_de', 'Saisonale Küche, handgemachte Pasta und ein kleiner Keller mit regionalen Weinen. Ein erfundenes Restaurant für die Demo.'),
  ('descrizione_fr', 'Cuisine de saison, pâtes faites main et une petite cave de vins du terroir. Restaurant fictif pour la démo.'),
  ('descrizione_es', 'Cocina de temporada, pasta hecha a mano y una pequeña bodega de vinos locales. Restaurante ficticio para la demo.'),
  ('menu_nota', 'Coperto 2,50 €. Se hai allergie o intolleranze, dillo al personale prima di ordinare.'),
  ('menu_nota_en', 'Cover charge €2.50. If you have allergies or intolerances, please tell our staff before ordering.'),
  ('menu_nota_de', 'Gedeck 2,50 €. Bitte informieren Sie unser Personal vor der Bestellung über Allergien oder Unverträglichkeiten.'),
  ('menu_nota_fr', 'Couvert 2,50 €. En cas d''allergies ou d''intolérances, prévenez notre équipe avant de commander.'),
  ('menu_nota_es', 'Cubierto 2,50 €. Si tienes alergias o intolerancias, avisa al personal antes de pedir.');
