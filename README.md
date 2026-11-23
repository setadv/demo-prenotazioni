# Demo prenotazioni SETADV

Sistema di prenotazione tavoli per un ristorante inventato, su Cloudflare Workers e D1. Non inserire dati reali.

- Pagina pubblica: `/` con scelta di persone, giorno e orario, promozioni e dati del cliente.
- Menù online: `/menu`, con allergeni (Reg. UE 1169/2011) e filtro per chi ha allergie. Con `?t=<id tavolo>` mostra il numero del tavolo: è l'indirizzo dei QR code.
- Asporto e consegna: `/ordina` (carrello, fasce orarie, zone per CAP, minimo d'ordine) e `/ordine` per seguire lo stato. Nessuna commissione di piattaforma.
- Gift card: `/regalo` per l'acquisto online, `/buono` per la carta con saldo e QR del codice.
- Sondaggio dopo la visita: `/sondaggio`.
- Lingue: tutte le pagine pubbliche sono in italiano, inglese, tedesco, francese e spagnolo. I messaggi al cliente partono nella lingua in cui ha prenotato.
- Gestione della prenotazione da parte del cliente: `/prenotazione` (link con token ricevuto alla conferma).
- Pannello del gestore: `/admin` con agenda, sala in tempo reale, mappa dei tavoli, clienti (CRM), menù con QR code, statistiche, impostazioni e account.
- Piattaforma: `/piattaforma`, per chi vende il servizio. Crea ristoranti, li attiva, sospende o disattiva, gestisce piani, accessi e integrazioni.

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
- `SUPERADMIN_EMAIL`: la tua email, per entrare in `/piattaforma`.

## Piattaforma con più ristoranti

Una sola app e un solo database: ogni riga porta l'id del ristorante (`ristorante_id`) e ogni query lo filtra. Il ristorante `demo` (indirizzo `melograno`) è quello di prima.

**Come si trova il ristorante.** Pagine pubbliche: sottodominio di `DOMINIO_BASE` (es. `osteria.prenota.tuodominio.it`), poi `?r=indirizzo` (ricordato con un cookie), poi il ristorante di chi è collegato, poi la demo. I link personali (prenotazione, ordine, buono, sondaggio) portano il ristorante con sé. Pannello: il ristorante è quello della sessione, mai quello dell'indirizzo.

**Stati.** In prova (fino a una data), Attivo, Sospeso (con motivo), Disattivato. Prova scaduta o sospeso: le pagine pubbliche rispondono "non disponibile" e il pannello è in sola consultazione. Disattivato: niente pagine e niente accesso; solo da qui si può cancellare, scrivendo l'indirizzo per conferma.

**Piani e funzioni.** Base (prenotazioni, menù e QR, CRM, recensioni), Pro (+ WhatsApp, fidelity, gift card, sondaggi), Completo (+ asporto e consegna). Le funzioni si scelgono ristorante per ristorante; quelle non incluse restano spente anche se attivate nelle impostazioni. Prezzi di listino in `src/predefiniti.js`.

**Accessi.** Ognuno entra con email e password (PBKDF2). Ruoli: Titolare (tutto, comprese le persone), Staff (servizio: agenda, sala, ordini, clienti, buoni), Sola lettura. Inviti e "password dimenticata" passano da un link monouso a `/accesso` (7 giorni l'invito, 2 ore il recupero), inviato con Resend se configurato, altrimenti mostrato da copiare. La sola password `ADMIN_PASSWORD` funziona ancora, ma solo per il ristorante predefinito.

**Super amministratore.** `/piattaforma` con `SUPERADMIN_EMAIL` e `ADMIN_PASSWORD`, oppure con un account amministratore creato in Amministratori. Da qui: cruscotto (ricavo mensile, prove e pagamenti in scadenza), elenco e ricerca, nuovo ristorante (con sala e orari di partenza e invito al titolare), dati di fatturazione, "pagato fino al", uso degli ultimi 30 giorni, esportazione dei dati in JSON, "Entra come assistenza" (resta nel registro), registro di tutte le operazioni.

**Integrazioni per ristorante.** Le chiavi Stripe e WhatsApp di ogni ristorante si inseriscono nella sua scheda e si salvano cifrate (AES-GCM, chiave da `CHIAVE_CIFRATURA` o da `SESSION_SECRET`). I secret dell'app valgono solo per il ristorante predefinito. Webhook per ristorante: `/api/stripe/webhook/<id>` e `/api/whatsapp/webhook/<indirizzo>`, mostrati nella scheda.

**Iscrizione dal sito.** `/registrati`: il ristorante sceglie il piano, crea l'account e entra subito nel pannello, in prova per 14 giorni con tutte le funzioni del piano. Riceve un'email di benvenuto; tu ricevi un avviso su `SUPERADMIN_EMAIL` e lo trovi nel registro. Massimo 3 iscrizioni l'ora dalla stessa connessione e un campo trappola contro i programmi automatici. A fine prova il ristorante resta in sola consultazione finché non lo attivi tu.

Variabili aggiuntive (facoltative):

- `ISCRIZIONI`: `chiuse` per spegnere l'iscrizione dal sito.
- `GIORNI_PROVA`: durata della prova per chi si iscrive (di base 14).
- `LINK_TERMINI`, `LINK_PRIVACY`: indirizzi delle condizioni del servizio e dell'informativa, mostrati nella casella del consenso.

- `SUPERADMIN_EMAIL`: email per il primo accesso a `/piattaforma`.
- `DOMINIO_BASE`: es. `prenota.tuodominio.it`. Serve un dominio su Cloudflare con un record DNS `*.prenota` e una route del Worker `*.prenota.tuodominio.it/*`. Senza, gli indirizzi sono `/?r=indirizzo`.
- `RISTORANTE_PREDEFINITO`: indirizzo del ristorante mostrato senza sottodominio né `?r=` (di base la demo).
- `CHIAVE_CIFRATURA`: chiave per cifrare le integrazioni. Se la imposti dopo aver salvato delle chiavi, vanno reinserite.

## Test locali

```sh
npm install
npm test
```

## Traduzione automatica del menù

Nel pannello, sezione Menù, il pulsante **Traduci in automatico** traduce dall'italiano in inglese, tedesco, francese e spagnolo:

- nella testata: tutte le categorie e i piatti a cui manca qualche traduzione, poi salva;
- nella scheda di un piatto o di una categoria: riempie i campi delle traduzioni, che il gestore rilegge prima di salvare.

Riempie solo le traduzioni vuote: quelle già scritte, anche a mano, non vengono toccate. Usa Workers AI (modello `@cf/meta/m2m100-1.2b`, binding `AI` in `wrangler.jsonc`), senza chiavi da impostare; il consumo rientra nel piano Workers AI dell'account Cloudflare. In `wrangler dev` il binding `AI` si collega a Cloudflare e richiede `wrangler login`. Nei test un server finto prende il suo posto tramite la variabile `TRADUZIONE_ENDPOINT`.

## Logo e foto del locale

Si caricano da Impostazioni nel pannello e sono salvati nel database D1: non serve un bucket R2. Le foto troppo grandi vengono ridotte nel browser prima del caricamento.

## Foto dei piatti

Ogni piatto può avere una foto facoltativa. Si carica, si sostituisce o si toglie dalla scheda del piatto nel pannello Menù, dopo aver salvato il piatto almeno una volta. Il browser la riduce a 1200 px sul lato lungo e la converte in JPG; il server accetta JPG, PNG o WebP fino a 400 KB. Le foto stanno nella tabella D1 `menu_foto` (migrazione 0009) e spariscono con il piatto. Nel menù pubblico la foto compare accanto al piatto; i piatti senza foto restano come prima, senza spazi vuoti.

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
