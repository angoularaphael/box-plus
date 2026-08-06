'use strict';

const { chatCompletion, isAiEnabled } = require('./groq');

const KNOWLEDGE = `
Ressources Boxing Center (Toulouse) pour guider un adhérent qui envisage de résilier :

AVANTAGES ABONNEMENT
- Accès aux 5 salles : Minimes (12 rue de Fenouillet, 31200), Ramonville (33 rue des Ormes, 31530), Portet, États-Unis (388 avenue des États-Unis, 31200), St-Cyprien (11 Rue Sainte-Lucie, 31300).
- Toutes les disciplines, encadrement coach.
- Accès libre 6j/7 de 10h à 21h (musculation, cardio, boxe).
- Événements : Boxing Center Trophy, Anglaise, Pieds-Poing, stages (si à jour médicalement — voir manager).

ALTERNATIVES À LA RÉSILATION
- Manque de temps : consulter les plannings des 5 salles ; accès libre flexible 10h–21h.
- Déménagement : l’abo donne accès aux 5 centres — vérifier si le nouveau domicile est près d’une salle.
- Blessure / médical : suspension sans frais possibles pour conserver le tarif préférentiel à la reprise (voir manager).
- Changement de club : rappel accès multi-salles + associations partenaires (Nobles Arts Portésiens, Toulouse Mini Boxing Club).
- Financier : exceptionnellement, offre promo (~29 €) envisageable avec le manager avant de partir.
- Autre : écouter, proposer suspension / changement de formule / contact manager.

RÈGLES
- Français, ton chaleureux, concis (4–7 phrases max).
- Ne jamais inventer de tarifs précis hors « environ 29 € » pour la promo manager.
- Ne pas mentionner Deciplus, bots techniques, ni systèmes internes.
- Encourager à rester OU à parler au manager, sans forcer.
- Terminer par une question ouverte invitant à rester ou à préciser.
`.trim();

const FALLBACKS = {
  time: "Avez-vous pu consulter les plannings de nos cinq salles ? Votre abonnement donne aussi l'accès libre de 10h à 21h, 6 jours sur 7 — un autre créneau ou une autre salle pourrait mieux vous convenir. Souhaitez-vous qu’on regarde ça ensemble avant de partir ?",
  move: 'Votre abonnement donne accès aux 5 centres Boxing Center. Votre nouveau domicile ne se situe-t-il pas à proximité de l’un d’entre eux ? On peut vérifier avec vous.',
  medical:
    'En cas de blessure, vous pouvez souvent suspendre votre abonnement sans frais et conserver vos conditions tarifaires préférentielles à la reprise. En avez-vous parlé à votre manager de salle ?',
  club: 'Vous avez accès aux 5 salles, à toutes les disciplines, et à des associations partenaires. Peut-être qu’une autre formule ou une autre salle vous conviendrait mieux ?',
  money:
    'J’ai bien compris que le prix est un frein. Exceptionnellement, une offre promotionnelle autour de 29 € peut être envisagée avec votre manager — souhaitez-vous en parler avant de résilier ?',
  other:
    'Merci pour ces précisions. Avant toute décision, un échange avec votre manager de salle peut souvent débloquer la situation (suspension, autre formule, autre créneau). Que souhaitez-vous faire ?',
};

async function guideRetention({ reasonId, reasonLabel, freeText }) {
  const fallback = FALLBACKS[reasonId] || FALLBACKS.other;

  if (!isAiEnabled()) {
    return { reply: fallback, source: 'template' };
  }

  try {
    const { content } = await chatCompletion(
      [
        {
          role: 'system',
          content: `${KNOWLEDGE}\n\nTu es David, conseiller virtuel Boxing Center. Tu réponds UNIQUEMENT avec le message à afficher au membre (pas de markdown, pas de préambule).`,
        },
        {
          role: 'user',
          content: [
            `Motif choisi : ${reasonLabel || reasonId || 'autre'}`,
            freeText ? `Précision du membre : ${String(freeText).slice(0, 800)}` : 'Pas de précision libre.',
            '',
            'Rédige une réponse de rétention personnalisée à partir des ressources.',
          ].join('\n'),
        },
      ],
      { maxTokens: 420, temperature: 0.45 }
    );
    const reply = String(content || '')
      .replace(/^```[\w]*\n?|```$/g, '')
      .trim();
    return { reply: reply || fallback, source: 'groq' };
  } catch (err) {
    return { reply: fallback, source: 'template-fallback', error: err.message };
  }
}

module.exports = { guideRetention, FALLBACKS, KNOWLEDGE };
