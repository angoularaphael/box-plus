# RIB manquant Deciplus — mise à jour 2026-09-07 (recherche élargie)

Audit **283 membres** prélèvement (juin → sept. 2026) + recherche Deciplus par nom.

## RIB manquant — prélèvement (à contacter)

| Nom | Membre | Email | Produit Deciplus | Action |
|-----|--------|-------|------------------|--------|
| kavocop kavo | 21733 | kavocop601@hebase.com | 259 € 4× ? | Mail Resend envoyé |
| Marie-Dou ETOGO | 20969 | emn.mariedelphine@hotmail.fr | OFFRE 29 € | Mail Resend envoyé |
| **Dalim Dalim** | 20990 | *(vide Deciplus)* | Étudiant 36,99 €/4 sem. | **Appel / accueil** |
| **Stéphane Bon** | 21046 | *(vide Deciplus)* | 44,99 €/4 sem. | **Appel / accueil** |
| **Tapinoy** | 21042 | *(vide Deciplus)* | 44,99 €/4 sem. | **Appel / accueil** |
| **Thomas Stanislas** | 21043 | *(vide Deciplus)* | 44,99 €/4 sem. + badge | **Appel / accueil** |

## Pas un problème RIB

| Nom | Membre | Note |
|-----|--------|------|
| **Stéphanie DEISS** | 21203 | **12 mois comptant** (Portet) — pas de RIB requis. Problème = **contrats « En attente »** en trop (bug bot août). Mail : stephaniedeiss@free.fr |

## Contrats « En attente »

- **12 mois comptant** : aucun « En attente » ne doit rester (sauf 259 € **4× prélèvement** où `3 EN ATTENTE 64,75 €` est normal).
- Script : `node scripts/fix-pending-comptant-12mois.js --apply`

## Bot maintenance prem-eu2

Dossier : `deploy/prem-eu2/` — `BOT_ROLE=ops`, port **21871**  
Vercel : `BOXPLUS_BOT_URL_OPS=https://prem-eu2.bot-hosting.net:21871`
