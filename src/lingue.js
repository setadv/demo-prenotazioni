/** Lingue delle pagine pubbliche e dei messaggi ai clienti. Il pannello del gestore resta in italiano. */
export const LINGUE = ["it", "en", "de", "fr", "es"];
export const ALTRE_LINGUE = LINGUE.filter((l) => l !== "it");
export const LOCALI = { it: "it-IT", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES" };

export const linguaValida = (l) => (LINGUE.includes(l) ? l : "it");

/** Lingua di una richiesta pubblica: campo del corpo, parametro, header della pagina o lingua del browser. */
export function linguaRichiesta(request, url, corpo) {
  const scelta = corpo?.lingua ?? url?.searchParams.get("lingua") ?? request.headers.get("x-lingua");
  if (LINGUE.includes(scelta)) return scelta;
  const browser = (request.headers.get("accept-language") ?? "").slice(0, 2).toLowerCase();
  return linguaValida(browser);
}

const ERRORI = {
  it: {
    persone: "Indica il numero di persone.",
    persone_range: "Scegli da 1 a {max} persone.",
    gruppo: "Per gruppi di più di {max} persone chiama il ristorante.",
    nome: "Scrivi nome e cognome (almeno 2 caratteri).",
    telefono: "Scrivi un numero di telefono valido.",
    email: "Scrivi un'email valida o lascia il campo vuoto.",
    email_canale: "Per ricevere la conferma via email scrivi il tuo indirizzo.",
    lungo: "Uno dei campi è troppo lungo. Accorcialo e riprova.",
    privacy: "Per prenotare devi accettare l'uso dei dati.",
    orario: "Scegli un orario.",
    occupato: "Questo orario non è più disponibile. Scegline un altro.",
    limite: "Troppe prenotazioni in poco tempo. Riprova tra un'ora.",
    data: "Scegli una data valida.",
    chiuso_giorno: "Il ristorante è chiuso in questo giorno.",
    chiuso_data: "Il ristorante è chiuso in questa data.",
    non_trovata: "Prenotazione non trovata. Controlla il link ricevuto.",
    non_annullabile: "Questa prenotazione non si può più annullare online. Chiama il ristorante.",
  },
  en: {
    persone: "Choose the number of guests.",
    persone_range: "Choose from 1 to {max} guests.",
    gruppo: "For groups of more than {max} people, please call the restaurant.",
    nome: "Enter your full name (at least 2 characters).",
    telefono: "Enter a valid phone number.",
    email: "Enter a valid email address or leave the field empty.",
    email_canale: "To receive the confirmation by email, enter your address.",
    lungo: "One of the fields is too long. Please shorten it and try again.",
    privacy: "To book, you need to accept the use of your data.",
    orario: "Choose a time.",
    occupato: "This time is no longer available. Please choose another one.",
    limite: "Too many bookings in a short time. Please try again in an hour.",
    data: "Choose a valid date.",
    chiuso_giorno: "The restaurant is closed on this day.",
    chiuso_data: "The restaurant is closed on this date.",
    non_trovata: "Booking not found. Please check the link you received.",
    non_annullabile: "This booking can no longer be cancelled online. Please call the restaurant.",
  },
  de: {
    persone: "Wählen Sie die Anzahl der Personen.",
    persone_range: "Wählen Sie 1 bis {max} Personen.",
    gruppo: "Für Gruppen mit mehr als {max} Personen rufen Sie bitte das Restaurant an.",
    nome: "Geben Sie Vor- und Nachnamen ein (mindestens 2 Zeichen).",
    telefono: "Geben Sie eine gültige Telefonnummer ein.",
    email: "Geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld leer.",
    email_canale: "Für die Bestätigung per E-Mail geben Sie bitte Ihre Adresse ein.",
    lungo: "Eines der Felder ist zu lang. Bitte kürzen Sie es.",
    privacy: "Für die Reservierung müssen Sie der Datennutzung zustimmen.",
    orario: "Wählen Sie eine Uhrzeit.",
    occupato: "Diese Uhrzeit ist nicht mehr verfügbar. Bitte wählen Sie eine andere.",
    limite: "Zu viele Reservierungen in kurzer Zeit. Bitte versuchen Sie es in einer Stunde erneut.",
    data: "Wählen Sie ein gültiges Datum.",
    chiuso_giorno: "Das Restaurant ist an diesem Tag geschlossen.",
    chiuso_data: "Das Restaurant ist an diesem Datum geschlossen.",
    non_trovata: "Reservierung nicht gefunden. Bitte prüfen Sie den erhaltenen Link.",
    non_annullabile: "Diese Reservierung kann online nicht mehr storniert werden. Bitte rufen Sie das Restaurant an.",
  },
  fr: {
    persone: "Indiquez le nombre de personnes.",
    persone_range: "Choisissez de 1 à {max} personnes.",
    gruppo: "Pour les groupes de plus de {max} personnes, appelez le restaurant.",
    nome: "Indiquez vos nom et prénom (au moins 2 caractères).",
    telefono: "Indiquez un numéro de téléphone valide.",
    email: "Indiquez une adresse e-mail valide ou laissez le champ vide.",
    email_canale: "Pour recevoir la confirmation par e-mail, indiquez votre adresse.",
    lungo: "Un des champs est trop long. Raccourcissez-le et réessayez.",
    privacy: "Pour réserver, vous devez accepter l'utilisation de vos données.",
    orario: "Choisissez un horaire.",
    occupato: "Cet horaire n'est plus disponible. Choisissez-en un autre.",
    limite: "Trop de réservations en peu de temps. Réessayez dans une heure.",
    data: "Choisissez une date valide.",
    chiuso_giorno: "Le restaurant est fermé ce jour-là.",
    chiuso_data: "Le restaurant est fermé à cette date.",
    non_trovata: "Réservation introuvable. Vérifiez le lien reçu.",
    non_annullabile: "Cette réservation ne peut plus être annulée en ligne. Appelez le restaurant.",
  },
  es: {
    persone: "Indica el número de personas.",
    persone_range: "Elige de 1 a {max} personas.",
    gruppo: "Para grupos de más de {max} personas, llama al restaurante.",
    nome: "Escribe tu nombre y apellido (al menos 2 caracteres).",
    telefono: "Escribe un número de teléfono válido.",
    email: "Escribe un email válido o deja el campo vacío.",
    email_canale: "Para recibir la confirmación por email, escribe tu dirección.",
    lungo: "Uno de los campos es demasiado largo. Acórtalo e inténtalo de nuevo.",
    privacy: "Para reservar debes aceptar el uso de tus datos.",
    orario: "Elige una hora.",
    occupato: "Esta hora ya no está disponible. Elige otra.",
    limite: "Demasiadas reservas en poco tiempo. Inténtalo de nuevo dentro de una hora.",
    data: "Elige una fecha válida.",
    chiuso_giorno: "El restaurante cierra este día.",
    chiuso_data: "El restaurante está cerrado en esta fecha.",
    non_trovata: "Reserva no encontrada. Revisa el enlace que recibiste.",
    non_annullabile: "Esta reserva ya no se puede cancelar online. Llama al restaurante.",
  },
};

/** Messaggio di errore per il cliente, nella sua lingua. */
export function erroreIn(lingua, chiave, valori = {}) {
  const testo = ERRORI[linguaValida(lingua)][chiave] ?? ERRORI.it[chiave];
  return testo.replace(/\{(\w+)\}/g, (tutto, k) => (k in valori ? String(valori[k]) : tutto));
}

const PERSONE = {
  it: ["persona", "persone"],
  en: ["person", "people"],
  de: ["Person", "Personen"],
  fr: ["personne", "personnes"],
  es: ["persona", "personas"],
};

export function personeIn(lingua, n) {
  const [una, molte] = PERSONE[linguaValida(lingua)];
  return `${n} ${n === 1 ? una : molte}`;
}

export function dataIn(lingua, iso) {
  return new Intl.DateTimeFormat(LOCALI[linguaValida(lingua)], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

const OGGETTI = {
  conferma: {
    it: "Prenotazione confermata da {r}",
    en: "Booking confirmed at {r}",
    de: "Reservierung bestätigt: {r}",
    fr: "Réservation confirmée chez {r}",
    es: "Reserva confirmada en {r}",
  },
  recensione: {
    it: "Com'è andata da {r}?",
    en: "How was your visit to {r}?",
    de: "Wie war Ihr Besuch im {r}?",
    fr: "Comment s'est passée votre visite chez {r} ?",
    es: "¿Qué tal tu visita a {r}?",
  },
};

Object.assign(OGGETTI, {
  sondaggio: {
    it: "Com'è andata da {r}?",
    en: "How was your visit to {r}?",
    de: "Wie war Ihr Besuch im {r}?",
    fr: "Comment s'est passée votre visite chez {r} ?",
    es: "¿Qué tal tu visita a {r}?",
  },
  premio: {
    it: "Hai un premio da {r}",
    en: "You have a reward at {r}",
    de: "Ihre Prämie im {r}",
    fr: "Votre cadeau chez {r}",
    es: "Tienes un premio en {r}",
  },
  ordine: {
    it: "Ordine confermato da {r}",
    en: "Order confirmed at {r}",
    de: "Bestellung bestätigt: {r}",
    fr: "Commande confirmée chez {r}",
    es: "Pedido confirmado en {r}",
  },
  gift: {
    it: "Una gift card per te da {r}",
    en: "A gift card for you at {r}",
    de: "Ein Gutschein für Sie: {r}",
    fr: "Une carte cadeau pour vous chez {r}",
    es: "Una tarjeta regalo para ti en {r}",
  },
});

const TIPO_ORDINE = {
  asporto: { it: "ritiro", en: "pickup", de: "Abholung", fr: "retrait", es: "recogida" },
  consegna: { it: "consegna", en: "delivery", de: "Lieferung", fr: "livraison", es: "entrega" },
};
export const tipoOrdineIn = (lingua, tipo) => TIPO_ORDINE[tipo][linguaValida(lingua)];

const ERRORI_MODULI = {
  it: {
    ordini_chiusi: "Gli ordini online sono chiusi in questo momento.",
    tipo_ordine: "Questo tipo di ordine non è disponibile.",
    carrello_vuoto: "Il carrello è vuoto.",
    piatto: "Un piatto non è più disponibile. Aggiorna la pagina.",
    minimo: "Per la consegna l'ordine minimo è {minimo}.",
    indirizzo: "Scrivi l'indirizzo di consegna.",
    cap: "Scrivi un CAP valido.",
    cap_fuori: "Non consegniamo in questa zona.",
    fascia: "Questo orario non è più disponibile. Scegline un altro.",
    pagamento: "Scegli un metodo di pagamento disponibile.",
    gift_chiuse: "Le gift card online non sono disponibili.",
    importo: "Scegli un importo.",
    destinatario: "Scrivi il nome di chi riceve il regalo.",
    sondaggio_fatto: "Hai già risposto: grazie!",
    voto: "Dai un voto da 1 a 5 a ogni domanda.",
    non_trovato: "Non trovato. Controlla il link ricevuto.",
  },
  en: {
    ordini_chiusi: "Online ordering is closed at the moment.",
    tipo_ordine: "This type of order is not available.",
    carrello_vuoto: "Your basket is empty.",
    piatto: "A dish is no longer available. Please reload the page.",
    minimo: "The minimum order for delivery is {minimo}.",
    indirizzo: "Enter the delivery address.",
    cap: "Enter a valid postcode.",
    cap_fuori: "We do not deliver to this area.",
    fascia: "This time is no longer available. Please choose another one.",
    pagamento: "Choose an available payment method.",
    gift_chiuse: "Online gift cards are not available.",
    importo: "Choose an amount.",
    destinatario: "Enter the name of the person receiving the gift.",
    sondaggio_fatto: "You have already answered: thank you!",
    voto: "Rate each question from 1 to 5.",
    non_trovato: "Not found. Please check the link you received.",
  },
  de: {
    ordini_chiusi: "Online-Bestellungen sind derzeit geschlossen.",
    tipo_ordine: "Diese Bestellart ist nicht verfügbar.",
    carrello_vuoto: "Ihr Warenkorb ist leer.",
    piatto: "Ein Gericht ist nicht mehr verfügbar. Bitte laden Sie die Seite neu.",
    minimo: "Der Mindestbestellwert für die Lieferung beträgt {minimo}.",
    indirizzo: "Geben Sie die Lieferadresse ein.",
    cap: "Geben Sie eine gültige Postleitzahl ein.",
    cap_fuori: "In dieses Gebiet liefern wir nicht.",
    fascia: "Diese Uhrzeit ist nicht mehr verfügbar. Bitte wählen Sie eine andere.",
    pagamento: "Wählen Sie eine verfügbare Zahlungsart.",
    gift_chiuse: "Online-Gutscheine sind nicht verfügbar.",
    importo: "Wählen Sie einen Betrag.",
    destinatario: "Geben Sie den Namen der beschenkten Person ein.",
    sondaggio_fatto: "Sie haben bereits geantwortet: vielen Dank!",
    voto: "Bewerten Sie jede Frage von 1 bis 5.",
    non_trovato: "Nicht gefunden. Bitte prüfen Sie den erhaltenen Link.",
  },
  fr: {
    ordini_chiusi: "Les commandes en ligne sont fermées pour le moment.",
    tipo_ordine: "Ce type de commande n'est pas disponible.",
    carrello_vuoto: "Votre panier est vide.",
    piatto: "Un plat n'est plus disponible. Rechargez la page.",
    minimo: "La commande minimum pour la livraison est de {minimo}.",
    indirizzo: "Indiquez l'adresse de livraison.",
    cap: "Indiquez un code postal valide.",
    cap_fuori: "Nous ne livrons pas dans cette zone.",
    fascia: "Cet horaire n'est plus disponible. Choisissez-en un autre.",
    pagamento: "Choisissez un moyen de paiement disponible.",
    gift_chiuse: "Les cartes cadeaux en ligne ne sont pas disponibles.",
    importo: "Choisissez un montant.",
    destinatario: "Indiquez le nom de la personne qui reçoit le cadeau.",
    sondaggio_fatto: "Vous avez déjà répondu : merci !",
    voto: "Notez chaque question de 1 à 5.",
    non_trovato: "Introuvable. Vérifiez le lien reçu.",
  },
  es: {
    ordini_chiusi: "Los pedidos online están cerrados en este momento.",
    tipo_ordine: "Este tipo de pedido no está disponible.",
    carrello_vuoto: "Tu cesta está vacía.",
    piatto: "Un plato ya no está disponible. Vuelve a cargar la página.",
    minimo: "El pedido mínimo para la entrega es {minimo}.",
    indirizzo: "Escribe la dirección de entrega.",
    cap: "Escribe un código postal válido.",
    cap_fuori: "No entregamos en esta zona.",
    fascia: "Esta hora ya no está disponible. Elige otra.",
    pagamento: "Elige un método de pago disponible.",
    gift_chiuse: "Las tarjetas regalo online no están disponibles.",
    importo: "Elige un importe.",
    destinatario: "Escribe el nombre de quien recibe el regalo.",
    sondaggio_fatto: "Ya has respondido: ¡gracias!",
    voto: "Puntúa cada pregunta de 1 a 5.",
    non_trovato: "No encontrado. Revisa el enlace que recibiste.",
  },
};
for (const l of LINGUE) Object.assign(ERRORI[l], ERRORI_MODULI[l]);

export const oggettoEmail = (tipo, lingua, ristorante) => OGGETTI[tipo][linguaValida(lingua)].replace("{r}", ristorante);

/** Testo del modello nella lingua del cliente; se manca, quello italiano. */
export function modelloIn(imp, chiave, lingua) {
  const l = linguaValida(lingua);
  return (l !== "it" && imp[`${chiave}_${l}`]) || imp[chiave];
}
