'use strict';

const fact = (label, pattern) => ({ label, pattern });

const WRONG_OR_MIXED =
  /dimanche\s+\d{1,2}h|coach\s*:\s*(?:inconnu|à confirmer)|consulte[rz]?\s+(?:simplement\s+)?le planning|contacte[rz]?\s+la salle|toutes les informations sur (?:notre|le) site/i;

module.exports = [
  {
    id: 'baby-5-ans-minimes-contexte',
    persona: 'chloe',
    steps: [
      {
        q: 'Je veux inscrire mon fils de 5 ans, il y a quoi ?',
        must: [fact('cours', /Baby Boxe/i), fact('âge', /3\s*[–-]\s*6|dès 3 ans/i)],
        mustNot: [fact('âge faux', /7\s*[–-]\s*11|12\s*[–-]\s*16/i)],
      },
      {
        q: 'Aux Minimes.',
        must: [
          fact('salle', /Minimes/i),
          fact('jour', /samedi/i),
          fact('début', /14h15/i),
          fact('fin', /15h00/i),
          fact('cours', /Baby Boxe/i),
          fact('coach', /Mehdi B\./i),
        ],
        mustNot: [fact('cours voisin', /ÉDUCATIVE|EDUCATIVE|7\s*[–-]\s*11|12\s*[–-]\s*16/i)],
      },
      {
        q: "C'est quand ?",
        must: [
          fact('jour', /samedi/i),
          fact('début', /14h15/i),
          fact('fin', /15h00/i),
          fact('cours', /Baby Boxe/i),
        ],
        mustNot: [fact('cours voisin', /ÉDUCATIVE|EDUCATIVE/i)],
      },
      {
        q: 'Et le coach ?',
        must: [fact('coach', /Mehdi B\./i)],
        mustNot: [fact('manager', /manager|responsable de salle/i)],
      },
      {
        q: "Et c'est où exactement ?",
        must: [
          fact('salle', /Minimes/i),
          fact('adresse', /12 rue de Fenouillet/i),
          fact('ville', /31200 Toulouse/i),
        ],
      },
    ],
  },
  {
    id: 'baby-samedi-question-exacte',
    persona: 'fabien',
    steps: [
      {
        q: "C'est à quelle heure le cours de Baby Boxe samedi prochain aux Minimes ?",
        must: [
          fact('salle', /Minimes/i),
          fact('jour', /samedi/i),
          fact('début', /14h15/i),
          fact('fin', /15h00/i),
          fact('cours', /Baby Boxe/i),
          fact('coach', /Mehdi B\./i),
        ],
        mustNot: [
          fact('7–11 parasite', /7\s*[–-]\s*11/i),
          fact('12–16 parasite', /12\s*[–-]\s*16/i),
          fact('compétiteurs parasite', /ÉDUCATIVE COMPÉTITEURS|EDUCATIVE COMPETITEURS/i),
        ],
      },
    ],
  },
  {
    id: 'minimes-lundi-soir',
    persona: 'nassim',
    steps: [
      {
        q: "C'est quoi les horaires des Minimes lundi soir ?",
        must: [
          fact('salle', /Minimes/i),
          fact('compétiteurs', /18h00[–-]19h30.*BOXE COMPÉTITEURS/is),
          fact('féminin', /18h30[–-]19h30.*BOXING LADY/is),
          fact('loisirs', /19h40[–-]21h00.*BOXE ANGLAISE LOISIRS/is),
        ],
        mustNot: [fact('midi parasite', /12h40[–-]13h20/i), fact('accès libre', /ACC[ÈE]S LIBRE/i)],
      },
      {
        q: 'La boxe anglaise loisirs, je suis débutant je peux ?',
        must: [fact('niveau', /débutant|tous niveaux/i), fact('cours', /boxe anglaise loisirs/i), fact('lundi', /Lundi 19h40/i)],
        mustNot: [fact('autre jour', /Mardi|Mercredi|Jeudi|Vendredi|Samedi/i)],
      },
      {
        q: 'Qui est le coach ?',
        must: [fact('coach', /Mehdi B\./i)],
        mustNot: [fact('mauvais coach', /Chloé|Clément/i)],
      },
      {
        q: 'À quelle heure ça commence ?',
        must: [fact('début', /19h40/i)],
        mustNot: [fact('autre début', /18h00|18h30|12h40/i)],
      },
    ],
  },
  {
    id: 'ramonville-mardi-soir',
    persona: 'chloe',
    steps: [
      {
        q: 'Mardi soir à Ramonville, il y a quoi ?',
        must: [
          fact('salle', /Ramonville/i),
          fact('grappling', /18h40[–-]19h40.*GRAPPLING/is),
          fact('mma', /19h45[–-]21h15.*MMA TOUS NIVEAUX/is),
          fact('coach', /Jérôme/i),
        ],
        mustNot: [fact('midi parasite', /12h40[–-]13h20/i), fact('mauvais jour', /Lundi|Mercredi|Jeudi|Vendredi/i)],
      },
      {
        q: 'Et le MMA ?',
        must: [
          fact('cours', /MMA TOUS NIVEAUX/i),
          fact('début', /19h45/i),
          fact('fin', /21h15/i),
        ],
        mustNot: [fact('grappling parasite', /GRAPPLING/i)],
      },
      {
        q: 'Qui coach ?',
        must: [fact('coach', /Jérôme/i)],
      },
      {
        q: "C'est quel niveau ?",
        must: [fact('niveau', /tous niveaux|débutants acceptés/i)],
      },
    ],
  },
  {
    id: 'portet-samedi-provisoire',
    persona: 'fabien',
    steps: [
      {
        q: 'Et à Portet samedi, il y a quoi ?',
        must: [
          fact('salle', /Portet/i),
          fact('jour', /samedi/i),
          fact('provisoire', /provisoire/i),
          fact('boxe française', /10h00[–-]11h00.*BOXE FRANÇAISE/is),
          fact('baby', /15h00[–-]16h00.*BABY BOXE/is),
        ],
        mustNot: [fact('accès libre', /ACC[ÈE]S LIBRE/i)],
      },
      {
        q: 'Le cours pour un enfant de 5 ans ?',
        must: [
          fact('cours', /Baby Boxe/i),
          fact('début', /15h00/i),
          fact('fin', /16h00/i),
        ],
        mustNot: [fact('autre âge', /7\s*[–-]\s*11|12\s*[–-]\s*16/i)],
      },
      {
        q: 'Et les coachs ?',
        must: [
          fact('coach 1', /Valentin Tapia/i),
          fact('coach 2', /Mourad/i),
          fact('coach 3', /Ingrid/i),
        ],
      },
    ],
  },
  {
    id: 'changement-jour-et-salle',
    persona: 'chloe',
    steps: [
      {
        q: "Qu'est-ce qu'il y a lundi à Ramonville ?",
        must: [fact('salle', /Ramonville/i), fact('jour', /lundi/i), fact('loisirs', /BOXE ANGLAISE LOISIRS/i)],
        mustNot: [fact('mardi', /Mardi/i)],
      },
      {
        q: 'Et mardi soir ?',
        must: [
          fact('salle conservée', /Ramonville/i),
          fact('grappling', /GRAPPLING/i),
          fact('mma', /MMA TOUS NIVEAUX/i),
        ],
        mustNot: [fact('lundi résiduel', /BOXE ANGLAISE LOISIRS|Lundi/i), fact('midi parasite', /12h40/i)],
      },
      {
        q: 'Et à Portet mardi soir ?',
        must: [
          fact('nouvelle salle', /Portet/i),
          fact('lady', /18h00[–-]19h00.*LADY KICK/is),
          fact('kick', /19h00[–-]20h00.*KICK \/ K1/is),
          fact('provisoire', /provisoire/i),
        ],
        mustNot: [fact('ancienne salle', /Ramonville/i), fact('mma parasite', /MMA/i)],
      },
      {
        q: 'Et le coach ?',
        must: [fact('coach', /Samuel Pinto/i)],
        mustNot: [fact('manager', /Valentin(?! Tapia)/i), fact('ancien coach', /Jérôme/i)],
      },
    ],
  },
  {
    id: 'mma-mardi-sans-salle',
    persona: 'nassim',
    steps: [
      {
        q: 'Il y a du MMA mardi ?',
        must: [
          fact('Ramonville', /Ramonville/i),
          fact('horaire Ramonville', /19h45[–-]21h15/i),
          fact('États-Unis', /États-Unis|Etats-Unis/i),
          fact('horaire États-Unis', /19h40[–-]21h00/i),
        ],
        mustNot: [fact('salle fausse', /Portet|Minimes|Saint-Cyprien/i)],
      },
      {
        q: 'Et là-bas le coach ?',
        must: [fact('désambiguïsation', /Ramonville|États-Unis|laquelle|quelle salle/i)],
        mustNot: [fact('coach arbitraire', /^.*(?:Jérôme|Zouhir).*$/i)],
      },
    ],
  },
  {
    id: 'comparaison-deux-salles-explicites',
    persona: 'chloe',
    steps: [
      {
        q: 'Compare le MMA mardi à Ramonville et aux États-Unis.',
        must: [
          fact('Ramonville', /Ramonville/i),
          fact('horaire Ramonville', /19h45[–-]21h15/i),
          fact('coach Ramonville', /Jérôme/i),
          fact('États-Unis', /États-Unis|Etats-Unis/i),
          fact('horaire États-Unis', /19h40[–-]21h00/i),
          fact('coach États-Unis', /Zouhir/i),
        ],
        mustNot: [fact('autre salle', /Portet|Minimes|Saint-Cyprien/i)],
      },
    ],
  },
  {
    id: 'adresse-pronominale',
    persona: 'fabien',
    steps: [
      {
        q: 'Je cherche le MMA à Ramonville mardi.',
        must: [fact('salle', /Ramonville/i), fact('horaire', /19h45[–-]21h15/i)],
      },
      {
        q: 'Où se trouve la salle ?',
        must: [fact('adresse', /33 rue des Ormes/i), fact('ville', /31520 Ramonville-Saint-Agne/i)],
      },
      {
        q: "Et la salle dont vous venez de me parler, elle est où exactement ?",
        must: [fact('adresse mémorisée', /33 rue des Ormes/i)],
      },
    ],
  },
  {
    id: 'fautes-et-formulations-courtes',
    persona: 'chloe',
    steps: [
      {
        q: 'ramonvile mardi soir ya koi',
        must: [fact('salle', /Ramonville/i), fact('grappling', /GRAPPLING/i), fact('mma', /MMA/i)],
        mustNot: [fact('midi parasite', /12h40/i)],
      },
      {
        q: 'mma ki coach',
        must: [fact('coach', /Jérôme/i)],
      },
      {
        q: 'sa komance kan',
        must: [fact('début', /19h45/i)],
      },
    ],
  },
  {
    id: 'meme-cours-autre-salle',
    persona: 'chloe',
    steps: [
      {
        q: 'Baby Boxe samedi aux Minimes ?',
        must: [fact('salle', /Minimes/i), fact('horaire', /14h15[–-]15h00/i), fact('coach', /Mehdi B\./i)],
        mustNot: [fact('cours voisin', /7\s*[–-]\s*11|12\s*[–-]\s*16/i)],
      },
      {
        q: 'Et à Ramonville ?',
        must: [
          fact('nouvelle salle', /Ramonville/i),
          fact('même jour', /samedi/i),
          fact('horaire', /14h15[–-]15h00/i),
          fact('coach', /Valentin Guth/i),
        ],
        mustNot: [fact('ancienne salle', /Minimes/i), fact('ancien coach', /Mehdi/i)],
      },
      {
        q: 'Elle est où ?',
        must: [fact('adresse', /33 rue des Ormes/i), fact('ville', /31520 Ramonville-Saint-Agne/i)],
      },
    ],
  },
  {
    id: 'pronoms-sur-mma',
    persona: 'nassim',
    steps: [
      {
        q: 'Le MMA mardi soir à Ramonville ?',
        must: [fact('cours', /MMA/i), fact('horaire', /19h45[–-]21h15/i), fact('coach', /Jérôme/i)],
      },
      {
        q: 'Il commence quand ?',
        must: [fact('début', /19h45/i)],
        mustNot: [fact('grappling parasite', /GRAPPLING/i)],
      },
      {
        q: 'Ce cours est pour quel niveau ?',
        must: [fact('niveau', /tous niveaux|débutants acceptés/i)],
      },
    ],
  },
  {
    id: 'coach-plusieurs-cours',
    persona: 'fabien',
    steps: [
      {
        q: 'Quels cours fait Jérôme mardi à Ramonville ?',
        must: [
          fact('coach', /Jérôme/i),
          fact('grappling', /GRAPPLING/i),
          fact('mma', /MMA TOUS NIVEAUX/i),
        ],
        mustNot: [fact('autre coach', /Hicham/i)],
      },
      {
        q: 'Et leurs horaires ?',
        must: [fact('grappling', /18h40[–-]19h40/i), fact('mma', /19h45[–-]21h15/i)],
        mustNot: [fact('autre coach', /Hicham/i), fact('midi parasite', /12h40/i)],
      },
    ],
  },
  {
    id: 'horaire-chevauchant',
    persona: 'chloe',
    steps: [
      {
        q: 'Aux Minimes, quels cours sont en cours lundi à 19h ?',
        must: [
          fact('compétiteurs', /18h00[–-]19h30.*BOXE COMPÉTITEURS/is),
          fact('boxing lady', /18h30[–-]19h30.*BOXING LADY/is),
          fact('coach Mehdi', /Mehdi B\./i),
          fact('coach Chloé', /Chloé/i),
        ],
        mustNot: [fact('pas encore commencé', /19h40[–-]21h00/i)],
      },
    ],
  },
  {
    id: 'discipline-absente-de-la-v4',
    persona: 'fabien',
    steps: [
      {
        q: 'Il y a du yoga mardi à Ramonville ?',
        must: [fact('absence claire', /aucun|pas de|rien/i), fact('discipline', /Yoga/i), fact('salle', /Ramonville/i)],
        mustNot: [fact('cours inventé', /\d{1,2}h\d{2}[–-]\d{1,2}h\d{2}.*YOGA/is)],
      },
    ],
  },
  ...['chloe', 'fabien', 'nassim'].map((persona) => ({
    id: `fait-identique-${persona}`,
    persona,
    steps: [
      {
        q: 'MMA mardi à Ramonville : heure, coach et niveau ?',
        must: [
          fact('horaire', /19h45[–-]21h15/i),
          fact('coach', /Jérôme/i),
          fact('niveau', /tous niveaux|débutants acceptés/i),
        ],
        mustNot: [fact('autre salle', /États-Unis|Portet|Minimes|Saint-Cyprien/i)],
      },
    ],
  })),
  {
    id: 'absence-non-inventee',
    persona: 'nassim',
    steps: [
      {
        q: 'MMA à Portet mardi soir ?',
        must: [fact('absence', /pas de|aucun|rien/i), fact('salle', /Portet/i), fact('jour', /mardi/i)],
        mustNot: [fact('horaire inventé', /\d{1,2}h\d{2}[–-]\d{1,2}h\d{2}.*MMA/is)],
      },
      {
        q: 'Et du grappling ?',
        must: [fact('absence', /pas de|aucun|rien/i)],
        mustNot: [fact('horaire inventé', /\d{1,2}h\d{2}[–-]\d{1,2}h\d{2}.*GRAPPLING/is)],
      },
    ],
  },
  {
    id: 'prix-essai-debutant',
    persona: 'fabien',
    steps: [
      {
        q: "C'est combien ?",
        must: [fact('offre récurrente', /29,99/i), fact('période', /4 semaines|28 jours/i), fact('offre saison', /259/i)],
      },
      {
        q: 'Je peux venir faire un essai ?',
        must: [fact('prix essai', /10\s*€/i), fact('réservation', /réserv|en ligne/i)],
      },
      {
        q: 'Je suis débutant, je peux faire ce cours ?',
        must: [fact('réponse contextualisée', /débutant|tous niveaux/i)],
      },
    ],
  },
  {
    id: 'difference-cours',
    persona: 'chloe',
    steps: [
      {
        q: "C'est quoi la différence entre le MMA et le grappling ?",
        must: [
          fact('mma', /MMA/i),
          fact('grappling', /grappling/i),
          fact('frappes', /frappe/i),
          fact('sol', /sol|soumission/i),
        ],
      },
      {
        q: "C'est quoi la différence entre les cours ?",
        must: [fact('baby', /Baby Boxe/i), fact('éducative', /éducative|educative/i), fact('loisirs', /loisir|tous niveaux/i)],
      },
    ],
  },
  {
    id: 'cinq-ans-quand-sans-salle',
    persona: 'chloe',
    steps: [
      {
        q: 'Je cherche un cours pour mon fils de 5 ans.',
        must: [fact('cours', /Baby Boxe/i)],
      },
      {
        q: "C'est quand ?",
        must: [fact('jour', /samedi/i), fact('début Minimes', /14h15/i)],
        mustNot: [fact('éducative parasite', /7\s*[–-]\s*11|12\s*[–-]\s*16/i)],
      },
      {
        q: "Et c'est où ?",
        must: [
          fact('adresse Minimes', /12 rue de Fenouillet/i),
          fact('adresse Ramonville', /33 rue des Ormes/i),
        ],
        mustNot: [fact('menu générique', /Offres, salles|dis-moi juste|partir sur quoi/i)],
      },
    ],
  },
  {
    id: 'jjb-contexte-salle-bot',
    persona: 'chloe',
    steps: [
      {
        q: 'Je veux faire du JJB',
        must: [
          fact('discipline', /JJB|Jiu-Jitsu/i),
          fact('salle', /États-Unis|Etats-Unis/i),
          fact('horaire', /18h20[–-]19h00/i),
          fact('coach', /Zouhir/i),
        ],
        mustNot: [fact('autre salle', /Portet|Minimes|Ramonville|Saint-Cyprien/i)],
      },
      {
        q: "c'est quand ?",
        must: [
          fact('salle', /États-Unis|Etats-Unis/i),
          fact('lundi', /18h20[–-]19h00/i),
          fact('mercredi', /19h40[–-]21h00/i),
          fact('coach', /Zouhir/i),
        ],
        mustNot: [fact('grappling parasite', /GRAPPLING/i)],
      },
      {
        q: 'où ?',
        must: [fact('adresse', /388 avenue des États-Unis|388 avenue des Etats-Unis/i), fact('ville', /31200 Toulouse/i)],
        mustNot: [fact('menu générique', /Offres, salles|dis-moi juste/i)],
      },
    ],
  },
  {
    id: 'gym-switch-mma-etats-unis',
    persona: 'fabien',
    steps: [
      {
        q: 'MMA jeudi à Ramonville',
        must: [fact('horaire', /19h45[–-]21h15/i), fact('coach', /Jérôme/i)],
      },
      {
        q: 'à États-Unis plutôt',
        must: [
          fact('nouvelle salle', /États-Unis|Etats-Unis/i),
          fact('cours', /MMA/i),
          fact('horaire', /19h40[–-]21h00/i),
          fact('coach', /Zouhir/i),
        ],
        mustNot: [fact('ancienne salle', /Ramonville/i), fact('ancien horaire', /19h45/i), fact('lien seul', /se trouve au/i)],
      },
      {
        q: 'et vendredi ?',
        must: [fact('salle', /États-Unis|Etats-Unis/i), fact('cours', /MMA/i), fact('horaire', /19h40[–-]21h00/i), fact('coach', /Zouhir/i)],
        mustNot: [fact('jjb parasite', /JIU-JITSU|JJB/i), fact('ancienne salle', /Ramonville/i)],
      },
    ],
  },
  {
    id: 'fautes-boxing-camp',
    persona: 'nassim',
    steps: [
      {
        q: 'boxin camp minime mardi',
        must: [fact('salle', /Minimes/i), fact('cours', /BOXING CAMP/i), fact('horaire', /18h30[–-]19h30/i), fact('coach', /Clément/i)],
        mustNot: [fact('autres cours', /BOXE ANGLAISE|BOXE COMPÉTITEURS|COMPETITEURS/i)],
      },
      {
        q: 'c kan ?',
        must: [fact('horaire', /18h30[–-]19h30/i), fact('cours', /BOXING CAMP/i)],
      },
      {
        q: 'ki coach ?',
        must: [fact('coach', /Clément/i)],
        mustNot: [fact('mauvais coach', /Mehdi/i)],
      },
      {
        q: 'ou ?',
        must: [fact('adresse', /12 rue de Fenouillet/i), fact('ville', /31200 Toulouse/i)],
      },
    ],
  },
  {
    id: 'acces-libre-polarite',
    persona: 'chloe',
    steps: [
      {
        q: 'Quels cours samedi Minimes, sans accès libre ?',
        must: [fact('boxing camp', /BOXING CAMP/i), fact('baby', /BABY BOXE/i)],
        mustNot: [fact('accès libre', /ACC[ÈE]S LIBRE/i)],
      },
      {
        q: 'Uniquement les accès libres mardi Minimes ?',
        must: [fact('matin', /10h00[–-]12h00.*ACC[ÈE]S LIBRE/is), fact('après-midi', /13h20[–-]18h00.*ACC[ÈE]S LIBRE/is)],
        mustNot: [fact('cours encadré', /BOXE ANGLAISE|BOXING CAMP|BOXE COMPÉTITEURS|COMPETITEURS/i)],
      },
    ],
  },
  {
    id: 'grappling-mercredi-etats-unis',
    persona: 'chloe',
    steps: [
      {
        q: 'Grappling mercredi États-Unis : quelle heure et quel coach ?',
        must: [fact('absence', /aucun|pas de|rien/i), fact('discipline', /Grappling/i), fact('jour', /mercredi/i)],
        mustNot: [fact('horaire inventé', /\d{1,2}h\d{2}[–-]\d{1,2}h\d{2}.*GRAPPLING/is)],
      },
    ],
  },
  {
    id: 'boxing-camp-niveau',
    persona: 'fabien',
    steps: [
      {
        q: 'Boxing Camp mardi Minimes : est-ce tous niveaux ?',
        must: [
          fact('horaire', /18h30[–-]19h30/i),
          fact('coach', /Clément/i),
          fact('niveau', /Tous niveaux/i),
          fact('cours', /BOXING CAMP/i),
        ],
        mustNot: [fact('autres cours', /BOXE ANGLAISE|BOXE COMPÉTITEURS|COMPETITEURS/i)],
      },
    ],
  },
  {
    id: 'hyrox-ou-et-quand',
    persona: 'fabien',
    steps: [
      {
        q: "HYROX c'est où et quand ?",
        must: [
          fact('cyprien', /Saint-Cyprien|St-Cyprien/i),
          fact('cyprien horaire', /18h20[–-]19h00/i),
          fact('etats-unis', /États-Unis|Etats-Unis/i),
          fact('etats horaire', /18h40[–-]19h20/i),
          fact('coach Brice', /Brice/i),
          fact('coach Yannis', /Yannis/i),
        ],
        mustNot: [fact('lien à la place des heures', /Pour l['’]horaire|Lien planning/i)],
      },
    ],
  },
  {
    id: 'coach-sans-contexte',
    persona: 'chloe',
    steps: [
      {
        q: 'Qui est le coach ?',
        must: [fact('demande le cours', /cours|salle/i)],
        mustNot: [fact('coach inventé', /Mehdi|Jérôme|Zouhir|Clément|Hicham/i)],
      },
    ],
  },
].map((scenario) => ({
  ...scenario,
  steps: scenario.steps.map((step) => ({
    ...step,
    must: step.must || [],
    mustNot: [...(step.mustNot || []), fact('réponse vague', WRONG_OR_MIXED)],
  })),
}));
