/**
 * Boxing Center — SEO / metadata / GEO layer.
 *
 * Registers, ahead of the generic page routes:
 *  - /robots.txt, /sitemap.xml, /llms.txt (all built from SITE_URL)
 *  - /materiel/produit/:slugOrId  → product page with server-injected
 *    <title>, description, canonical, Open Graph and Product/Breadcrumb
 *    JSON-LD built from the real catalog (price, stock, images)
 *  - canonical + og:url/og:image + robots hints + per-page JSON-LD
 *    injection for every indexable page
 *  - 301s: *.html → clean URL, /materiel/produit?id=X → /materiel/produit/<slug>
 *
 * The deploy domain is ONE env var: SITE_URL (no trailing slash).
 * Switching to the final domain later = set SITE_URL, nothing else.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SITE_URL = (process.env.SITE_URL || 'https://box-plus.vercel.app').replace(/\/+$/, '');

// IndexNow (Bing/Yandex instant indexing — also feeds ChatGPT/Copilot search).
// The key file must be served at /<key>.txt; override via env if rotated.
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'a7c31f2b9e584d06b8a2c94f7d1e6503';

// Static require so Vercel's file tracing bundles the catalog.
const RAW_CATALOG = require('../../data/storefront/materiel-catalog.json');
const CATALOG = (Array.isArray(RAW_CATALOG) ? RAW_CATALOG : RAW_CATALOG.products || RAW_CATALOG.items || [])
  .filter((p) => p && p.active !== false);

/* ────────────────────────────────────────────────────────────────────
   Verified business facts (boxingcenter.fr + cahier des charges).
   Do NOT add numbers that cannot be proven.
   ──────────────────────────────────────────────────────────────────── */
const BUSINESS = {
  name: 'Boxing Center',
  legalName: 'Boxing Center Toulouse',
  telephone: '+33562244682',
  email: 'boxingcenter31@gmail.com',
  foundingDate: '2016-09-01',
  sameAs: [
    'https://boxingcenter.fr',
    'https://www.facebook.com/BoxingCenterToulouse/',
    'https://www.instagram.com/boxingcentertoulouse/',
    'https://www.youtube.com/@boxingcentertoulouse6983',
    'https://fr.linkedin.com/company/boxing-center',
  ],
  openingHours: 'Mo-Sa 10:00-21:30',
};

const SALLES = [
  { name: 'Minimes', street: '12 rue de Fenouillet', postal: '31200', city: 'Toulouse', image: '/img/bc/gym/gym-01.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/' },
  { name: 'Ramonville', street: '33 rue des Ormes', postal: '31520', city: 'Ramonville-Saint-Agne', image: '/img/bc/gym/gym-06.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-ramonville/' },
  { name: 'États-Unis', street: '388 avenue des États-Unis', postal: '31200', city: 'Toulouse', image: '/img/bc/gym/gym-11.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/' },
  { name: 'Saint-Cyprien', street: '11 rue Sainte-Lucie', postal: '31300', city: 'Toulouse', image: '/img/bc/gym/gym-16.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-saint-cyprien/' },
  /* Portet : adresse canonique (aussi gym-mapping / welcome-knowledge).
     Portet publie son propre numéro, distinct du réseau. */
  { name: 'Portet', street: '61 route d\'Espagne', postal: '31120', city: 'Portet-sur-Garonne', telephone: '+33687900216', image: '/img/bc/gym/portet-exterior.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-portet-sur-garonne-2/' },
];

const DISCIPLINES = [
  'Boxe anglaise', 'Boxe thaï', 'Kickboxing', 'MMA',
  'Cross training', 'Boxing Lady', 'Boxe éducative', 'Fitness boxing',
];

