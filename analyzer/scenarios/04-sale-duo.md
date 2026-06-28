# Scénario 04 — Vente Offre DUO 29 €

## Objectif
Enregistrer une vente DUO avec paiement CB en ligne.

## Prérequis
Membre test créé (scénario 02).

## Étapes
1. `m open-sale` — ouvrir interface vente / caisse
2. `m select-member` — rattacher le membre test
3. `m search-product-duo` — rechercher produit 29 € / DUO
4. `m add-product-duo` — produit ajouté au panier
5. `m payment-card` — mode paiement CB / en ligne
6. `m validate-sale` — valider la vente
7. `s sale-duo-confirmed`
8. `q`

## À noter
- Nom exact du produit Deciplus
- Montant affiché vs payé
- ID vente généré
