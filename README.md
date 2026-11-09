# Demo prenotazioni SETADV

Sistema di prenotazione tavoli per un ristorante inventato, su Cloudflare Workers e D1. Non inserire dati reali.

- Pagina pubblica: `/` con scelta di persone, giorno e orario, promozioni e dati del cliente.
- Gestione della prenotazione da parte del cliente: `/prenotazione` (link con token ricevuto alla conferma).
- Pannello del gestore: `/admin` con agenda, sala in tempo reale, mappa dei tavoli, clienti, statistiche e impostazioni.

## Come funziona la disponibilità

Ogni prenotazione occupa un tavolo per la durata impostata (90 minuti di base). Un orario è prenotabile online se esiste un tavolo prenotabile online, con posti minimi e massimi adatti al gruppo, libero per tutta la durata. Il tavolo viene scelto e bloccato nella stessa istruzione SQL, quindi due richieste simultanee non possono prenderlo entrambe.

## Impostazioni Cloudflare

| Impostazione | Valore |
|---|---|
| Comando di build | `npm run migrate` |
| Comando di deploy | `npm run deploy` |
| Branch di produzione | `main` |

`npm run migrate` applica le migrazioni ai database di produzione e Preview. Le build delle Preview non eseguono né il comando di build né quello di deploy, ma solo `npx wrangler preview`: una nuova migrazione arriva al database di Preview solo con un deploy da `main`.

Procedura per una modifica che cambia il database:

1. Pubblica su `main` **solo** il file della migrazione. Deve essere additiva: aggiungere tabelle o colonne, mai rimuoverle o rinominarle finché il codice in produzione le usa.
2. Sviluppa e prova il nuovo codice su un branch, nella sua Preview.
3. Unisci il branch a `main`. La pulizia delle tabelle vecchie va in una migrazione successiva.

Il token di build deve avere il permesso D1 Edit, oltre ai permessi per i Workers.

## Secret obbligatori

Impostali sia per Produzione sia per Previews Base:

- `ADMIN_PASSWORD`: password dell'area riservata.
- `SESSION_SECRET`: stringa casuale di almeno 32 caratteri. Usa un valore diverso per Preview e produzione.

## Test locali

```sh
npm install
npm test
```

## Logo e foto del locale

Si caricano da Impostazioni nel pannello e sono salvati nel database D1: non serve un bucket R2. Le foto troppo grandi vengono ridotte nel browser prima del caricamento.

## Messaggi di conferma

Il cliente sceglie se ricevere la conferma via email, SMS o WhatsApp. Il messaggio parte quando la prenotazione diventa confermata, in automatico o dall'agenda, e una sola volta. Il testo si modifica in Impostazioni.

- **Email automatica:** secret `RESEND_API_KEY` ed `EMAIL_MITTENTE` (per esempio `Osteria <prenotazioni@dominio-verificato.it>`). Il dominio del mittente va verificato su Resend.
- **SMS automatico:** secret `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_NUMERO`.
- **WhatsApp:** dall'agenda il gestore lo invia con un clic, con il testo già pronto. L'invio automatico richiede WhatsApp Business con modelli approvati da Meta.

Senza secret, l'agenda segna la conferma come da inviare e propone i pulsanti WhatsApp, SMS ed email. Se il canale scelto fallisce si prova l'altro canale automatico; chi sceglie WhatsApp non riceve SMS a pagamento al suo posto.

Il link personale del cliente deriva da `SESSION_SECRET`: se cambi questo secret, i link già inviati smettono di funzionare.