// Keep in sync with public/js/faq.js (FAQ_ITEMS).
const FAQ = [
  ['Je suis débutant, puis-je m\'inscrire ?', 'Oui, absolument ! Boxing Center est un club accessible aux débutants. Nos coachs adaptent les cours à chaque niveau. Vous n\'avez pas besoin d\'avoir déjà pratiqué la boxe ni d\'être en forme pour commencer.'],
  ['Est-ce que les cours sont violents ?', 'Non. Boxing Center est orienté loisir, apprentissage et remise en forme — pas la compétition professionnelle. Les entraînements sont encadrés, progressifs et dans une ambiance bienveillante. On peut pratiquer sans chercher à prendre de mauvais coups.'],
  ['Dois-je avoir déjà pratiqué la boxe ?', 'Pas du tout. La majorité de nos nouveaux adhérents découvrent la boxe chez nous. La séance d\'essai est idéale pour faire vos premiers pas.'],
  ['Les femmes peuvent-elles participer à tous les cours ?', 'Oui, les femmes sont les bienvenues dans tous nos cours collectifs. Nos groupes sont mixtes et l\'encadrement veille à un environnement respectueux et motivant.'],
  ['Puis-je accéder aux 5 salles ?', 'Selon votre formule, votre abonnement donne accès à nos 5 centres : Minimes, Ramonville, États-Unis, Saint-Cyprien et Portet. Vous choisissez une salle principale à l\'inscription.'],
  ['Quelle formule choisir pour commencer ?', 'Pour tester : la séance d\'essai à 10 €. Pour la flexibilité : le prélèvement sans engagement. Pour économiser sur 12 mois : 259 €. Pour votre enfant : Baby Boxe ou Boxe éducative.'],
  ['Comment fonctionne la séance d\'essai ?', 'Réservez en ligne gratuitement. Un coach vous accueille, vous explique le déroulé et vous participez à un cours adapté aux débutants. Aucun matériel spécifique n\'est requis pour commencer.'],
  ['Comment fonctionne le paiement par prélèvement ?', 'Vous payez la première échéance par carte bancaire, puis indiquez vos coordonnées bancaires pour les échéances suivantes. La formule est sans engagement — renouvelable toutes les 4 semaines.'],
  ['Puis-je payer toutes les 4 semaines par carte ?', 'Oui, sur les formules sans engagement vous pouvez régler la première échéance par carte ou PayPal, puis les suivantes par prélèvement sans engagement. Simple, flexible, sans engagement longue durée.'],
  ['Puis-je résilier une formule sans engagement ?', 'Oui, les formules sans engagement peuvent être résiliées selon les conditions prévues au contrat. Contactez votre salle pour les démarches.'],
  ['Quel matériel faut-il pour commencer ?', 'Pour votre premier cours : tenue de sport et bouteille d\'eau suffisent. Nous vous conseillerons ensuite pour les gants et bandages — disponibles à la boutique du club.'],
  ['Mon enfant peut-il s\'inscrire ?', 'Oui ! Baby Boxe accueille les 3-6 ans et la Boxe éducative les 7-16 ans. L\'encadrement est adapté à chaque tranche d\'âge.'],
];

const DEFAULT_OG_IMAGE = '/img/bc/og-default.jpg'; // 1200x630, generated from gym-01

/* ── JSON-LD builders ─────────────────────────────────────────────── */

function openingHoursSpec() {
  return [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '10:00', closes: '21:30' },
  ];
}

function orgJsonLd() {
  return {
    '@type': ['SportsOrganization', 'LocalBusiness', 'SportsActivityLocation'],
    '@id': `${SITE_URL}/#org`,
    name: BUSINESS.name,
    alternateName: BUSINESS.legalName,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/img/bc/logo/BC_Logo_Officiel_Transparent.png`,
    image: `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    foundingDate: BUSINESS.foundingDate,
    telephone: BUSINESS.telephone,
    email: BUSINESS.email,
    sameAs: BUSINESS.sameAs,
    sport: 'Boxe',
    priceRange: '€€',
    currenciesAccepted: 'EUR',
    paymentAccepted: 'Cash, Credit Card, PayPal',
    areaServed: [
      { '@type': 'City', name: 'Toulouse' },
      { '@type': 'AdministrativeArea', name: 'Haute-Garonne' },
    ],
    address: {
      '@type': 'PostalAddress',
      streetAddress: '12 rue de Fenouillet',
      postalCode: '31200',
      addressLocality: 'Toulouse',
      addressRegion: 'Occitanie',
      addressCountry: 'FR',
    },
    openingHoursSpecification: openingHoursSpec(),
    hasMap: 'https://boxingcenter.fr',
    knowsAbout: DISCIPLINES,
  };
}

function gymsJsonLd() {
  return SALLES.map((s) => ({
    '@type': ['ExerciseGym', 'SportsActivityLocation', 'LocalBusiness'],
    '@id': `${SITE_URL}/#gym-${s.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}`,
    name: `Boxing Center — ${s.name}`,
    url: s.url || `${SITE_URL}/`,
    image: `${SITE_URL}${s.image}`,
    telephone: s.telephone || BUSINESS.telephone,
    priceRange: '€€',
    parentOrganization: { '@id': `${SITE_URL}/#org` },
    address: {
      '@type': 'PostalAddress',
      ...(s.street ? { streetAddress: s.street } : {}),
      postalCode: s.postal,
      addressLocality: s.city,
      addressRegion: 'Occitanie',
      addressCountry: 'FR',
    },
    openingHoursSpecification: openingHoursSpec(),
    areaServed: { '@type': 'City', name: s.city },
  }));
}

