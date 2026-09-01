'use strict';

const LANDINGS = {
  '/boxe-anglaise-toulouse': {
    name: 'Boxe anglaise',
    title: 'Boxe anglaise à Toulouse — cours, essai et abonnement | Boxing Center',
    description: 'Cours de boxe anglaise à Toulouse pour débutants, loisirs et confirmés. Réservez un essai à 10 € ou choisissez votre abonnement Boxing Center.',
    image: '/img/bc/disc/boxe-anglaise.webp',
    eyebrow: 'Le noble art',
    lead: 'Apprenez les déplacements, la garde, les esquives et les enchaînements de poings dans un cadre progressif, du premier cours à la pratique confirmée.',
    audience: 'La boxe anglaise convient aux adultes comme aux jeunes, aux débutants qui veulent se remettre en forme et aux pratiquants qui souhaitent perfectionner leur technique.',
    practice: 'Les séances associent échauffement, travail technique, sacs de frappe, pattes d’ours et condition physique. L’opposition est encadrée et adaptée au niveau de chacun.',
    benefit: 'Coordination, cardio, confiance, précision et maîtrise de soi : chaque entraînement permet de progresser à son rythme.',
    keywords: ['cours de boxe anglaise Toulouse', 'club de boxe Toulouse', 'boxe débutant Toulouse', 'entraînement boxe anglaise'],
  },
  '/boxe-thai-toulouse': {
    name: 'Boxe thaï / Muay Thaï',
    title: 'Boxe thaï et Muay Thaï à Toulouse — cours tous niveaux | Boxing Center',
    description: 'Découvrez la boxe thaï et le Muay Thaï à Toulouse : cours encadrés, débutants bienvenus, séance d’essai et abonnements Boxing Center.',
    image: '/img/bc/disc/muay-thai.webp',
    eyebrow: 'Pieds, poings, genoux, coudes',
    lead: 'Découvrez une discipline complète qui développe la technique de frappe, les déplacements, la condition physique et le contrôle.',
    audience: 'Les cours accueillent les personnes qui débutent comme les pratiquants confirmés. Le contenu et l’intensité sont adaptés pour apprendre sans brûler les étapes.',
    practice: 'Vous travaillez les fondamentaux du Muay Thaï : garde, distances, combinaisons pieds-poings, genoux, coudes et exercices sur cibles.',
    benefit: 'Une pratique idéale pour améliorer cardio, mobilité, puissance, coordination et confiance dans une ambiance de club.',
    keywords: ['boxe thaï Toulouse', 'Muay Thaï Toulouse', 'cours boxe thaï débutant', 'club Muay Thai Toulouse'],
  },
  '/kick-boxing-toulouse': {
    name: 'Kick-boxing / K1',
    title: 'Kick-boxing à Toulouse — cours débutants et confirmés | Boxing Center',
    description: 'Cours de kick-boxing et K1 à Toulouse, accessibles aux débutants et confirmés. Testez une séance puis choisissez votre formule Boxing Center.',
    image: '/img/bc/disc/kick.webp',
    eyebrow: 'Boxe pieds-poings',
    lead: 'Le kick-boxing combine les techniques de poings et de jambes dans un entraînement dynamique, technique et accessible.',
    audience: 'Que vous cherchiez un sport de combat, une activité cardio ou une nouvelle discipline, les coachs vous accompagnent selon votre expérience.',
    practice: 'Les cours développent garde, déplacements, coups de poing, coups de pied, combinaisons et travail sur sacs ou protections de frappe.',
    benefit: 'Vous gagnez en endurance, vitesse, coordination et maîtrise technique au fil des séances.',
    keywords: ['kick boxing Toulouse', 'cours K1 Toulouse', 'boxe pieds poings Toulouse', 'kickboxing débutant Toulouse'],
  },
  '/mma-toulouse': {
    name: 'MMA',
    title: 'MMA à Toulouse — cours d’arts martiaux mixtes | Boxing Center',
    description: 'Cours de MMA à Toulouse pour découvrir le striking, les projections et le travail au sol. Débutants bienvenus, essai et abonnement en ligne.',
    image: '/img/bc/disc/mma-cage.jpg',
    eyebrow: 'Arts martiaux mixtes',
    lead: 'Le MMA réunit le combat debout, les amenées au sol et le grappling dans une pratique complète, structurée et encadrée.',
    audience: 'Les débutants apprennent les positions et gestes essentiels avant d’augmenter progressivement l’intensité. Les confirmés peuvent consolider leurs transitions.',
    practice: 'Chaque cours peut associer striking, lutte, contrôle au sol, sorties de position et enchaînements entre les différentes distances.',
    benefit: 'Une discipline riche pour développer condition physique, mobilité, stratégie, calme et capacité d’adaptation.',
    keywords: ['MMA Toulouse', 'cours MMA débutant Toulouse', 'club MMA Toulouse', 'arts martiaux mixtes Toulouse'],
  },
  '/grappling-toulouse': {
    name: 'Grappling et Jiu-Jitsu Brésilien',
    title: 'Grappling et Jiu-Jitsu Brésilien à Toulouse | Boxing Center',
    description: 'Pratiquez le grappling et le Jiu-Jitsu Brésilien près de Toulouse : contrôle au sol, mobilité et technique, avec des cours tous niveaux.',
    image: '/img/bc/disc/mma.webp',
    eyebrow: 'Combat au sol',
    lead: 'Le grappling et le Jiu-Jitsu Brésilien développent le contrôle, les déplacements au sol et les sorties de position sans techniques de frappe.',
    audience: 'La progression repose sur la technique et les situations guidées, ce qui permet aux débutants de construire des bases solides.',
    practice: 'Vous découvrez les positions, passages, renversements, contrôles et soumissions dans un cadre sécurisé et progressif.',
    benefit: 'Souplesse, endurance, analyse, maîtrise corporelle et sang-froid progressent à chaque entraînement.',
    keywords: ['grappling Toulouse', 'Jiu Jitsu Brésilien Toulouse', 'JJB Toulouse', 'cours combat au sol Toulouse'],
  },
  '/boxe-femme-toulouse': {
    name: 'Boxe femme / Boxing Lady',
    title: 'Boxe pour femmes à Toulouse — Boxing Lady et cours mixtes | Boxing Center',
    description: 'Cours de boxe pour femmes à Toulouse : Boxing Lady et cours mixtes, débutantes bienvenues. Essai à 10 € et abonnements en ligne.',
    image: '/img/bc/disc/lady.webp',
    eyebrow: 'Débutantes bienvenues',
    lead: 'Commencez la boxe dans un environnement motivant avec des séances Boxing Lady et l’accès aux cours collectifs mixtes selon les plannings.',
    audience: 'Aucune expérience ni condition physique particulière n’est nécessaire pour commencer. Les exercices sont adaptés au niveau et aux objectifs de chacune.',
    practice: 'Technique de boxe, sacs de frappe, cardio, renforcement et coordination composent des séances variées, encadrées par les coachs.',
    benefit: 'Une activité complète pour se dépenser, progresser techniquement et gagner en assurance sans pression compétitive.',
    keywords: ['boxe femme Toulouse', 'Boxing Lady Toulouse', 'cours boxe féminin Toulouse', 'boxe débutante Toulouse'],
  },
  '/boxe-enfant-toulouse': {
    name: 'Baby Boxe et boxe éducative',
    title: 'Boxe enfant à Toulouse — Baby Boxe, enfants et ados | Boxing Center',
    description: 'Cours de boxe pour enfants à Toulouse : Baby Boxe 3-6 ans et boxe éducative 7-16 ans, avec un encadrement adapté à chaque âge.',
    image: '/img/bc/disc/educative.webp',
    eyebrow: 'De 3 à 16 ans',
    lead: 'La Baby Boxe et la boxe éducative permettent aux enfants et adolescents de découvrir la discipline avec une pédagogie adaptée à leur âge.',
    audience: 'La Baby Boxe accueille les 3-6 ans. La boxe éducative accompagne les 7-16 ans avec des groupes et exercices progressifs.',
    practice: 'Jeux moteurs, déplacements, coordination, techniques de base et règles de sécurité favorisent un apprentissage ludique et structuré.',
    benefit: 'Les jeunes développent motricité, écoute, respect, confiance et goût de l’effort au sein du groupe.',
    keywords: ['boxe enfant Toulouse', 'Baby Boxe Toulouse', 'boxe éducative Toulouse', 'cours boxe ado Toulouse'],
  },
  '/cross-training-toulouse': {
    name: 'Cross training et Boxing Fitness',
    title: 'Cross training et Boxing Fitness à Toulouse | Boxing Center',
    description: 'Cross training, cardio boxing et Boxing Fitness à Toulouse : entraînements complets mêlant renforcement, cardio et gestes de boxe.',
    image: '/img/bc/disc/cross-training.jpg',
    eyebrow: 'Condition physique',
    lead: 'Associez cardio, renforcement et mouvements inspirés de la boxe pour construire une condition physique complète.',
    audience: 'Ces entraînements s’adressent aux personnes qui veulent reprendre le sport, compléter leur pratique de la boxe ou varier leurs séances.',
    practice: 'Les formats alternent exercices fonctionnels, sacs de frappe, circuits, mobilité et travail cardio, avec des adaptations selon le niveau.',
    benefit: 'Endurance, tonicité, puissance et régularité progressent dans des séances rythmées et collectives.',
    keywords: ['cross training Toulouse', 'Boxing Fitness Toulouse', 'cardio boxing Toulouse', 'préparation physique boxe Toulouse'],
  },
};

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderLanding(route) {
  const page = LANDINGS[route];
  if (!page) return null;
  const otherLinks = Object.entries(LANDINGS)
    .filter(([path]) => path !== route)
    .map(([path, item]) => `<a href="${path}">${esc(item.name)}</a>`)
    .join(' · ');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}" />
  <script src="/js/boot.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;1,600;1,700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/boutique.css" />
  <link rel="stylesheet" href="/css/components.css" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Boxing Center Toulouse" />
  <meta property="og:locale" content="fr_FR" />
  <meta property="og:title" content="${esc(page.title)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="theme-color" content="#20254B" />
