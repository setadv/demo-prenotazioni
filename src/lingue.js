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

export const oggettoEmail = (tipo, lingua, ristorante) => OGGETTI[tipo][linguaValida(lingua)].replace("{r}", ristorante);

/** Testo del modello nella lingua del cliente; se manca, quello italiano. */
export function modelloIn(imp, chiave, lingua) {
  const l = linguaValida(lingua);
  return (l !== "it" && imp[`${chiave}_${l}`]) || imp[chiave];
}