const PAGE_JSONLD = {
  '/': () => ({
    '@context': 'https://schema.org',
    '@graph': [
      orgJsonLd(),
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: 'Boutique Boxing Center Toulouse',
        alternateName: 'Boxing Center — boutique officielle',
        description: 'Boutique officielle Boxing Center Toulouse : abonnements boxe, séance d\'essai à 10 €, coachings et matériel. 5 salles en Haute-Garonne.',
        inLanguage: 'fr-FR',
        publisher: { '@id': `${SITE_URL}/#org` },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_URL}/materiel?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      ...gymsJsonLd(),
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq-home`,
        mainEntity: FAQ.slice(0, 6).map(([q, a]) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ],
  }),
  '/abonnements': () => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Abonnement boxe — Boxing Center Toulouse',
    serviceType: 'Abonnement salle de boxe',
    provider: { '@id': `${SITE_URL}/#org` },
    areaServed: [
      { '@type': 'City', name: 'Toulouse' },
      { '@type': 'City', name: 'Ramonville-Saint-Agne' },
      { '@type': 'City', name: 'Portet-sur-Garonne' },
    ],
    description: `Abonnements boxe à Toulouse : comptant 3, 6 ou 12 mois, prélèvement sans engagement, formules enfants (Baby Boxe, Boxe éducative). Accès aux 5 salles, ${DISCIPLINES.length} disciplines : ${DISCIPLINES.join(', ')}.`,
    url: `${SITE_URL}/abonnements`,
  }),
  '/seance-essai': () => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Séance d\'essai boxe — Boxing Center Toulouse',
    description: 'Découvrez Boxing Center avec une séance d\'essai à 10 € : cours encadré par un coach, adapté aux débutants, dans l\'une de nos 5 salles à Toulouse.',
    image: `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    brand: { '@type': 'Brand', name: BUSINESS.name },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/seance-essai`,
      category: 'Free',
    },
  }),
  '/coachings': () => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Coaching boxe individuel — Boxing Center Toulouse',
    serviceType: 'Coaching sportif individuel (boxe)',
    provider: { '@id': `${SITE_URL}/#org` },
    areaServed: { '@type': 'City', name: 'Toulouse' },
    url: `${SITE_URL}/coachings`,
  }),
  '/materiel': () => ({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Matériel et équipement de boxe — Boutique Boxing Center',
    numberOfItems: CATALOG.length,
    itemListElement: CATALOG.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: `${SITE_URL}/materiel/produit/${encodeURIComponent(p.slug || p.id)}`,
    })),
  }),
  '/faq': () => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }),
  '/offres-speciales': () => ({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Offres spéciales boxe — Boxing Center Toulouse',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        url: `${SITE_URL}/offre/259`,
        name: 'Abonnement 12 mois — 259 €',
      },
      {
        '@type': 'ListItem',
        position: 2,
        url: `${SITE_URL}/offre/29`,
        name: 'Abonnement dès 29,99 € — première échéance',
      },
    ],
  }),
  '/offre/259': () => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Abonnement boxe 12 mois — 259 €',
    description:
      "Un an d'accès illimité aux 5 salles Boxing Center Toulouse pour 259 €. Paiement en 1× ou en 4× sans frais.",
    image: `${SITE_URL}/img/bc/offers/offre-259.webp`,
    brand: { '@type': 'Brand', name: BUSINESS.name },
    offers: {
      '@type': 'Offer',
      price: '259.00',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/offre/259`,
    },
  }),
  '/offre/29': () => ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Abonnement boxe dès 29,99 € — Boxing Center Toulouse',
    description:
      'Première échéance à 29,99 € puis prélèvement sans engagement. Accès aux 5 salles Boxing Center Toulouse.',
    image: `${SITE_URL}/img/bc/offers/offre-29.webp`,
    brand: { '@type': 'Brand', name: BUSINESS.name },
    offers: {
      '@type': 'Offer',
      price: '29.99',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/offre/29`,
    },
  }),
};

/* ── Indexable routes: canonical/OG/sitemap config ────────────────── */

const INDEXABLE = {
  '/': { file: 'index.html', priority: '1.0', changefreq: 'weekly' },
  '/abonnements': { file: 'abonnements.html', priority: '0.9', changefreq: 'weekly' },
  '/seance-essai': { file: 'seance-essai.html', priority: '0.9', changefreq: 'monthly' },
  '/materiel': { file: 'materiel.html', priority: '0.9', changefreq: 'weekly' },
  '/coachings': { file: 'coachings.html', priority: '0.8', changefreq: 'monthly' },
  '/faq': { file: 'faq.html', priority: '0.7', changefreq: 'monthly' },
  '/offres-speciales': { file: 'offres-speciales.html', priority: '0.95', changefreq: 'weekly' },
  '/offre/259': {
    file: 'offre-259.html',
    priority: '0.95',
    changefreq: 'weekly',
    ogImage: '/img/bc/offers/offre-259.webp',
    ogImageAlt: 'Offre abonnement boxe 12 mois 259 euros Boxing Center',
  },
  '/offre/29': {
    file: 'offre-29.html',
    priority: '0.95',
    changefreq: 'weekly',
    ogImage: '/img/bc/offers/offre-29.webp',
    ogImageAlt: 'Offre abonnement boxe 29 euros Boxing Center',
  },
  '/cgv': { file: 'cgv.html', priority: '0.3', changefreq: 'yearly' },
  '/reglement-interieur': { file: 'reglement-interieur.html', priority: '0.3', changefreq: 'yearly' },
  '/politique-confidentialite': { file: 'legal/confidentialite.html', priority: '0.3', changefreq: 'yearly' },
};