</head>
<body>
  <div id="site-header"></div>
  <div class="page-hero page-hero--photo" style="background-image:linear-gradient(90deg,rgba(18,23,55,.94),rgba(18,23,55,.55)),url('${esc(page.image)}')">
    <div class="page-hero-inner">
      <div class="breadcrumb"><a href="/">Accueil</a> / <a href="/abonnements">Disciplines</a> / ${esc(page.name)}</div>
      <span class="eyebrow" style="color:var(--bc-gold);display:block;margin-bottom:10px">${esc(page.eyebrow)}</span>
      <h1>${esc(page.name)} à Toulouse</h1>
      <p>${esc(page.lead)}</p>
      <div class="hero-actions">
        <a href="/seance-essai" class="btn">Réserver un essai à 10 €</a>
        <a href="/abonnements" class="btn white">Voir les abonnements</a>
      </div>
    </div>
  </div>
  <main>
    <section class="section why">
      <div class="why__grid">
        <div class="why__media">
          <img src="${esc(page.image)}" alt="Cours de ${esc(page.name)} à Toulouse au Boxing Center" loading="eager" width="620" height="760" />
        </div>
        <div class="why__content">
          <div class="section-head left">
            <span class="kicker">Cours tous niveaux</span>
            <h2>Pratiquer ${esc(page.name)} au Boxing Center</h2>
            <p>${esc(page.audience)}</p>
          </div>
          <ul class="why__list">
            <li><div><h3>Comment se déroule un cours ?</h3><p>${esc(page.practice)}</p></div></li>
            <li><div><h3>Pourquoi choisir cette discipline ?</h3><p>${esc(page.benefit)}</p></div></li>
            <li><div><h3>Où pratiquer près de Toulouse ?</h3><p>Boxing Center réunit plusieurs salles à Toulouse et dans son agglomération. Les disciplines et créneaux varient selon le centre : consultez le planning de votre salle avant votre venue.</p></div></li>
          </ul>
        </div>
      </div>
    </section>
    <section class="section section-alt">
      <div class="section-head">
        <span class="kicker">Commencer simplement</span>
        <h2>Essai, abonnement et équipement</h2>
        <p>Testez un cours encadré, choisissez une formule adaptée puis retrouvez les gants, bandes et protections utiles dans la boutique officielle.</p>
      </div>
      <div class="hero-actions" style="justify-content:center">
        <a href="/seance-essai" class="btn">Séance d’essai à 10 €</a>
        <a href="/offres-speciales" class="btn secondary">Voir les offres</a>
        <a href="/materiel" class="btn secondary">Matériel de boxe</a>
      </div>
    </section>
    <section class="section">
      <div class="section-head">
        <span class="kicker">Toutes les pratiques</span>
        <h2>Découvrez les autres disciplines</h2>
        <p>${otherLinks}</p>
      </div>
    </section>
  </main>
  <section class="cta-band">
    <h2>Prêt à essayer ${esc(page.name)} ?</h2>
    <p>Débutants bienvenus. Réservez votre première séance en ligne.</p>
    <a href="/seance-essai" class="btn white">Je réserve mon essai</a>
  </section>
  <div id="site-footer"></div>
  <script src="/js/layout.js"></script>
  <script src="/js/motion.js"></script>
  <script src="/js/tracking.js?v=2" defer></script>
</body>
</html>`;
}

function landingJsonLd(route, siteUrl) {
  const page = LANDINGS[route];
  if (!page) return null;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: `${page.name} à Toulouse`,
        serviceType: `Cours de ${page.name}`,
        description: page.description,
        provider: { '@id': `${siteUrl}/#org` },
        areaServed: { '@type': 'City', name: 'Toulouse' },
        url: `${siteUrl}${route}`,
        image: `${siteUrl}${page.image}`,
        keywords: page.keywords.join(', '),
        offers: [
          { '@type': 'Offer', name: 'Séance d’essai', price: '10.00', priceCurrency: 'EUR', url: `${siteUrl}/seance-essai` },
          { '@type': 'Offer', name: 'Abonnements Boxing Center', url: `${siteUrl}/abonnements` },
        ],
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: 'Abonnements et disciplines', item: `${siteUrl}/abonnements` },
          { '@type': 'ListItem', position: 3, name: page.name, item: `${siteUrl}${route}` },
        ],
      },
    ],
  };
}

module.exports = { LANDINGS, renderLanding, landingJsonLd };
