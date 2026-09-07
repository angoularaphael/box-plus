# Bot ventes Eddy — prem-eu2.bot-hosting.net:21871

Bot **inscriptions** Boxing Center, vendeur Deciplus **EDDY**.
Même procédure que Raphaël sur prem-eu1 (`BOXPLUS_BOT_URL`).

Les **résils / vérifs / échéancier** restent sur **:21268** (`BOXPLUS_BOT_URL_OPS`).

## Déploiement BotHosting

1. Serveur Pterodactyl — port **21871**
2. Uploader à la racine `/home/container/` :
   - `index.js` (ce dossier)
   - `.env` (copier depuis `.env.example`, remplir **EDDY** + `SYNC_SECRET` identique)
3. Startup command : `node index.js`

## Variables obligatoires

| Variable | Valeur |
|----------|--------|
| `BOT_ROLE` | `sales` |
| `BOT_ID` | `eddy` |
| `BOT_HTTP_PORT` | `21871` |
| `DECIPLUS_USER` | compte Eddy |
| `BOT_CATALOG_PUSH_ENABLED` | `false` |
| `ALERT_EMAIL` | `boxingcentertls@gmail.com` |
| `RESEND_API_KEY` | pour les mails d’échec job |
| `SYNC_SECRET` | même secret que Vercel |

## Côté Vercel (boutique)

```env
BOXPLUS_BOT_URL=http://prem-eu1.bot-hosting.net:20311
BOXPLUS_BOT_URL_SALES_2=http://prem-eu2.bot-hosting.net:21871
BOXPLUS_BOT_URL_OPS=http://prem-eu2.bot-hosting.net:21268
```

Sans `BOXPLUS_BOT_URL_SALES_2`, toutes les inscriptions restent sur Raphaël (eu1).

Health : `http://prem-eu2.bot-hosting.net:21871/health` → `bot_id: "eddy"`.