/* ── Vidéos indexables : VideoObject + sitemap vidéo + og:video ────────
 *
 * Google ne REGARDE pas une vidéo : il lit ce qu'on écrit autour d'elle.
 * Poser un <video> dans une page n'apporte donc rien au référencement
 * tant que trois choses ne disent pas la même :
 *   1. un VideoObject dans le JSON-LD de la page qui la porte,
 *   2. une entrée <video:video> dans le sitemap,
 *   3. une miniature servie en 200, non bloquée par robots.txt.
 *
 * `uploadDate` est OBLIGATOIRE côté Google — sans elle, aucun résultat
 * enrichi. Au sens de schema.org c'est la date de mise en ligne SUR CE
 * SITE : on écrit donc la date de publication ici, pas celle de YouTube,
 * qu'on n'a de toute façon aucun moyen de vérifier depuis le fichier
 * (YouTube réencode et efface `creation_time`).
 *
 * Une entrée reste INERTE tant que son fichier n'est pas sur le disque.
 * Déclarer une vidéo absente ferait indexer un 404 : c'est plus coûteux
 * que de ne rien déclarer du tout.
 *
 * Champs : file (dans public/media/), poster (chemin absolu du site),
 * name (≤ 100 car., contrainte sitemap), description, seconds, width,
 * height, uploadDate (AAAA-MM-JJ).
 *
 * Recette d'encodage, à garder identique d'une vidéo à l'autre :
 *   ffmpeg -ss <départ> -i "source.mp4" \
 *     -vf "scale=720:-2:flags=lanczos,fps=30" \
 *     -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -profile:v high \
 *     -c:a aac -b:a 112k -movflags +faststart "sortie.mp4"
 *   (+faststart déplace l'index en tête : la lecture démarre avant la fin
 *    du téléchargement. Sans lui, le visiteur attend le fichier entier.)
 */
const VIDEOS = {
  '/offre/259': {
    file: 'boxing-center-trophy-toulouse.mp4',
    poster: '/img/bc/video/boxing-center-trophy-toulouse.jpg',
    name: 'Boxing Center Trophy — la soirée de combats du club, à Toulouse',
    description:
      "Le Boxing Center Trophy, la soirée de combats organisée par le club à Toulouse : la préparation "
      + "au vestiaire, l'entrée des boxeurs, les assauts sur le ring et le public venu en famille. "
      + "Ceux qui montent sont les licenciés qui s'entraînent toute l'année dans les salles Boxing Center "
      + 'de Toulouse et de son agglomération.',
    seconds: 108,
    width: 1280,
    height: 720,
    uploadDate: '2026-08-12',
  },
};

