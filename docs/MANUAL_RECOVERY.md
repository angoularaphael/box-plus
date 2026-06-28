# Procédure de reprise manuelle — BOXPLUS / Deciplus

## Quand utiliser cette procédure

- Statut commande : `manual_review` ou `error` après 3 tentatives
- Alertes webhook / logs indiquant un échec d'intégration
- Doublon membre non résolu automatiquement

## Étapes

1. **Identifier la commande**
   - Consulter `data/queue/processed-orders.json` ou les logs `logs/boxplus-YYYY-MM-DD.jsonl`
   - Noter `order_id`, email, téléphone, offre, salle

2. **Vérifier dans Deciplus**
   - Rechercher le membre par email puis téléphone
   - Vérifier si la vente existe déjà (éviter double facturation)

3. **Si membre absent**
   - Créer la fiche manuellement avec les champs du cahier des charges
   - Ajouter la note interne : source, UTM, numéro commande PrestaShop

4. **Si vente absente**
   - Saisir le produit correspondant (DUO 29 €, Saison 259 €, ou essai)
   - Enregistrer le paiement avec le bon moyen et montant

4. **Marquer comme traité**
   - Mettre à jour `processed-orders.json` avec `"status": "success"` et note `manual_fix`
   - Supprimer le fichier job restant dans `data/queue/` si présent

## Prévention double saisie

Avant toute saisie manuelle, vérifier que `order_id` n'est pas déjà en statut `success` dans `processed-orders.json`.

## Contact

En cas de blocage compte bot Deciplus : utiliser un compte staff et remonter au support Xplor Deciplus.
