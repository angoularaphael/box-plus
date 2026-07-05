# SEO / Métadonnées / GEO — Boutique Boxing Center

Objectif : #1 organique sur les requêtes de marque, top 3 sur les requêtes
locales « boxe + Toulouse », et présence maximale dans les moteurs IA
(ChatGPT, Perplexity, Google AI Overviews).

## Architecture de mots-clés

| Famille | Exemples | Page cible | Ambition |
|---|---|---|---|
| Marque | boutique boxing center, boxing center toulouse | `/` | **#1** |
| Club local | club de boxe toulouse, salle de boxe toulouse, école de boxe toulouse, boxe débutant toulouse | `/` + `/abonnements` | Top 3 |
| Cours/essai | cours de boxe toulouse, séance d'essai boxe, boxe femme toulouse, boxe enfant toulouse | `/seance-essai`, `/abonnements` | Top 3 |
| Disciplines | mma toulouse, muay thaï toulouse, kickboxing toulouse, cross training toulouse | `/` (disciplines) + `/abonnements` | Top 5 |
| Transactionnel matériel | gants de boxe, bandes de boxe, matériel de boxe toulouse, acheter équipement boxe | `/materiel` + 43 fiches produit | Top 3 local |
| Longue traîne (GEO) | « la boxe est-elle violente », « quel matériel pour commencer la boxe » | `/faq` (FAQPage schema) | Citations IA |

## Ce qui est implémenté (on-site, `storefront/lib/seo.js`)

- **Domaine pilotable** : tout (canonicals, sitemap, OG, JSON-LD) est généré
  depuis `SITE_URL` (défaut `https://box-plus.vercel.app`). Passage au domaine
  final = **une seule variable d'environnement** sur Vercel.
- `robots.txt` dynamique — crawl ouvert (bots IA inclus), pages
  transactionnelles exclues, lien sitemap.
- `sitemap.xml` dynamique — 9 pages + les 43 produits du catalogue, lastmod réels.
- `llms.txt` — fiche d'identité du club pour les moteurs IA (GEO) : faits
  vérifiés uniquement (salles, adresses, prix d'appel, contact).
- **Fiches produit SEO** : URLs slug `/materiel/produit/<slug>`, titre +
  description + canonical + Open Graph + JSON-LD `Product/Offer` (prix, stock
  réels) + `BreadcrumbList` **injectés côté serveur** ; anciennes URLs `?id=`
  en 301.
- **JSON-LD par page** : Organization + WebSite + 5 `ExerciseGym` (adresses
  réelles) sur `/`, `Service` sur `/abonnements` et `/coachings`,
  `Product` 10 € sur `/seance-essai`, `ItemList` 43 produits sur `/materiel`,
  `FAQPage` (11 vraies Q/R) sur `/faq`.
- **Têtes de pages** : titres et descriptions uniques orientés mots-clés sur
  les 10 pages indexables ; OG/Twitter cards ; `theme-color` ; `noindex` sur
  panier/checkout/success/inscription/mon-inscription/contrat.
- **Hygiène canonique** : 301 `*.html` → URLs propres ; une seule version de
  chaque page.

## Ce qu'il reste à faire (off-site — actions humaines)

1. **Google Search Console** : vérifier la propriété, soumettre
   `https://<domaine>/sitemap.xml`, surveiller Couverture + Enrichissements
   (Produits, FAQ).
2. **Bing Webmaster Tools** : idem (alimente aussi ChatGPT/Copilot).
3. **Fiches Google Business Profile** pour les 5 salles — le levier n°1 sur
   « boxe toulouse » local. Ajouter le lien boutique sur chaque fiche.
4. **Lien depuis boxingcenter.fr** vers la boutique (menu « Boutique ») —
   transfert d'autorité du domaine historique.
5. **Domaine final** : idéalement `boutique.boxingcenter.fr` (hérite de
   l'autorité du domaine racine). Configurer `SITE_URL` sur Vercel.
6. **Migration PrestaShop** : au basculement, mettre en place les 301 des
   anciennes URLs produits PrestaShop vers les nouvelles fiches slug.
7. Relier les réseaux sociaux (bio Instagram/Facebook → boutique).

## Points de vigilance

- ⚠️ Le site vitrine liste désormais **6 salles (dont Balma-Gramont)** ; la
  boutique en vend 5. À clarifier avec le club avant d'élargir le schéma.
- La FAQ du schéma (`lib/seo.js`) doit rester synchronisée avec
  `public/js/faq.js`.
- Aucune donnée inventée dans le balisage (pas de fausses notes/avis —
  pénalisable). Les avis Google réels sont le prochain chantier.

## Vérification

- Rich Results Test : https://search.google.com/test/rich-results sur `/`,
  `/faq`, une fiche produit.
- `site:box-plus.vercel.app` pour suivre l'indexation.
- `curl /robots.txt`, `/sitemap.xml`, `/llms.txt` après chaque déploiement.