/* Durée ISO 8601 : Google refuse la valeur en secondes dans le JSON-LD. */
function iso8601Duration(seconds) {
  const s = Math.max(1, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `PT${m ? `${m}M` : ''}${s % 60}S`;
}

function videoFor(route, publicDir) {
  const v = VIDEOS[route];
  if (!v) return null;
  try {
    fs.statSync(path.join(publicDir, 'media', v.file));
  } catch (_) {
    return null; // fichier absent : on ne déclare rien
  }
  return v;
}

function videoJsonLd(v) {
  return {
    '@type': 'VideoObject',
    name: v.name,
    description: v.description,
    thumbnailUrl: [`${SITE_URL}${v.poster}`],
    uploadDate: v.uploadDate,
    duration: iso8601Duration(v.seconds),
    contentUrl: `${SITE_URL}/media/${v.file}`,
    width: v.width,
    height: v.height,
    inLanguage: 'fr-FR',
    isFamilyFriendly: true,
    publisher: {
      '@type': 'Organization',
      name: BUSINESS.name,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}${DEFAULT_OG_IMAGE}` },
    },
    /* La vidéo montre les salles : on la rattache au lieu, c'est ce qui
       la fait remonter sur les requêtes locales (« salle de boxe Toulouse »). */
    contentLocation: { '@type': 'City', name: 'Toulouse' },
  };
}

/* Extension vidéo du sitemap. Contraintes Google respectées ici :
   titre ≤ 100 caractères, description ≤ 2048, durée entre 1 et 28800 s. */
function videoSitemapBlock(v) {
  return [
    '',
    '    <video:video>',
    `      <video:thumbnail_loc>${esc(SITE_URL + v.poster)}</video:thumbnail_loc>`,
    `      <video:title>${esc(v.name.slice(0, 100))}</video:title>`,
    `      <video:description>${esc(v.description.slice(0, 2048))}</video:description>`,
    `      <video:content_loc>${esc(`${SITE_URL}/media/${v.file}`)}</video:content_loc>`,
    `      <video:duration>${Math.max(1, Math.round(v.seconds))}</video:duration>`,
    `      <video:publication_date>${v.uploadDate}</video:publication_date>`,
    '      <video:family_friendly>yes</video:family_friendly>',
    '      <video:live>no</video:live>',
    '    </video:video>',
    '  ',
  ].join('\n');
}

const HTML_REDIRECTS = {
  '/index.html': '/',
  '/abonnements.html': '/abonnements',
  '/seance-essai.html': '/seance-essai',
  '/coachings.html': '/coachings',
  '/materiel.html': '/materiel',
  '/materiel-produit.html': '/materiel',
  '/faq.html': '/faq',
  '/cgv.html': '/cgv',
  '/reglement-interieur.html': '/reglement-interieur',
  '/legal/confidentialite.html': '/politique-confidentialite',
  '/panier.html': '/panier',
  '/inscription.html': '/inscription',
  '/mon-inscription.html': '/mon-inscription',
  '/contrat.html': '/contrat',
  '/offres-speciales.html': '/offres-speciales',
  '/offre-259.html': '/offre/259',
  '/offre-29.html': '/offre/29',
};

/** Chemins PrestaShop fréquents → pages BOXPLUS (cutover boutique.boxingcenter.fr). */
const PRESTASHOP_REDIRECTS = {
  '/content/4-a-propos': '/',
  '/content/3-conditions-generales-de-ventes': '/cgv',
  '/content/2-mentions-legales': '/politique-confidentialite',
  '/nous-contacter': '/faq',
  '/contactez-nous': '/faq',
  '/historique-de-commandes': '/mon-inscription',
  '/identite': '/mon-inscription',
  '/adresse': '/mon-inscription',
  '/module/ps_emailsubscription/subscription': '/',
};

const NOINDEX_PATHS = [
  '/panier',
  '/inscription',
  '/mon-inscription',
  '/contrat',
  '/gerer-abonnement',
  '/checkout.html',
  '/success.html',
  '/admin',
];

/* ── helpers ──────────────────────────────────────────────────────── */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Replace an existing meta tag's content in place (no duplicate tags).
function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  return html.replace(re, `$1${esc(value)}$2`);
}

function headTags(route, { ogImage, ogImageAlt, jsonLd, video, extra, noindex } = {}) {
  const url = `${SITE_URL}${route === '/' ? '/' : route}`;
  const imgPath = ogImage || DEFAULT_OG_IMAGE;
  const img = `${SITE_URL}${imgPath}`;
  const robots = noindex
    ? 'noindex,nofollow'
    : 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
  const parts = [
    `<link rel="canonical" href="${url}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="googlebot" content="${robots}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${img}" />`,
  ];
  if (route === '/') {
    parts.push('<meta name="geo.region" content="FR-31" />');
    parts.push('<meta name="geo.placename" content="Toulouse" />');
    parts.push('<meta name="ICBM" content="43.6047, 1.4442" />');
    parts.push('<meta name="language" content="fr" />');
    parts.push('<link rel="alternate" href="https://boxingcenter.fr/" hreflang="fr" />');
  }
  if (imgPath === DEFAULT_OG_IMAGE) {
    parts.push('<meta property="og:image:width" content="1200" />');
    parts.push('<meta property="og:image:height" content="630" />');
  }
  if (process.env.GOOGLE_SITE_VERIFICATION) {
    parts.push(`<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}" />`);
  }
  if (process.env.BING_SITE_VERIFICATION) {
    parts.push(`<meta name="msvalidate.01" content="${esc(process.env.BING_SITE_VERIFICATION)}" />`);
  }
  parts.push(`<meta property="og:image:alt" content="${esc(ogImageAlt || 'Salle Boxing Center à Toulouse — entraînement de boxe')}" />`);
  parts.push(`<meta name="twitter:image" content="${img}" />`);
  /* Partage social : sans ces balises, un lien collé dans une conversation
     ne montre qu'une image fixe. On ne touche PAS à og:type, qui reste
     celui de la page (une offre) — la vidéo l'illustre, elle ne la remplace pas. */
  if (video) {
    const src = `${SITE_URL}/media/${video.file}`;
    parts.push(`<meta property="og:video" content="${src}" />`);
    parts.push(`<meta property="og:video:secure_url" content="${src}" />`);
    parts.push('<meta property="og:video:type" content="video/mp4" />');
    parts.push(`<meta property="og:video:width" content="${video.width}" />`);
    parts.push(`<meta property="og:video:height" content="${video.height}" />`);
  }
  if (extra) parts.push(extra);
  if (jsonLd) parts.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  return `  ${parts.join('\n  ')}\n`;
}

function inject(html, tags) {
  return html.replace('</head>', `${tags}</head>`);
}

const fileCache = new Map(); // abs path -> { mtime, html }
function readHtml(absPath) {
  const mtime = fs.statSync(absPath).mtimeMs;
  const hit = fileCache.get(absPath);
  if (hit && hit.mtime === mtime) return hit.html;
  const html = fs.readFileSync(absPath, 'utf8');
  fileCache.set(absPath, { mtime, html });
  return html;
}

function findProduct(slugOrId) {
  const key = decodeURIComponent(String(slugOrId || '')).toLowerCase();
  return CATALOG.find((p) => (p.slug || '').toLowerCase() === key)
    || CATALOG.find((p) => String(p.id).toLowerCase() === key);
}

function productUrl(p) {
  return `${SITE_URL}/materiel/produit/${encodeURIComponent(p.slug || p.id)}`;
}

function productJsonLd(p) {
  const img = p.image || (Array.isArray(p.images) && p.images[0]) || DEFAULT_OG_IMAGE;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: p.name,
        sku: p.reference || String(p.id),
        image: `${SITE_URL}${img}`,
        description: p.description_short || p.description || p.name,
        category: p.category_label || p.category,
        url: productUrl(p),
        offers: {
          '@type': 'Offer',
          price: (Number(p.price_cents || 0) / 100).toFixed(2),
          priceCurrency: 'EUR',
          availability: Number(p.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: productUrl(p),
          seller: { '@id': `${SITE_URL}/#org` },
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: 'Matériel de boxe', item: `${SITE_URL}/materiel` },
          { '@type': 'ListItem', position: 3, name: p.name, item: productUrl(p) },
        ],
      },
    ],
  };
}

