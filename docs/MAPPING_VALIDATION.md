# Validation mappings — à confirmer avec le coach

## Produits Deciplus

| Offre tunnel | SKU PrestaShop | Nom Deciplus (draft) | Montant | Validé coach |
|--------------|----------------|----------------------|---------|--------------|
| DUO | OFFRE-DUO-29 | Offre 29 € | 29 € | ☐ |
| Saison | OFFRE-SAISON-259 | Saison | 259 € | ☐ |
| Essai | SEANCE-ESSAI | Séance d'essai | 0 € | ☐ |

Fichier source : [`config/product-mapping.json`](../config/product-mapping.json)

## Salles

| Slug BOXPLUS | Label | Label Deciplus | Validé |
|--------------|-------|----------------|--------|
| minimes | Boxing Center Minimes | Minimes | ☐ |
| ramonville | Boxing Center Ramonville | Ramonville | ☐ |
| st-cyprien | Boxing Center St-Cyprien | St-Cyprien | ☐ |
| etats-unis | Boxing Center États-Unis | États-Unis | ☐ |
| portet | Boxing Center Portet | Portet | ☐ |

Fichier source : [`config/gym-mapping.json`](../config/gym-mapping.json)

## Action requise

Après enregistrement réel Deciplus (`npm run analyze:record`), mettre à jour les champs `deciplus_product_name` et `deciplus_label` avec les libellés exacts visibles dans l'interface.
