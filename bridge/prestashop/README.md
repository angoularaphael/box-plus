# PrestaShop → BOXPLUS (100 % JavaScript)

Le module PHP `prestashop-module/` est **obsolète**. L’intégration se fait entièrement en Node.js :

```
Nouveau PrestaShop
    │
    ├─ Thème : theme-checkout.js (salle, IBAN, DOB)
    │         POST /bridge/prestashop/checkout
    │
    ├─ API Webservice PrestaShop (clé API)
    │         bridge/prestashop-sync.js (poll)
    │
    └─ bridge/server.js → file BOXPLUS → bot Deciplus
```

## 1. PrestaShop — activer l’API

1. Back-office → **Paramètres avancés → Webservice**
2. Activer le webservice
3. Créer une clé API avec droits **orders**, **customers**, **addresses**, **messages** (lecture)

## 2. Bridge BOXPLUS (.env)

```env
BRIDGE_PORT=3030
BRIDGE_SECRET=votre-secret-hmac
PRESTASHOP_URL=https://boutique.boxingcenter.fr
PRESTASHOP_API_KEY=XXXXXXXX
PRESTASHOP_PAID_STATE_IDS=2
PRESTASHOP_DEFAULT_GYM=minimes
PRESTASHOP_SYNC_MS=60000
PRESTASHOP_SYNC_ENABLED=true
BRIDGE_AUTO_BOT=true
```

`PRESTASHOP_PAID_STATE_IDS` = IDs états « Paiement accepté » (souvent `2`, vérifier dans PS).

## 3. Démarrer

```powershell
cd BOXPLUS
npm run bridge:start
```

- Sync automatique toutes les 60 s
- Bot Deciplus sur la même file que la boutique Stripe

Sync manuelle :

```powershell
npm run prestashop:sync
```

## 4. Thème PrestaShop — checkout JS

Dans le thème enfant, ajouter avant `</body>` sur la page commande :

```html
<script>
  window.BOXPLUS_BRIDGE_URL = 'https://votre-serveur-bridge:3030';
  window.BOXPLUS_BRIDGE_SECRET = 'votre-secret-hmac';
</script>
<script src="https://votre-cdn-ou-bridge/boxplus/theme-checkout.js"></script>
```

Ou copier `bridge/prestashop/theme-checkout.js` dans `/themes/votre-theme/assets/js/`.

Le script ajoute **Salle**, **IBAN**, **Date de naissance**, **Sexe** et les envoie au bridge liés au `cart_id`.

## 5. Noms produits

Comme la boutique Stripe : le **nom produit PrestaShop = nom Deciplus** exact  
(ex. `OFFRE A 29€`, `COMPTANT 12 MOIS`).

## 6. Webhook legacy (optionnel)

`POST /bridge/webhook` reste disponible pour tests ou outils tiers — payload déjà au format BOXPLUS.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `lib/prestashop-client.js` | Client API Webservice |
| `lib/prestashop-map.js` | Commande PS → payload BOXPLUS |
| `lib/prestashop-checkout-store.js` | Salle/IBAN par panier (thème JS) |
| `lib/gym-slugs.js` | Slugs salles (alignés bot) |
| `bridge/prestashop-sync.js` | Poll commandes payées |
| `bridge/server.js` | HTTP + sync + bot |