/* ── text documents ───────────────────────────────────────────────── */

function robotsTxt() {
  const privatePaths = [
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /panier',
    'Disallow: /checkout.html',
    'Disallow: /success.html',
    'Disallow: /inscription',
    'Disallow: /mon-inscription',
    'Disallow: /contrat',
    'Disallow: /gerer-abonnement',
  ];
  return [
    '# Boxing Center Toulouse — boutique officielle',
    '# Remplace progressivement https://boutique.boxingcenter.fr/ (PrestaShop)',
    '# IA / GEO : /llms.txt · /llms-full.txt · /ai.txt',
    '',
    'User-agent: *',
    'Allow: /',
    ...privatePaths,
    '',
    '# Assistants & crawlers IA — contenu public autorisé',
    'User-agent: GPTBot',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: anthropic-ai',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: Applebot-Extended',
    'Allow: /',
    ...privatePaths,
    '',
    'User-agent: Bytespider',
    'Allow: /',
    ...privatePaths,
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    `LLMs-Txt: ${SITE_URL}/llms.txt`,
    '',
  ].join('\n');
}

function aiTxt() {
  return `# ai.txt — Boxing Center Toulouse (boutique officielle)

# Instructions pour les agents et moteurs génératifs
site: ${SITE_URL}/
brand: Boxing Center
locale: fr-FR
city: Toulouse
region: Occitanie, Haute-Garonne
type: club de boxe / boutique d'abonnements et matériel

# Ce que vous pouvez citer
- Offres et tarifs affichés sur ${SITE_URL}/abonnements et ${SITE_URL}/materiel
- Offres spéciales : ${SITE_URL}/offres-speciales (259 € / an ou 29,99 € pour démarrer)
- Séance d'essai à 10 € : ${SITE_URL}/seance-essai
- 5 salles : Minimes, Ramonville, États-Unis, Saint-Cyprien, Portet-sur-Garonne
- Disciplines : ${DISCIPLINES.join(', ')}
- FAQ : ${SITE_URL}/faq
- Fiche structurée pour LLM : ${SITE_URL}/llms.txt

# Ce qu'il ne faut pas inventer
- Ne pas inventer de tarifs absents du site
- Ne pas inventer d'horaires de cours précis (renvoyer vers la salle / boxingcenter.fr)
- Ne pas confondre avec d'autres clubs de boxe toulousains

# Contact
phone: 05 62 24 46 82
email: ${BUSINESS.email}
club_site: https://boxingcenter.fr
`;
}

