# Scénario 05 — Vente Saison 259 €

## Objectif
Vente saison avec paiement en 4 fois si applicable.

## Étapes
1. `m open-sale-saison`
2. Sélectionner membre test
3. Rechercher produit saison / 259 €
4. `m payment-installments` si échéancier 4×
5. `m validate-sale-saison`
6. `s sale-saison-confirmed`
7. `q`
