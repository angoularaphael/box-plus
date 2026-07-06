# AMÉLIORATIONS — Route vers la position n°1

Objectif : être **1er résultat organique** sur « boutique boxing center » et les
requêtes de marque, **top 3 local** sur « boxe / club de boxe / cours de boxe /
salle de boxe / matériel de boxe + Toulouse », et **cité par les moteurs IA**
(ChatGPT, Perplexity, Google AI Overviews).

État : le socle technique on-site est **déployé et vérifié en production**
(box-plus.vercel.app). Ce qui suit est ce qui reste à faire, classé par impact.

---

## 1. Actions immédiates (humaines, cette semaine) — le plus gros levier

- [ ] **Google Search Console** — <https://search.google.com/search-console>
  1. Ajouter la propriété `https://box-plus.vercel.app` (méthode « balise HTML »)
  2. Copier le token dans Vercel → Settings → Environment Variables →
     `GOOGLE_SITE_VERIFICATION` → redéployer → « Vérifier »
  3. Soumettre le sitemap : `https://box-plus.vercel.app/sitemap.xml`
  4. Demander l'indexation manuelle de `/`, `/abonnements`, `/materiel`
- [ ] **Bing Webmaster Tools** — <https://www.bing.com/webmasters>
  (alimente aussi ChatGPT/Copilot) — même procédé avec `BING_SITE_VERIFICATION`,
  ou import direct depuis Search Console (1 clic)
- [ ] **Fiches Google Business Profile pour les 5 salles** — levier n°1 sur les
  requêtes locales « boxe toulouse » :
  revendiquer/créer les 5 fiches (Minimes, Ramonville, États-Unis,
  Saint-Cyprien, Portet), catégorie « Club de boxe / Salle de sport », photos
  réelles, horaires, téléphone 05 62 24 46 82, et **lien vers la boutique**
  sur chaque fiche. Répondre aux avis (signal d'activité).
- [ ] **Lien « Boutique » sur boxingcenter.fr** (menu principal + footer) —
  transfert d'autorité du domaine historique ; c'est le backlink le plus
  précieux qu'on puisse obtenir.
- [ ] **Cohérence des faits** : boxingcenter.fr affiche encore 6 salles —
  retirer Balma-Gramont (vendue). Google recoupe les informations d'entité.
- [ ] **Réseaux sociaux** : lien boutique dans les bios Instagram / Facebook /
  YouTube / LinkedIn.

## 2. Domaine (fort impact, dès que décidé)

- [ ] Passer sur **`boutique.boxingcenter.fr`** (hérite de l'autorité du
  domaine principal). Techniquement : ajouter le domaine dans Vercel + changer
  **une seule variable** `SITE_URL` — canonicals, sitemap, Open Graph et
  JSON-LD suivent automatiquement.
- [ ] Rediriger 301 `box-plus.vercel.app` → nouveau domaine (Vercel le gère).
- [ ] **Migration PrestaShop** : au basculement de `boutique.boxingcenter.fr`,
  mapper en 301 les anciennes URLs produits PrestaShop vers les nouvelles
  fiches `/materiel/produit/<slug>` (conserver l'historique de ranking).

## 3. Contenu (on-site, prochaines itérations)

- [ ] **Avis multi-salles** : les 6 témoignages actuels sont de vrais avis
  Google (Minimes). Récolter des avis des 4 autres salles pour équilibrer
  (`storefront/public/data/testimonials.json`).
- [ ] **Adresse exacte de Portet** : la rue manque dans le schéma ExerciseGym
  (`storefront/lib/seo.js` → `SALLES`) — demander au club.
- [ ] **Avis first-party** : à terme, collecter des avis directement sur la
  boutique (post-achat) → permet un `aggregateRating` légitime dans le schéma
  (interdit avec des avis copiés de Google).
- [ ] **Guides d'achat** (longue traîne transactionnelle + GEO) : « Comment
  choisir ses gants de boxe », « Quel matériel pour débuter la boxe », « Boxe
  anglaise ou kickboxing : que choisir ». Chaque guide = une page indexable
  qui pousse vers `/materiel` et `/abonnements`.
- [ ] **Rendu serveur des blocs JS restants** (offres à la une, cartes salles,
  témoignages sur la home) — Google les voit, mais pas les crawlers IA.
  Le `<noscript>` couvre l'essentiel ; le SSR complet est l'étape « parfait ».
- [ ] **Synchronisation FAQ** : toute modification de la FAQ doit être faite à
  3 endroits : `public/js/faq.js`, `public/faq.html` (HTML statique) et
  `lib/seo.js` (schéma FAQPage). Idéalement, factoriser en une source unique.

## 4. Technique / performance

- [ ] **Audit Lighthouse mobile** (PageSpeed Insights sur l'URL de prod) —
  mesurer LCP/CLS/INP après les corrections fonts + preload. Objectif : > 90.
- [ ] Cache headers longs sur les assets statiques (config Vercel).
- [ ] `srcset` responsive sur les images de la home (mobile télécharge
  aujourd'hui les images desktop).
- [ ] Page 404 propre (actuellement réponse générique).

## 5. Suivi hebdomadaire (15 min)

- [ ] Search Console → Couverture (pages indexées vs 52 soumises),
  Enrichissements (Produits, FAQ, Fils d'Ariane), Requêtes (positions).
- [ ] Vérifier `site:box-plus.vercel.app` sur Google (progression indexation).
- [ ] Tester une fiche produit + la FAQ dans le
  [Rich Results Test](https://search.google.com/test/rich-results).
- [ ] Après chaque grosse mise à jour de contenu, re-ping IndexNow :
  ```bash
  curl -s "https://api.indexnow.org/indexnow?url=https://box-plus.vercel.app/&key=a7c31f2b9e584d06b8a2c94f7d1e6503"
  ```

## Mots-clés cibles (rappel)

| Famille | Exemples | Page | Ambition |
|---|---|---|---|
| Marque | boutique boxing center, boxing center toulouse | `/` | **n°1** |
| Club local | club/salle/école de boxe toulouse, boxe débutant | `/`, `/abonnements` | Top 3 |
| Cours & essai | cours de boxe toulouse, séance d'essai boxe, boxe femme/enfant | `/seance-essai`, `/abonnements` | Top 3 |
| Disciplines | mma / muay thaï / kickboxing / cross training toulouse | `/` + `/abonnements` | Top 5 |
| Matériel | gants de boxe, bandes, matériel de boxe toulouse | `/materiel` + 43 fiches | Top 3 local |
| Longue traîne | « la boxe est-elle violente », « quel matériel pour débuter » | `/faq`, guides | Citations IA |

## Jalons réalistes

1. **J+2 à J+7 après Search Console** : pages indexées, marque « boutique
   boxing center » en 1re page.
2. **Semaines 2-4** : n°1 sur la marque ; rich results produits/FAQ visibles ;
   premières impressions sur les requêtes locales.
3. **Mois 1-3** : top 3 local sur « club de boxe toulouse » et dérivés — à
   condition que les fiches Google Business + le lien boxingcenter.fr soient
   en place (c'est le facteur limitant, pas le site).

## Variables d'environnement (référence)

| Variable | Rôle | Valeur actuelle |
|---|---|---|
| `SITE_URL` | Domaine canonique (tout en découle) | `https://box-plus.vercel.app` (défaut) |
| `GOOGLE_SITE_VERIFICATION` | Balise Search Console | à renseigner |
| `BING_SITE_VERIFICATION` | Balise Bing Webmaster | à renseigner |
| `INDEXNOW_KEY` | Clé IndexNow (rotation possible) | `a7c31f2b…` (défaut) |