function llmsTxt() {
  const salles = SALLES.map((s) => `- Boxing Center ${s.name} — ${[s.street, `${s.postal} ${s.city}`].filter(Boolean).join(', ')}${s.telephone ? ` — ${s.telephone}` : ''}`).join('\n');
  return `# Boxing Center Toulouse — boutique officielle

> Club de boxe à Toulouse fondé en septembre 2016 : 5 salles (Minimes, Ramonville,
> États-Unis, Saint-Cyprien, Portet-sur-Garonne), ${DISCIPLINES.length} disciplines
> (${DISCIPLINES.join(', ')}), cours accessibles aux débutants comme aux confirmés,
> femmes et enfants bienvenus. Cette boutique en ligne officielle remplace
> progressivement l'ancienne boutique PrestaShop (boutique.boxingcenter.fr) :
> abonnements, séance d'essai à 10 €, coachings individuels et matériel de boxe
> (gants, bandes, protections, textile) — retrait en salle.

## Priority facts (GEO / AI)
- Marque : Boxing Center (Toulouse / Haute-Garonne)
- Séance d'essai : 10 € — cours encadré, aucun matériel requis (${SITE_URL}/seance-essai)
- Accès multi-salles selon formule
- Paiement en ligne : carte (PayPlug), PayPal ; prélèvement sans engagement
- Langue du site : français

## Offres
- Séance d'essai : 10 € — cours encadré, aucun matériel requis (${SITE_URL}/seance-essai)
- Offres spéciales (hub) : ${SITE_URL}/offres-speciales
- Promo 12 mois : 259 € (1× ou 4× sans frais) — ${SITE_URL}/offre/259
- Démarrage flexible : 29,99 € la 1ʳᵉ échéance puis prélèvement sans engagement — ${SITE_URL}/offre/29
- Abonnements : comptant 3/6/12 mois ou prélèvement sans engagement (4 semaines), accès aux 5 salles (${SITE_URL}/abonnements)
- Enfants : Baby Boxe (3-6 ans), Boxe éducative (7-16 ans)
- Coachings individuels (${SITE_URL}/coachings)
- Matériel et équipement de boxe : ${CATALOG.length} produits, retrait en salle (${SITE_URL}/materiel)

## Vidéos
${Object.entries(VIDEOS)
  .map(([route, v]) => `- ${v.name} (${iso8601Duration(v.seconds)}, ${SITE_URL}${route}) — ${v.description}`)
  .join('\n')}

## Salles (NAP)
${salles}

## Contact
- Téléphone réseau : 05 62 24 46 82
- Email : ${BUSINESS.email}
- Site du club : https://boxingcenter.fr
- FAQ : ${SITE_URL}/faq
- Instructions IA : ${SITE_URL}/ai.txt

Catalogue complet et FAQ détaillée : ${SITE_URL}/llms-full.txt
`;
}

function llmsFullTxt() {
  const products = CATALOG.map((p) => `- ${p.name} — ${p.price_label || ''} — ${productUrl(p)}`).join('\n');
  const faq = FAQ.map(([q, a]) => `### ${q}\n${a}`).join('\n\n');
  return `${llmsTxt()}
## Catalogue matériel de boxe (${CATALOG.length} produits, retrait en salle)
${products}

## FAQ complète
${faq}
`;
}

