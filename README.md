# Demo prenotazioni SETADV

Sistema di prenotazione tavoli per un ristorante inventato, su Cloudflare Workers e D1. Non inserire dati reali.

- Pagina pubblica: `/` con scelta di persone, giorno e orario, promozioni e dati del cliente.
- Menù online: `/menu`, con allergeni (Reg. UE 1169/2011) e filtro per chi ha allergie. Con `?t=<id tavolo>` mostra il numero del tavolo: è l'indirizzo dei QR code.
- Asporto e consegna: `/ordina` (carrello, fasce orarie, zone per CAP, minimo d'ordine) e `/ordine` per seguire lo stato. Nessuna commissione di piattaforma.
- Gift card: `/regalo` per l'acquisto online, `/buono` per la carta con saldo e QR del codice.
- Sondaggio dopo la visita: `/sondaggio`.
- Lingue: tutte le pagine pubbliche sono in italiano, inglese, tedesco, francese e spagnolo. I messaggi al cliente partono nella lingua in cui ha prenotato.
- Gestione della prenotazione da parte del cliente: `/prenotazione` (link con token ricevuto alla conferma).
- Pannello del gestore: `/admin` con agenda, sala in tempo reale, mappa dei tavoli, clienti (CRM), menù con QR code, statistiche e impostazioni.

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
- **WhatsApp:** senza configurazione il gestore lo invia dall'agenda con un clic, con il testo già pronto. Per l'invio automatico vedi più sotto.

Senza secret, l'agenda segna la conferma come da inviare e propone i pulsanti WhatsApp, SMS ed email. Se il canale scelto fallisce si prova l'altro canale automatico; chi sceglie WhatsApp non riceve SMS a pagamento al suo posto.

Il link personale del cliente deriva da `SESSION_SECRET`: se cambi questo secret, i link già inviati smettono di funzionare.

## Richiesta di recensione

In Impostazioni si inserisce il link per le recensioni (per Google: Profilo dell'attività, Chiedi recensioni). Qualche ora dopo la fine del pasto, le prenotazioni segnate come Arrivati ricevono un solo messaggio con il link, sul canale scelto dal cliente. Non si usa l'SMS se il cliente non l'ha scelto. Il controllo gira ogni 15 minuti con un Cron Trigger e anche quando il gestore apre l'agenda, così funziona pure nelle Preview. Tutti ricevono lo stesso link: le regole di Google vietano di invitare solo i clienti soddisfatti.

## WhatsApp automatico (API Cloud di Meta)

1. In Meta Business crea un'app con il prodotto WhatsApp e collega il numero del ristorante.
2. In WhatsApp Manager fai approvare due modelli in italiano. I testi esatti sono in Impostazioni, sezione WhatsApp. Parametri in ordine:
   - conferma: `{{1}}` nome, `{{2}}` ristorante, `{{3}}` persone, `{{4}}` data, `{{5}}` ora, `{{6}}` codice, `{{7}}` link;
   - recensione: `{{1}}` nome, `{{2}}` ristorante, `{{3}}` link per la recensione.
3. Imposta i secret:
   - `WHATSAPP_TOKEN`: token di accesso permanente di un utente di sistema;
   - `WHATSAPP_PHONE_ID`: ID del numero di telefono;
   - `WHATSAPP_MODELLO_CONFERMA` e `WHATSAPP_MODELLO_RECENSIONE`: nomi dei modelli approvati;
   - `WHATSAPP_LINGUE` (facoltativo): codici dei modelli approvati, per esempio `it,en_GB,de`. Ai clienti di altre lingue va il primo;
   - `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`: per il webhook.
4. Nell'app Meta registra il webhook `https://<dominio>/api/whatsapp/webhook` con lo stesso verify token e iscriviti al campo `messages`. Le risposte dei clienti e gli stati di consegna compaiono in Impostazioni.

Senza `WHATSAPP_MODELLO_CONFERMA` le conferme WhatsApp restano manuali; lo stesso vale per le recensioni. L'indirizzo dell'API è `https://graph.facebook.com/v23.0`: per un'altra versione imposta `WHATSAPP_ENDPOINT`.

## CRM

I clienti sono riconosciuti da telefono o email. Il gestore aggiunge etichette (per esempio VIP), compleanno e note; l'agenda mostra etichette, compleanni vicini e lingua del cliente. Il consenso alle promozioni è una casella facoltativa nel modulo di prenotazione e viene salvato con la data; si revoca dalla scheda del cliente. I gruppi (abituali, VIP, nuovi, da riconquistare, con assenze, compleanno del mese, con consenso) si esportano in CSV per Excel. Comunicazioni promozionali solo ai clienti con consenso.

## Fidelity

Il cliente si iscrive con una casella nel modulo di prenotazione o d'ordine (oppure dal gestore, nella sua scheda). Riceve punti quando la prenotazione passa ad Arrivati e quando un ordine è completato; ogni visita e ogni ordine contano una volta sola, e annullare l'arrivo toglie i punti. Alla soglia il premio nasce da solo, i punti vengono scalati e il cliente riceve un messaggio con il codice `PR-...`. In Fidelity il gestore verifica il codice e lo segna come consegnato.

## Gift card

Il gestore emette dal pannello le gift card vendute al banco. Con Stripe configurato i clienti le comprano online da `/regalo`: la carta si attiva quando arriva il pagamento e il messaggio parte a chi la riceve. Si spendono a scalare: in Fidelity il gestore scrive il codice `GC-...` e l'importo da togliere dal saldo.

## Sondaggio dopo la visita

Se è attivo, il messaggio dopo la visita porta al sondaggio (quattro voti, consiglio da 0 a 10, commento) invece che direttamente alla recensione. Alla fine a tutti compare il link per la recensione, qualunque voto abbiano dato. In Sondaggi ci sono medie, NPS e le risposte da richiamare. Per i messaggi partiti dal Cron Trigger l'app usa l'indirizzo con cui il gestore ha aperto l'agenda; in alternativa imposta la variabile `SITO_URL`.

## Asporto e consegna

I piatti ordinabili sono quelli del menù con prezzo e la spunta "Ordinabile da asporto". Gli orari seguono quelli dei servizi, con il tempo di preparazione e un massimo di ordini per orario. Il gestore accetta l'ordine nella sezione Ordini (parte la conferma al cliente), lo segna pronto o in consegna e poi completato; può stampare la comanda.

## Pagamenti online (Stripe)

Facoltativi: senza Stripe le gift card si vendono al banco e gli ordini si pagano al ritiro o alla consegna. Per attivarli:

1. Nella dashboard Stripe crea un endpoint webhook verso `https://<dominio>/api/stripe/webhook` con gli eventi `checkout.session.completed` e `checkout.session.expired`.
2. Imposta i secret `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` (il "signing secret" dell'endpoint).

Non ci sono commissioni di piattaforma; restano le commissioni di Stripe sui pagamenti con carta. I rimborsi si fanno dalla dashboard di Stripe.

Modelli WhatsApp aggiuntivi (facoltativi): `WHATSAPP_MODELLO_SONDAGGIO`, `WHATSAPP_MODELLO_PREMIO`, `WHATSAPP_MODELLO_ORDINE`, `WHATSAPP_MODELLO_GIFT`. I testi da far approvare, con i parametri numerati, sono in Impostazioni, sezione WhatsApp.
