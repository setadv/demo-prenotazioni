# Demo prenotazioni SETADV

App di prova per un ristorante inventato, su Cloudflare Workers e D1. Non inserire dati reali.

- Pagina pubblica: `/`
- Area riservata: `/admin`

## Impostazioni Cloudflare

| Impostazione | Valore |
|---|---|
| Comando di build | lasciare vuoto |
| Comando di deploy | `npm run deploy` |
| Branch di produzione | `main` |

Il token di build deve avere il permesso D1 Edit, oltre ai permessi per i Workers. `npm run deploy` applica le migrazioni ai database di produzione e Preview, poi pubblica il Worker. Le Preview usano il comando predefinito `npx wrangler preview`: una nuova migrazione raggiunge il database di Preview dopo il deploy da `main`.

## Secret obbligatori

Impostali sia per Produzione sia per Previews Base:

- `ADMIN_PASSWORD`: password dell'area riservata.
- `SESSION_SECRET`: stringa casuale di almeno 32 caratteri. Usa un valore diverso per Preview e produzione.

## Test locali

```sh
npm install
npm test
```

## Foto del locale

R2 è facoltativo e all'inizio non è configurato. Dopo aver creato due bucket, aggiungi a `wrangler.jsonc` un binding `FOTO` per la produzione e uno per `previews`, ciascuno con il proprio bucket. Il pannello mostrerà il caricamento della foto.