function sitemapXml(publicDir) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];
  for (const [route, cfg] of Object.entries(INDEXABLE)) {
    let lastmod = today;
    try {
      lastmod = new Date(fs.statSync(path.join(publicDir, cfg.file)).mtimeMs).toISOString().slice(0, 10);
    } catch (_) { /* keep today */ }
    const v = videoFor(route, publicDir);
    urls.push(`  <url><loc>${SITE_URL}${route === '/' ? '/' : route}</loc><lastmod>${lastmod}</lastmod><changefreq>${cfg.changefreq}</changefreq><priority>${cfg.priority}</priority>${v ? videoSitemapBlock(v) : ''}</url>`);
  }
  let catalogMod = today;
  try {
    catalogMod = new Date(fs.statSync(require.resolve('../../data/storefront/materiel-catalog.json')).mtimeMs).toISOString().slice(0, 10);
  } catch (_) { /* keep today */ }
  for (const p of CATALOG) {
    urls.push(`  <url><loc>${esc(productUrl(p))}</loc><lastmod>${catalogMod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
  }
  /* Le préfixe video: doit être déclaré sur <urlset>, sinon le sitemap est
     invalide dans son ENSEMBLE et Google le rejette — pages comprises. */
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${urls.join('\n')}\n</urlset>\n`;
}

/* ── registration ─────────────────────────────────────────────────── */

function registerSeo(app, publicDir) {
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(robotsTxt()));
  app.get('/llms.txt', (_req, res) => res.type('text/plain; charset=utf-8').send(llmsTxt()));
  app.get('/llms-full.txt', (_req, res) => res.type('text/plain; charset=utf-8').send(llmsFullTxt()));
  app.get('/ai.txt', (_req, res) => res.type('text/plain; charset=utf-8').send(aiTxt()));
  app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => res.type('text/plain').send(INDEXNOW_KEY));

  // Pages compte / tunnel : jamais indexées (X-Robots-Tag + meta côté HTML indexable)
  app.use((req, res, next) => {
    const p = String(req.path || '');
    if (NOINDEX_PATHS.some((x) => p === x || p.startsWith(`${x}/`) || p.startsWith(`${x}.`))) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  let sitemapCache = null;
  let sitemapAt = 0;
  app.get('/sitemap.xml', (_req, res) => {
    if (!sitemapCache || Date.now() - sitemapAt > 10 * 60 * 1000) {
      sitemapCache = sitemapXml(publicDir);
      sitemapAt = Date.now();
    }
    res.type('application/xml').send(sitemapCache);
  });

  // Legacy .html paths → clean URLs (single canonical version of every page).
  for (const [from, to] of Object.entries(HTML_REDIRECTS)) {
    app.get(from, (_req, res) => res.redirect(301, to));
  }
  // Cutover PrestaShop → BOXPLUS (chemins connus ; à enrichir au moment du DNS)
  for (const [from, to] of Object.entries(PRESTASHOP_REDIRECTS)) {
    app.get(from, (_req, res) => res.redirect(301, to));
  }

  // Legacy query-string product URL → slug URL; bare/unknown → catalog page
  // (never serve the empty "Chargement…" template on a crawlable URL).
  app.get('/materiel/produit', (req, res) => {
    const p = findProduct(req.query.id);
    if (p) return res.redirect(301, `/materiel/produit/${encodeURIComponent(p.slug || p.id)}`);
    return res.redirect(302, '/materiel');
  });

  // Product pages with server-injected metadata + Product JSON-LD.
  app.get('/materiel/produit/:slug', (req, res) => {
    const p = findProduct(req.params.slug);
    if (!p) return res.redirect(302, '/materiel');
    const route = `/materiel/produit/${encodeURIComponent(p.slug || p.id)}`;
    const priceTxt = p.price_label || `${(Number(p.price_cents || 0) / 100).toFixed(2)} €`;
    const title = `${p.name} — Matériel de boxe | Boxing Center Toulouse`;
    const desc = `${p.name} à ${priceTxt} — ${p.category_label || 'matériel de boxe'} de la boutique officielle Boxing Center Toulouse. Commande en ligne, retrait en salle.`;
    let html = readHtml(path.join(publicDir, 'materiel-produit.html'));
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
    // Rewrite the template's fallback metas in place — never duplicate tags.
    html = setMeta(html, 'name', 'description', desc);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'name', 'twitter:description', desc);
    const tags = headTags(route, {
      ogImage: p.image || (Array.isArray(p.images) && p.images[0]) || DEFAULT_OG_IMAGE,
      ogImageAlt: p.name,
      jsonLd: productJsonLd(p),
      extra: [
        `<meta property="og:type" content="product" />`,
        `<script>window.__PRODUCT_ID__=${JSON.stringify(String(p.id))};</script>`,
      ].join('\n  '),
    });
    res.type('html').send(inject(html, tags));
  });

  // Crawlable no-JS fallback for the catalog page: AI crawlers (GPTBot,
  // ClaudeBot, PerplexityBot…) don't execute JS, so the JS-rendered grid is
  // invisible to them. Real links + names + prices, honest <noscript> use.
  const materielNoscript = `<noscript><section class="section"><h2>Tout le matériel de boxe</h2><ul>${
    CATALOG.map((p) => `<li><a href="/materiel/produit/${encodeURIComponent(p.slug || p.id)}">${esc(p.name)}${p.price_label ? ` — ${esc(p.price_label)}` : ''}</a></li>`).join('')
  }</ul></section></noscript>`;

  // Crawlable NAP (name/address/phone) for no-JS crawlers — the footer and
  // gym cards are JS-rendered, so the visible addresses need a fallback.
  const homeNoscript = `<noscript><section><h2>Nos 5 salles de boxe à Toulouse</h2><ul>${
    SALLES.map((s) => `<li>Boxing Center ${esc(s.name)} — ${[s.street, `${s.postal} ${s.city}`].filter(Boolean).map(esc).join(', ')} — Tél. 05 62 24 46 82</li>`).join('')
  }</ul></section></noscript>`;

  // Indexable pages: canonical + og:url/og:image + robots hints + JSON-LD.
  for (const [route, cfg] of Object.entries(INDEXABLE)) {
    app.get(route, (_req, res) => {
      const abs = path.join(publicDir, cfg.file);
      let jsonLd = PAGE_JSONLD[route] ? PAGE_JSONLD[route]() : null;
      const video = videoFor(route, publicDir);
      if (video) {
        /* Deux entités distinctes sur la même page (l'offre ET la vidéo) :
           @graph est la seule forme que Google lit sans en perdre une. */
        const node = jsonLd ? { ...jsonLd } : null;
        if (node) delete node['@context'];
        jsonLd = {
          '@context': 'https://schema.org',
          '@graph': [node, videoJsonLd(video)].filter(Boolean),
        };
      }
      let html = inject(
        readHtml(abs),
        headTags(route, {
          jsonLd,
          video,
          ogImage: cfg.ogImage,
          ogImageAlt: cfg.ogImageAlt,
        })
      );
      if (route === '/materiel') html = html.replace('</body>', `${materielNoscript}\n</body>`);
      if (route === '/') html = html.replace('</body>', `${homeNoscript}\n</body>`);
      res.type('html').send(html);
    });
  }
}

module.exports = { registerSeo, SITE_URL };
