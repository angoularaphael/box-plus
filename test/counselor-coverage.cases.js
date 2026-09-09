'use strict';

/**
 * Banque de questions visiteur → ce que le bot DOIT / NE DOIT PAS dire.
 * Utilisée par test/counselor-coverage.test.js et scripts/test-counselor-coverage.js
 */

const NO_MENU = /dis-moi juste ce que tu cherches|Offres, salles, essai|partir sur quoi en premier|Balance ta question|Que souhaitez-vous savoir \?/i;
const BOTH_OFFERS = [/29,99/, /259/];

function follow(bot, user) {
  return [
    { role: 'assistant', content: bot },
    { role: 'user', content: user },
  ];
}

module.exports = [
  {
    id: 'enfant-3-ans-inscrire',
    q: 'J’ai un fils de 3 ans comment faire pour l’inscrire ?',
    must: [/Baby Boxe/i, /3 ans/],
    mustNot: [NO_MENU],
  },
  {
    id: 'enfant-2-ans-trop-jeune',
    q: 'Mon bébé a 2 ans, on peut l’inscrire ?',
    must: [/3 ans/],
    mustNot: [NO_MENU],
    failIf: [/dès 2 ans|à partir de 2/i],
  },
  {
    id: 'enfant-5-ans',
    q: 'Ma fille a 5 ans, quel cours ?',
    must: [/Baby Boxe|pieds-poings|3/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'enfant-8-ans',
    q: 'Mon fils a 8 ans, il peut boxer ?',
    must: [/7–11|7-11|Éducative|educative/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'enfant-14-ans',
    q: 'Ado de 14 ans, c’est quoi le cours ?',
    must: [/12–16|12-16/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'enfant-cours-existent',
    q: 'Ya pas de cours pour les enfants ?',
    must: [/Baby Boxe|Éducative|educative|7–11|7-11/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'enfant-quelle-salle',
    q: 'Et c’est dans quelle salle ?',
    messages: follow(
      'Oui. Dès **3 ans**, c’est la **Baby Boxe**. Ensuite **Boxe Éducative 7–11 ans**. Tu vises quelle salle ?',
      'Et c’est dans quelle salle ?'
    ),
    must: [/Minimes/, /Ramonville/, /Portet/, /États-Unis|Etats-Unis/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'enfant-relance-pas-identique',
    q: 'Ya pas de cours pour les enfants ?',
    messages: follow(
      'Oui. Dès **3 ans**, c’est la **Baby Boxe**. Ensuite **Boxe Éducative 7–11 ans** et **12–16 ans**, selon les salles. Un mineur s’inscrit en ligne avec l’accord du représentant légal. Tu vises quelle salle ?',
      'Ya pas de cours pour les enfants ?'
    ),
    must: [/Baby Boxe|cours enfants|7–11|Minimes/i],
    mustNot: [/Tu vises quelle salle \?/],
  },
  {
    id: 'age-enfants',
    q: 'À partir de quel âge les enfants sont-ils admis ?',
    must: [/3 ans|Baby Boxe/i],
  },
  {
    id: 'debutant',
    q: 'Je n’ai jamais boxé, c’est possible ?',
    must: [/tous niveaux|débutant/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'reprise',
    q: 'Je ne suis pas sportif, je reprends après une longue pause',
    must: [/adapt|tous niveaux|progress/i],
  },
  {
    id: 'femmes',
    q: 'Les femmes peuvent-elles participer ?',
    must: [/Boxing Lady|Lady Punch/i],
  },
  {
    id: 'lady-ou',
    q: 'Les cours 100 % féminins c’est où ?',
    must: [/Boxing Lady|Lady Punch/i],
  },
  {
    id: 'certificat',
    q: 'Faut-il un certificat médical ?',
    must: [/loisir|certificat/i],
    mustNot: [/jamais obligatoire/i],
  },
  {
    id: 'clim',
    q: 'Les salles sont-elles chauffées ou climatisées ?',
    must: [/pas chauff|pas climatis|ne sont pas/i],
    failIf: [/sont climatisées|chauffées en hiver/i],
  },
  {
    id: 'clim-oui-piege',
    q: 'Vous avez la clim en été ?',
    must: [/pas climatis|ne sont pas/i],
  },
  {
    id: 'dimanche',
    q: 'Vous êtes ouverts le dimanche ?',
    must: [/samedi|dimanche/i],
    mustNot: [NO_MENU],
    failIf: [/ouverts 7j|oui[, ]+le dimanche/i],
  },
  {
    id: 'ouvert-7j7',
    q: 'Vous êtes ouverts 7j/7 ?',
    must: [/lundi|samedi/i],
    failIf: [/oui.*7j/i],
  },
  {
    id: 'horaires-ouverture',
    q: 'Quels sont vos horaires d’ouverture ?',
    must: [/10h/, /21h30/],
    mustNot: [NO_MENU],
    failIf: [/tous les plannings/i],
  },
  {
    id: 'jusqua-quelle-heure',
    q: 'Vous êtes ouverts jusqu’à quelle heure ?',
    must: [/21h30/],
  },
  {
    id: 'weekend',
    q: 'Vous ouvrez le week-end ?',
    must: [/samedi/i],
  },
  {
    id: 'douches',
    q: 'Il y a des douches ?',
    must: [/douche/i],
  },
  {
    id: 'casiers',
    q: 'Y a-t-il des casiers ?',
    must: [/casier/i],
  },
  {
    id: 'renovation',
    q: 'Vous rénovez les salles ?',
    must: [/rénov/i],
  },
  {
    id: 'essai',
    q: 'Je peux essayer avant de m’abonner ?',
    must: [/10\s*€|10€/],
  },
  {
    id: 'materiel-essai',
    q: 'Le matériel est fourni pour l’essai ?',
    must: [/prêt|prêté|prete/i],
  },
  {
    id: 'reservation',
    q: 'Faut-il réserver les cours collectifs ?',
    must: [/sans réserv|illimit/i],
  },
  {
    id: 'multi-salles',
    q: 'Je peux accéder à plusieurs salles ?',
    must: [/formule|salles/i],
  },
  {
    id: 'liste-salles',
    q: 'Vous avez quelles salles ?',
    must: [/Minimes/, /Ramonville/, /Portet/, /Cyprien/, /États-Unis|Etats-Unis/i],
  },
  {
    id: 'combien-salles',
    q: 'Vous avez combien de salles ?',
    must: [/Minimes|5 salles|Cinq salles/i],
    failIf: [/29,99/],
  },
  {
    id: 'balma',
    q: 'Il y a encore une salle à Balma ?',
    must: [/pas dans le périmètre|n’est pas|5 salles/i],
    failIf: [/oui.*Balma/i],
  },
  {
    id: 'adresse-minimes',
    q: 'C’est où Minimes ?',
    must: [/Fenouillet|31200/i],
  },
  {
    id: 'adresse-ramonville',
    q: 'Adresse de Ramonville ?',
    must: [/Ormes|31520|31530/i],
  },
  {
    id: 'cours-minimes',
    q: 'Quels cours à Minimes ?',
    must: [/Boxe Anglaise|Baby Boxe/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'offres',
    q: 'C’est combien l’abo ?',
    must: BOTH_OFFERS,
    failIf: [/64,75/],
  },
  {
    id: 'prix-baby-apres-planning-enfants',
    q: 'Ok et les prix ?',
    messages: follow(
      'Le planning **Baby Boxe / éducative** de **Minimes** : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/).',
      'Ok et les prix ?'
    ),
    must: [/250/, /295/],
    failIf: [/On ne dit pas/],
  },
  {
    id: 'adulte-ce-soir-minimes-pas-baby',
    q: 'Je suis un adulte, c’est quoi le planning des Minimes pour ce soir',
    messages: follow(
      'Le planning **Baby Boxe / éducative** de **Minimes** : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/).',
      'Je suis un adulte, c’est quoi le planning des Minimes pour ce soir'
    ),
    must: [/Minimes/i],
    mustNot: [/Baby Boxe \/ éducative/],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'offres-promo',
    q: 'Quelle offre promouvoir en priorité ?',
    must: BOTH_OFFERS,
  },
  {
    id: 'pas-29-par-mois',
    q: 'C’est 29 euros par mois ?',
    must: [/29,99/, /4 semaines|28 jours/i],
    failIf: [/oui.*par mois/i],
  },
  {
    id: 'planning-minimes',
    q: 'Je veux le planning de Minimes',
    must: [/voir le planning/, /minimes/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-ramonville',
    q: 'horaires Ramonville',
    must: [/voir le planning/, /ramonville/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-portet',
    q: 'créneaux Portet',
    must: [/voir le planning/, /portet/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-cyprien',
    q: 'planning Saint-Cyprien',
    must: [/voir le planning/, /cyprien/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-etats-unis',
    q: 'JJB aux États-Unis c’est quel horaire ?',
    must: [/voir le planning/, /etats-unis/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-tous',
    q: 'je veux voir le planning',
    must: [/Minimes/, /vous|te va/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-apres-3-ans',
    q: 'Je veux les plannings',
    messages: follow(
      'Oui, il y a bien des cours enfants : **Baby Boxe dès 3 ans**, puis **7–11 ans** et **12–16 ans**. Un mineur s’inscrit en ligne avec le parent.',
      'Je veux les plannings'
    ),
    must: [/Minimes/, /Ramonville/, /Portet/, /minimes|ramonville|portet/i],
    mustNot: [/Le plus simple : ouvre/],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-baby-boxe-pas-clone',
    q: 'Je veux les plannings de la baby boxe',
    messages: follow(
      'Le plus simple : ouvre [tous les plannings](https://boxingcenter.fr/salle-de-sport-toulouse/). Dis-moi ta salle (Minimes, Ramonville, St-Cyprien, Portet ou États-Unis) pour le lien direct.',
      'Je veux les plannings de la baby boxe'
    ),
    must: [/Baby Boxe/i, /Minimes/, /salle-de-boxe-toulouse-minimes/],
    mustNot: [/Le plus simple : ouvre/],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-baby-minimes',
    q: 'planning baby boxe Minimes',
    must: [/Minimes/, /voir le planning/, /minimes/i],
    expectSource: 'knowledge-planning',
  },
  {
    id: 'planning-ouvrir',
    q: 'l’ouvrir',
    messages: follow(
      'Le planning de **Minimes**, c’est ici : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/).',
      'l’ouvrir'
    ),
    must: [/minimes/i],
    expectSource: 'redirect-planning',
  },
  {
    id: 'resilier',
    q: 'je veux résilier mon abonnement',
    must: [/David|72/i],
    expectSource: 'redirect-david',
  },
  {
    id: 'jjb-pas-resil',
    q: 'c’est quoi le Jiu-Jitsu Brésilien',
    must: [/sol|sans frappe|États-Unis|Etats-Unis/i],
    mustNot: [/David.*72/],
  },
  {
    id: 'mma',
    q: 'Vous faites du MMA ?',
    must: [/MMA/i, /États-Unis|Ramonville/i],
  },
  {
    id: 'grappling',
    q: 'C’est quoi le grappling ?',
    must: [/sol|sans frappe/i],
  },
  {
    id: 'hyrox',
    q: 'Il y a du HYROX ?',
    must: [/HYROX/i],
  },
  {
    id: 'sparring-debutant',
    q: 'Je débute, je peux faire l’open sparring ?',
    must: [/pas|essai|loisir/i],
    failIf: [/idéal pour débuter l’opposition/i],
  },
  {
    id: 'essai-pas-planning',
    q: 'je veux une séance d’essai à 10 €',
    must: [/10\s*€/],
    mustNot: [/voir le planning/],
  },
  {
    id: 'inscription',
    q: 'comment je m’inscris ?',
    must: [/en ligne/i],
  },
  {
    id: 'competiteurs',
    q: 'Les cours compétiteurs c’est pour qui ?',
    must: [/confirm|compétit/i],
    mustNot: [NO_MENU],
  },
  {
    id: 'badge',
    q: 'est-ce que le badge est remboursé ?',
    must: [/badge/i, /rembours|restitu|propri/i],
    failIf: [/oui.*badge.*rembours/i],
  },
  {
    id: 'non-utilisation',
    q: 'Si je n’utilise pas mon abo je suis remboursé ?',
    must: [/non-utilisation|rembours/i],
    failIf: [/oui.*rembours/i],
  },
  {
    id: 'retractation',
    q: 'J’ai 14 jours pour me rétracter ?',
    must: [/14/],
  },
  {
    id: 'activation',
    q: 'Quand je peux entrer après inscription ?',
    must: [/lendemain/i],
  },
  {
    id: 'retard',
    q: 'Je peux arriver en retard au cours ?',
    must: [/10|coach/i],
  },
  {
    id: 'tenue',
    q: 'Je dois acheter des gants tout de suite ?',
    must: [/gants|tenue/i],
  },
  {
    id: 'fabien-debutant-vouvoiement',
    q: 'Je n’ai jamais boxé, c’est possible ?',
    persona: 'fabien',
    must: [/vous|votre|souhaitez/i],
    mustNot: [/\btu\b|\bton\b/i],
  },
  {
    id: 'nassim-enfants',
    q: 'Cours enfants ?',
    persona: 'nassim',
    must: [/Baby Boxe/i],
  },
  {
    id: 'manager-minimes',
    q: 'C’est qui le manager de Minimes ?',
    must: [/Mehdi/i],
  },
  {
    id: 'boxing-camp',
    q: 'C’est quoi le Boxing Camp ?',
    must: [/Boxing Camp/i],
  },
  {
    id: 'cross-training',
    q: 'Vous faites du Cross Training ?',
    must: [/Cross Training/i],
  },
  {
    id: 'boxe-thai',
    q: 'Il y a de la boxe thaï ?',
    must: [/Thaï|Thai|K1|pieds-poings/i],
  },
  {
    id: 'savate',
    q: 'Vous faites de la savate ?',
    must: [/Portet/i],
  },
  {
    id: 'muscu',
    q: 'Je peux juste faire de la musculation ?',
    must: [/muscu|accès libre|cardio/i],
  },
  {
    id: 'fumer',
    q: 'On a le droit de fumer dans la salle ?',
    must: [/interdit/i],
  },
  {
    id: 'photo-vestiaire',
    q: 'Je peux filmer dans les vestiaires ?',
    must: [/vestiaire/i],
    failIf: [/oui.*vestiaire/i],
  },
  {
    id: 'etudiant',
    q: 'Vous avez un tarif étudiant ?',
    must: [/étudiant|etudiant/i],
    failIf: [/29,99/],
  },
  {
    id: 'coaching',
    q: 'Vous faites du coaching individuel ?',
    must: [/coaching/i],
  },
  {
    id: 'enfant-inscrire-minimes',
    q: 'Je veux inscrire ma fille de 3 ans à Minimes',
    must: [/Baby Boxe/i],
  },
  {
    id: 'planning-pas-dimanche-invente',
    q: 'planning dimanche Minimes',
    must: [/voir le planning|samedi|dimanche/i],
    failIf: [/dimanche \d+h|dimanche 10h/i],
  },
];

/** Questions supplémentaires : un menu générique = faille (sauf salutations). */
module.exports.PROBES = [
  'des cours pour les petits ?',
  'mon gamin a 4 ans',
  'c’est adapté aux gamines de 6 ans ?',
  'vous prenez les collégiens ?',
  'il y a des ados ?',
  'cours baby boxe où ça ?',
  'je vis aux minimes quelle salle',
  'manager de Portet',
  'qui gère Saint-Cyprien',
  'horaire lady punch ramonville',
  'hyrox saint-cyprien quelle heure',
  'mma ramonville',
  'jjb c’est à minimes ?',
  'c’est 29€ le mois ou 29,99',
  'l’abo à 259 c’est pour 12 mois ?',
  'c’est sans engagement ?',
  'comment je résilie',
  'la résil est immédiate ?',
  'je veux arrêter mon abo',
  'gants obligatoires dès le premier cours',
  'vous prêtez les gants à l’essai',
  'essai boxe anglaise 10 euros',
  'je veux juste tester',
  'inscription mineur comment ça marche',
  'certificat pour le loisir',
  'salles chauffées l’hiver ?',
  'ouvert samedi soir jusque quelle heure',
  'lady kick c’est où',
  'boxing lady minimes',
  'hiit états-unis',
  'grappling saint-cyprien',
  'k1 à cyprien',
  'boxe française portet',
  'badge 34,99 je le rends ?',
  'prélèvement toutes les 4 semaines',
  'vous êtes ouverts dimanche matin',
  'planning de toutes les salles',
  'montre-moi les horaires de st cyprien',
  'douches à Portet',
  'accès 5 salles avec le 29,99',
];
