# Scénario 02 — Créer un membre

## Objectif
Capturer le payload de création client (fiche complète).

## Données test
| Champ | Valeur test |
|-------|-------------|
| Prénom | Test |
| Nom | BOXPLUS |
| Date naissance | 01/01/1990 |
| Sexe | M ou F |
| Email | test.boxplus+001@boxingcenter.fr |
| Téléphone | 0600000001 |
| Salle | Minimes |

## Étapes
1. `m navigate-members` — aller à la liste / création membres
2. `m create-member-form` — formulaire ouvert
3. Remplir tous les champs obligatoires
4. `m create-member-submit` — avant validation
5. `m create-member-done` — fiche créée
6. `s member-created`
7. `q`

## Livrables attendus
- Endpoint POST création membre
- Champs obligatoires vs optionnels
- ID membre retourné
