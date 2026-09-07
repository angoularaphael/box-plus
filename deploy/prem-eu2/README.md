# Bot maintenance — prem-eu2.bot-hosting.net:21871

Bot **OPS / maintenance** Boxing Center : rattrapages, résiliations, vérifs, relances.
Les **nouvelles inscriptions** restent sur prem-eu1 (`BOXPLUS_BOT_URL`).

## Déploiement BotHosting

1. Créer un serveur (Pterodactyl) — port **21871**
2. Uploader à la racine `/home/container/` :
   - `index.js` (ce dossier)
   - `.env` (copier depuis `.env.example`, remplir les secrets)
3. Startup command : `node index.js`

## Variables obligatoires

| Variable | Valeur |
|----------|--------|
| `BOT_ROLE` | `ops` |
| `BOT_HTTP_PORT` | `21871` |
| `SYNC_SECRET` | même secret que Vercel |
| `DECIPLUS_*` | identifiants Deciplus |
| `BOXPLUS_STORE_URL` | `https://boutique.boxingcenter.fr` |

## Côté Vercel (boutique)

```env
BOXPLUS_BOT_URL_OPS=https://prem-eu2.bot-hosting.net:21871
```

Les jobs `cancel`, `verify_identity`, `check_sale`, `inscription_nudge`, `balma_switch` partent ici.

## Scripts maintenance (en local ou cron sur eu2)

```bash
cd boxi-deci-bot
node scripts/fix-pending-comptant-12mois.js --apply
node scripts/audit-send-missing-rib.js --check
node scripts/audit-send-missing-rib.js --send-only
```

Ne pas lancer ces scripts sur prem-eu1 pendant les heures de pointe inscriptions.
