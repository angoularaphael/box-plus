# Rattrapage essai → abonnement (Lucas Bidart et similaires)

**Date :** 2026-09-07

## Lucas Bidart

| Étape | Commande | Statut |
|-------|----------|--------|
| Séance d'essai 10 € | `BC-1788175158504-e97d1f` | `success` — membre **21551**, vente essai **42844** |
| Offre 29 € | `BC-1788289146195-872849` | Corrigé → **`success`** |

### Deciplus (déjà correct avant sync)

- Abonnement **43001** — OFFRE DUO 29 €
- Badge **43002**
- RIB **FR7640618803560004095684908** — RUM `MND-WDU36W3MP5`

**Problème :** la vente Deciplus était OK, mais Supabase restait en `manual_review` sans message d’erreur (faux positif admin).

**Action :** sync statut `success` via `applyBotSaleStatus` — pas de nouvelle vente Deciplus.

## Autres cas « comme Lucas »

Recherche automatique (depuis juin 2026) :

- Essai puis offre 29 € payée, `manual_review` avec vente + membre : **1 seul cas (Lucas)** — corrigé.
- Même membre Deciplus avec essai + abo bloqué : **0**.
- Abo payé avec IDs Deciplus mais pas `success` (hors 12 mois comptant) : **6** cas restants (erreurs IBAN / vente non confirmée — pas le même profil essai→29).

## Script de contrôle

```bash
# Rechercher essai → 29 € encore en manual_review
node -e "..." # voir scripts/audit-send-missing-rib.js ou sync-missing-fiches-from-deciplus.js
```

Pour un cas type Lucas (Deciplus OK, admin bloqué) :

```bash
node -e "
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE='1';
const { applyBotSaleStatus } = require('./storefront/lib/order-lifecycle');
applyBotSaleStatus('BC-1788289146195-872849', {
  status: 'success',
  deciplus_member_id: '21551',
  deciplus_sale_id: '43001',
  error: null,
});
"
```
