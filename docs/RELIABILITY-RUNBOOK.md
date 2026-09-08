# Fiabilité boutique → Deciplus

## Déploiement (ordre obligatoire)

1. Exécuter `supabase/008_boxplus_job_reliability.sql` dans le SQL Editor Supabase (ou via la CLI liée au projet).
   Si 008 est déjà en place et que les ventes bloquent avec `column reference "attempt" is ambiguous`, exécuter `supabase/009_boxplus_job_reliability_attempt.sql`.
2. Vérifier que le compte `service_role` peut appeler `boxplus_acquire_job_action`.
3. Configurer chaque bot avec `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, un `BOT_ID` unique et les secrets existants.
4. Déployer la boutique Vercel, puis redéployer/redémarrer chaque bot.
5. Appeler `/health` sur chaque bot : `ready` et `persistent_idempotency.available` doivent être `true`; vérifier `git_sha`/`build_id`.
6. Configurer `ALERT_WEBHOOK_URL` et/ou `ALERT_EMAIL` + `RESEND_API_KEY`.

Ne jamais contourner un registre indisponible : le bot bloque volontairement les nouvelles ventes Deciplus jusqu’au déploiement de la migration.

## États

`PAID → DOSSIER_COMPLETE → SIGNED → MEMBER_CREATED → MANDATE_SET → SALE_CREATED → VERIFIED`.
Toute étape peut finir en `MANUAL_REVIEW` ou `FAILED`. Une commande sans signature/`ready_for_dispatch` n’est jamais éligible à la création membre/vente.

## Incidents

- **Membre créé sans signature** : ne pas créer de vente. Vérifier identité et commande, placer en revue manuelle, contacter le client pour terminer la signature. Ne supprimer la fiche qu’après validation manager.
- **IBAN absent/invalide** : corriger côté client/boutique, puis relancer une seule fois. L’erreur est non retryable et ne doit pas consommer douze tentatives.
- **Abonnement pending/actif en double** : ne pas relancer. Comparer offre, dates et `sale_id`; un manager choisit le contrat à conserver et résilie explicitement l’autre.
- **Succès sans `sale_id` / callback perdu** : consulter `boxplus_job_actions`. Si `sale_id` existe, resynchroniser la boutique; sinon vérifier les contrats Deciplus avant toute relance.
- **Mauvais membre trouvé** : stopper le job, comparer nom/prénom/date de naissance/téléphone et salle. Corriger manuellement le lien; ne jamais fusionner automatiquement.
- **Migration de salle échouée** : vérifier la zone de la fiche et la salle commandée. Migrer manuellement, puis relancer uniquement la vente avec le bon `member_id`.
- **Badge échoué** : vérifier le contrat principal et la présence d’un badge existant. Ajouter/corriger le badge manuellement sans recréer l’abonnement.

## Audit et compensation

`npm run audit:reliability` produit uniquement du JSON structuré et ne modifie rien. Les commandes payées non signées figurent dans `compensation`; aucune vente Deciplus n’est jamais annulée automatiquement.

Catégories surveillées : payé+non signé+membre, signé+sans vente, succès+sans `sale_id`, vente+mandat absent, abonnements pending/actifs en double, badge sans contrat attendu.

Pour les alertes, envoyer les entrées `severity=critical` vers le webhook configuré. Les journaux `job_event:*` contiennent seulement les identifiants techniques, phases, tentatives, classification et durées; IBAN, tokens et secrets sont masqués.
