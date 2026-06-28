# Scénario 07 — Gestion doublon

## Objectif
Comportement Deciplus quand l'email existe déjà.

## Étapes
1. `m duplicate-attempt` — tenter de créer un membre avec le même email que scénario 02
2. Noter message d'erreur ou proposition de fusion
3. `s duplicate-blocked`
4. `q`

## Résultat attendu pour le bot
- Cas bloquant → statut `manual_review`
- Cas fusion → mettre à jour fiche existante
