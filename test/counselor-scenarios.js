'use strict';

/**
 * Conversations visiteur : chaque scénario enchaîne plusieurs tours
 * (l’historique est conservé, comme le widget du site).
 */

const NO_MENU =
  /dis-moi juste ce que tu cherches|Offres, salles, essai|partir sur quoi en premier|Balance ta question|Que souhaitez-vous savoir \?|À votre disposition pour comparer/i;

const NEVER = [
  /64,75/,
  /jamais obligatoire/i,
  /ouverts 7j\/7(?! »)/i,
  /dimanche 10h/i,
  /dès 2 ans/i,
];

function step(q, extra = {}) {
  return { q, mustNot: [NO_MENU], failIf: NEVER, ...extra };
}

module.exports = [
  {
    id: 'parent-3-ans-fil-screenshot',
    persona: 'chloe',
    steps: [
      step('J’ai un enfant de 3 ans qui veut boxer', { must: [/Baby Boxe/i, /3 ans/] }),
      step('Je veux les plannings', {
        must: [/Minimes/, /Ramonville/, /Portet/],
        mustNot: [/Le plus simple : ouvre/],
        expectSource: 'redirect-planning',
      }),
      step('Je veux les plannings de la baby boxe', {
        must: [/Baby Boxe/i, /Minimes/, /salle-de-boxe-toulouse-minimes/],
        mustNot: [/Le plus simple : ouvre/],
      }),
      step('Minimes', {
        must: [/Minimes/, /planning|Fenouillet/i],
      }),
      step('l’ouvrir', { must: [/minimes/i], expectSource: 'redirect-planning' }),
    ],
  },
  {
    id: 'parent-3-ans-salle-puis-planning',
    persona: 'chloe',
    steps: [
      step('J’ai un fils de 3 ans comment faire pour l’inscrire ?', { must: [/Baby Boxe/i] }),
      step('Et c’est dans quelle salle ?', { must: [/Minimes/, /Ramonville/, /Portet/] }),
      step('Je veux les horaires', {
        must: [/Minimes|Ramonville|Portet/],
        mustNot: [/Le plus simple : ouvre/],
      }),
      step('Ramonville', { must: [/Ramonville/i] }),
    ],
  },
  {
    id: 'parent-relance-enfants-trois-fois',
    persona: 'chloe',
    steps: [
      step('Ya pas de cours pour les enfants ?', { must: [/Baby Boxe/i] }),
      step('Ya pas de cours pour les enfants ?', { must: [/Baby Boxe|Minimes|7–11/i], notClone: true }),
      step('Et les petits de 3 ans alors ?', { must: [/Baby Boxe/i, /3 ans/], notClone: true }),
    ],
  },
  {
    id: 'ages-chaines',
    persona: 'nassim',
    steps: [
      step('Mon bébé a 2 ans', { must: [/3 ans/], failIf: [/dès 2 ans/i] }),
      step('OK il aura 3 ans en janvier, on fait comment ?', { must: [/Baby Boxe|en ligne/i] }),
      step('Et à 8 ans ce sera quoi ?', { must: [/7–11|7-11|Éducative|educative/i] }),
    ],
  },
  {
    id: 'ado-puis-adulte',
    persona: 'chloe',
    steps: [
      step('Ado de 14 ans', { must: [/12–16|12-16/i] }),
      step('Et pour moi je débute', { must: [/tous niveaux|débutant/i] }),
      step('C’est combien l’abo ?', { must: [/29,99/, /259/] }),
    ],
  },
  {
    id: 'debutant-essai-tarif-clim',
    persona: 'fabien',
    steps: [
      step('Je n’ai jamais boxé, c’est possible ?', {
        must: [/vous|souhaitez/i],
        mustNot: [/\btu\b|\bton\b/i],
      }),
      step('Je veux essayer avant', { must: [/10\s*€/], mustNot: [/\btu\b|\bton\b/i] }),
      step('C’est 29 euros par mois ?', { must: [/29,99/, /4 semaines|28 jours/i] }),
      step('Les salles sont climatisées ?', { must: [/pas climatis|ne sont pas/i] }),
    ],
  },
  {
    id: 'femme-lady-planning',
    persona: 'chloe',
    steps: [
      step('Les femmes peuvent participer ?', { must: [/Boxing Lady|Lady Punch/i] }),
      step('Lady Punch c’est où ?', { must: [/Ramonville|Cyprien|États-Unis|Etats-Unis/i] }),
      step('horaires Ramonville', {
        must: [/ramonville/i, /voir le planning/],
        expectSource: 'redirect-planning',
      }),
      step('l’ouvrir', { must: [/ramonville/i] }),
    ],
  },
  {
    id: 'jjb-pas-resil-puis-planning',
    persona: 'chloe',
    steps: [
      step('c’est quoi le Jiu-Jitsu Brésilien', {
        must: [/sol|sans frappe/i],
        mustNot: [/David.*72/],
      }),
      step('JJB aux États-Unis c’est quel horaire ?', {
        must: [/etats-unis/i, /voir le planning/],
        expectSource: 'redirect-planning',
      }),
      step('et comment je résilie', { must: [/David|72/i], expectSource: 'redirect-david' }),
    ],
  },
  {
    id: 'ouverture-vs-planning',
    persona: 'chloe',
    steps: [
      step('Vous êtes ouverts le dimanche ?', { must: [/samedi|dimanche/i], failIf: [/ouverts 7j/i] }),
      step('Quels sont vos horaires d’ouverture ?', { must: [/10h/, /21h30/], mustNot: [/tous les plannings/] }),
      step('je veux voir le planning', {
        must: [/tous les plannings/],
        expectSource: 'redirect-planning',
      }),
      step('Saint-Cyprien', { must: [/Cyprien|cyprien/i] }),
    ],
  },
  {
    id: 'tarif-badge-resil',
    persona: 'chloe',
    steps: [
      step('Quelle offre promouvoir en priorité ?', { must: [/29,99/, /259/] }),
      step('le badge est remboursé ?', { must: [/badge/i, /rembours|propri/i] }),
      step('je veux résilier mon abonnement', { must: [/David|72/], expectSource: 'redirect-david' }),
      step('si je n’utilise pas je suis remboursé ?', { must: [/non-utilisation|rembours/i] }),
    ],
  },
  {
    id: 'salles-adresses-managers',
    persona: 'chloe',
    steps: [
      step('Vous avez quelles salles ?', { must: [/Minimes/, /Portet/] }),
      step('C’est où Minimes ?', { must: [/Fenouillet/i] }),
      step('C’est qui le manager ?', { must: [/Mehdi/i] }),
      step('et Portet', { must: [/Valentin|Portet/i] }),
    ],
  },
  {
    id: 'disciplines-enchainées',
    persona: 'nassim',
    steps: [
      step('Vous faites du MMA ?', { must: [/MMA/i] }),
      step('et du grappling', { must: [/sol|sans frappe/i], notClone: true }),
      step('HYROX ?', { must: [/HYROX/i] }),
      step('savate', { must: [/Portet/i] }),
    ],
  },
  {
    id: 'club-pratique',
    persona: 'chloe',
    steps: [
      step('Il y a des douches ?', { must: [/douche/i] }),
      step('et des casiers', { must: [/casier/i] }),
      step('on peut fumer', { must: [/interdit/i] }),
      step('filmer dans les vestiaires ?', { must: [/vestiaire/i], failIf: [/oui.*vestiaire/i] }),
    ],
  },
  {
    id: 'switch-enfant-vers-abo-vers-dimanche',
    persona: 'chloe',
    steps: [
      step('cours pour les enfants', { must: [/Baby Boxe/i] }),
      step('c’est combien', { must: [/29,99/, /259/] }),
      step('vous ouvrez dimanche matin', { must: [/samedi|dimanche/i] }),
      step('planning baby boxe', { must: [/Minimes/, /Baby Boxe/i], mustNot: [/Le plus simple : ouvre/] }),
    ],
  },
  {
    id: 'essai-pas-confondu-planning',
    persona: 'chloe',
    steps: [
      step('je veux une séance d’essai à 10 €', { must: [/10\s*€/], mustNot: [/voir le planning/] }),
      step('le matériel est prêté ?', { must: [/prêt|prêté|prete/i] }),
      step('planning Minimes', { must: [/minimes/i, /voir le planning/] }),
    ],
  },
  {
    id: 'balma-puis-vrai-reseau',
    persona: 'fabien',
    steps: [
      step('Il y a encore une salle à Balma ?', { must: [/pas dans le périmètre|n’est pas|5 salles/i] }),
      step('donc lesquelles', { must: [/Minimes|Ramonville|Portet/i] }),
    ],
  },
  {
    id: 'competiteurs-vs-debutant',
    persona: 'chloe',
    steps: [
      step('Les cours compétiteurs c’est pour qui ?', { must: [/confirm|compétit/i] }),
      step('je débute je peux y aller ?', { must: [/tous niveaux|confirm|loisir|débutant/i] }),
    ],
  },
  {
    id: 'screenshot-fils-3-ans-minimes-pas-manager',
    persona: 'chloe',
    steps: [
      step('Mon fils a 3 ans et veut boxer', { must: [/Baby Boxe/i], failIf: [/\d{1,2}h\d{2}/] }),
      step('Minimes', {
        must: [/Minimes/, /planning/i, /minimes/i],
        mustNot: [/Le manager de \*\*Minimes\*\*/],
        failIf: [/Le manager de/],
      }),
      step('Le planning', {
        must: [/Minimes|minimes/i, /planning/i],
        mustNot: [/Quelle salle te va/],
      }),
      step('Minime', { must: [/Minimes|minimes/i] }),
    ],
  },
  {
    id: 'screenshot-groq-mehdi-puis-minimes',
    persona: 'chloe',
    steps: [
      {
        q: 'Minimes',
        seedBot:
          'Baby Boxe accueille les enfants dès **3 ans**: cours ludiques. à **Saint-Cyprien** 14h15–15h00 avec le coach **Mehdi B.** Dis-moi dans quel club tu souhaites inscrire ton petit ?',
        must: [/Minimes/, /planning/i],
        failIf: [/Le manager de/],
        mustNot: [/dis-moi juste ce que tu cherches/i],
      },
    ],
  },
  {
    id: 're-enchaîne-planning-salles',
    persona: 'chloe',
    steps: [
      step('planning', { must: [/plannings|planning/i] }),
      step('Portet', { must: [/Portet|portet/i] }),
      step('et Cyprien', { must: [/cyprien/i] }),
      step('et États-Unis', { must: [/etats-unis|États-Unis/i] }),
    ],
  },
  {
    id: 'v4-visiteur-boxe-anglaise-minimes',
    persona: 'chloe',
    steps: [
      step('Bonjour, je n’ai jamais boxé. Je peux commencer par la boxe anglaise ?', {
        must: [/débutant|tous niveaux|sans.*expérience/i],
      }),
      step('Je préfère Minimes lundi soir, quel créneau et quel coach ?', {
        must: [/Minimes/i, /19h40/, /21h00/, /Mehdi/i],
        failIf: [/compétiteurs.*première séance/i],
      }),
      step('Et la salle est où exactement ?', { must: [/12 rue de Fenouillet/i] }),
    ],
  },
  {
    id: 'v4-visiteur-mma-ramonville',
    persona: 'nassim',
    steps: [
      step('Le MMA est accessible si je suis totalement débutant ?', {
        must: [/débutant|tous niveaux|progress/i],
      }),
      step('Je voudrais le faire à Ramonville le mardi, c’est à quelle heure ?', {
        must: [/Ramonville/i, /19h45/, /21h15/, /Jérôme/i],
      }),
      step('Le MMA mélange quoi exactement ?', { must: [/frappe|striking/i, /sol|lutte/i] }),
    ],
  },
  {
    id: 'v4-visiteuse-lady-punch-cyprien',
    persona: 'chloe',
    steps: [
      step('Je cherche un cours uniquement pour les femmes, vous avez quoi ?', {
        must: [/Boxing Lady|Lady Punch/i, /100\s*%|fémini/i],
      }),
      step('Lady Punch à Saint-Cyprien jeudi, quel horaire et quel coach ?', {
        must: [/Cyprien/i, /18h20/, /19h00/, /Dadi/i],
      }),
      step('C’est quelle adresse ?', { must: [/11 rue Sainte-Lucie/i] }),
    ],
  },
  {
    id: 'v4-parent-baby-boxe-portet',
    persona: 'fabien',
    steps: [
      step('Ma fille vient d’avoir 3 ans, quel cours est adapté ?', {
        must: [/Baby Boxe/i, /3 ans/],
        mustNot: [/boxe anglaise adulte/i],
      }),
      step('À Portet le samedi, vous avez l’horaire et les coachs ?', {
        must: [/Portet/i, /15h00/, /16h00/, /Valentin/i, /Mourad/i, /Ingrid/i],
      }),
      step('Ces horaires sont définitifs ?', { must: [/provisoire/i] }),
    ],
  },
  {
    id: 'v4-parent-etats-unis-3-6-ans',
    persona: 'chloe',
    steps: [
      step('Aux États-Unis, il y a de la Baby Boxe pour mon fils de 5 ans ?', {
        must: [/pieds-poings/i, /3–6|3-6/i],
        mustNot: [/Baby Boxe.*États-Unis/i],
      }),
      step('Quel est le créneau exact ?', {
        must: [/États-Unis|Etats-Unis/i, /14h15/, /15h00/, /Renaud/i],
      }),
      step('Et pour sa sœur de 8 ans ?', { must: [/7–11|7-11|éducative|pieds-poings/i] }),
    ],
  },
  {
    id: 'v4-visiteur-essai-puis-offre',
    persona: 'nassim',
    steps: [
      step('Je veux tester avant de m’engager, ça coûte combien ?', { must: [/10\s*€/] }),
      step('Pour l’essai, vous prêtez les gants ?', { must: [/prêt|matériel/i] }),
      step('Si ça me plaît, quelles sont les deux promos ?', {
        must: [/29,99/, /4 semaines|28 jours/i, /259/, /12 mois/i],
        failIf: [/29,99.*par mois/i],
      }),
      step('Je veux surtout économiser sur un an', { must: [/259/, /12 mois|année/i] }),
    ],
  },
  {
    id: 'v4-adherent-resiliation-72h',
    persona: 'fabien',
    steps: [
      step('Je souhaite résilier mon abonnement sans engagement', {
        must: [/David|Gérer mon abonnement|72/i],
        expectSource: 'redirect-david',
      }),
      step('Je suis prélevé dans deux jours, ce sera arrêté avant ?', { must: [/72|échéance|prélev/i] }),
      step('La période que j’ai déjà payée est remboursée au prorata ?', {
        must: [/pas.*rembours|non.*rembours|période déjà payée/i],
      }),
    ],
  },
  {
    id: 'v4-visiteur-securite-et-reglement',
    persona: 'chloe',
    steps: [
      step('Pour du loisir, le certificat médical est toujours obligatoire ?', {
        must: [/pas systématiquement|compétiteur|licencié/i],
        failIf: [/jamais obligatoire/i],
      }),
      step('Si j’arrive avec 15 minutes de retard je peux participer ?', {
        must: [/10 minutes|refus|coach|échauffement/i],
      }),
      step('Et si je ressens un malaise pendant le cours ?', {
        must: [/arrêt|arrêter|coach|personnel|santé/i],
      }),
    ],
  },
];

/** Questions factuelles : un menu générique au milieu d’un fil = faille. */
module.exports.CHAOS_QUESTIONS = [
  'J’ai un fils de 3 ans',
  'Je veux les plannings',
  'Baby Boxe',
  'Minimes',
  'C’est combien',
  'Vous êtes ouverts le dimanche ?',
  'Je n’ai jamais boxé',
  'Séance d’essai',
  'c’est quoi le JJB',
  'je veux résilier',
  'Lady Punch',
  'horaires Ramonville',
  'Il y a des douches ?',
  'badge remboursé',
  'manager de Portet',
  'MMA',
  '2 ans on peut inscrire',
  'tarif étudiant',
  'l’ouvrir',
  'et dans quelle salle',
];
