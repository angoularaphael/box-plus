# BOXPLUS — Boutique Boxing Center

Boutique Stripe + bridge PrestaShop + sync catalogue Deciplus.

## Déploiement Vercel

1. Importer le repo [box-plus](https://github.com/angoularaphael/box-plus)
2. Variables d'environnement :

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Secret webhook Stripe |
| `STORE_URL` | `https://box-plus.vercel.app` |
| `SYNC_SECRET` | Secret partagé avec le bot (ingest catalogue) |
| `BOXPLUS_BOT_URL` | URL publique du bot (`https://bot.example.com`) — **requis en prod Vercel** |
| `BRIDGE_SECRET` | Secret webhook BOXPLUS |
| `BOXPLUS_QUEUE_DIR` | `/tmp/boxplus-queue` sur Vercel |

3. Webhook Stripe (depuis l’UI Stripe → **Developers → Webhooks**) :
   - URL : `https://box-plus.vercel.app/api/stripe/webhook`
   - Événements à cocher :
     - `checkout.session.completed` (paiement / 1ère échéance)
     - `invoice.paid` (renouvellements CB toutes les 4 semaines)
   - Copier le **Signing secret** (`whsec_...`) → variable Vercel `STRIPE_WEBHOOK_SECRET`

## Sync catalogue (automatique)

- **Sur Node/VPS** : sync Playwright au démarrage + toutes les 6h (`STORE_SYNC_INTERVAL_MS`)
- **Sur Vercel** : le bot pousse le catalogue via `POST /api/admin/ingest-catalog`
- **Cron Vercel** : `/api/cron/sync-catalog` (header `x-sync-secret`) — nécessite Playwright si activé

Le bot ([boxi-deci-bot](https://github.com/angoularaphael/boxi-deci-bot)) pousse le catalogue avec :

```
STORE_INGEST_URL=https://box-plus.vercel.app/api/admin/ingest-catalog
SYNC_SECRET=...
```

## Scripts locaux

```bash
npm install
npm run store:start      # Boutique :3040
npm run bridge:start     # Bridge :3030
npm run store:sync         # Sync manuelle (optionnel)
npm test
```

## Repo bot

Le RPA Deciplus (membre + RIB + abo + badge) vit dans **boxi-deci-bot**, déployé séparément sur BotHosting.
