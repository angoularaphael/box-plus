# Bot operations Eddy — prem-eu2.bot-hosting.net:21268

Bot **ops** Boxing Center (`BOT_ROLE=ops`) : resils, verifs, echeancier, nudges, anniversaires (Brevo + SMS).

Les **inscriptions** restent sur :
- Raphaël `BOXPLUS_BOT_URL` (eu1)
- Eddy ventes `BOXPLUS_BOT_URL_SALES_2` (`prem-eu2:21871`)

## Deploiement BotHosting

1. Serveur Pterodactyl — port **21268**
2. Uploader a la racine `/home/container/` :
   - `index.js` (ce dossier)
   - `.env` (copier depuis `.env.example`, remplir Eddy + `SYNC_SECRET` + Brevo + SMS)
3. Startup command : `node index.js`

Le dossier doit rester vide sauf ces 2 fichiers. `index.js` clone `box-plus`, installe Playwright, puis lance `node start.js`.

## Variables obligatoires

| Variable | Valeur |
|----------|--------|
| `BOT_ROLE` | `ops` |
| `BOT_ID` | `eddy-ops` |
| `BOT_HTTP_PORT` | `21268` |
| `DECIPLUS_USER` | compte Eddy |
| `BOT_CATALOG_PUSH_ENABLED` | `false` |
| `SYNC_SECRET` | meme secret que Vercel |
| `BREVO_API_KEY` | anniversaires mail |
| `SMS_GATEWAY_URL` | gateway SMS (21724) |

## Cote Vercel (boutique)

```env
BOXPLUS_BOT_URL_OPS=http://prem-eu2.bot-hosting.net:21268
```

Health : `http://prem-eu2.bot-hosting.net:21268/health` -> `bot_id: "eddy-ops"`.
