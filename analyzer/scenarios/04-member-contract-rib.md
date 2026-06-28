# Scénario 04 — Contrat + RIB depuis fiche membre (SANS Caisse)

> Le module Caisse est désactivé sur Boxing Center.  
> Le coach passe par `check.php?idj=XXX` + wallet RIB + contrat.

## Prérequis
- Membre test existant : **ID 20898** (Test BOXPLUS)
- URL directe : https://boxingcenter.deciplus.pro/check.php?idj=20898

## Lancer
```powershell
npm run analyze:scenario -- 04-member-contract-rib
```

## Étapes avec le coach (à filmer / noter)

### 1. Ouvrir la fiche membre
- Aller sur `check.php?idj=20898`
```
m open-member-check
s fiche-membre
```

### 2. Saisir le RIB / IBAN
- Trouver le bouton wallet / RIB / prélèvement sur la fiche
```
m open-wallet-rib
```
- Saisir un IBAN test FR (ex: FR7630006000011234567890189)
```
m fill-iban
s rib-saved
```

### 3. Ajouter contrat / offre
- Depuis la fiche membre (PAS Caisse) :
  - cliquer Contrat / Abonnement / Vente
```
m add-contract
m select-product
```
- Choisir produit (DUO 29 € ou Saison 259 €)
```
m setup-echeances
```
- Si 4× : noter comment il configure 1ère CB + suivantes prélèvement

### 4. Fin
```
m contract-done
s contract-confirmed
q
```

## Après
```powershell
npm run analyze:report
```

Voir aussi : [WORKFLOW_SANS_CAISSE.md](../docs/WORKFLOW_SANS_CAISSE.md)
