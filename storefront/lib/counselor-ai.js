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
- Financier : exceptionnellement, l’offre à 29 € peut être envisagée avec le manager avant de partir. Dire exactement « 29 € », jamais « environ 29 € ».
- Autre : écouter, proposer suspension / changement de formule / contact manager.

RÈGLES
- Français, ton chaleureux, très concis : 2 ou 3 phrases, 55 mots maximum.
- Ne jamais dire bonjour : la conversation est déjà commencée.
- Ne répéter ni le motif du membre, ni une idée déjà formulée.
- Une seule question maximum. Ne poser une question que si elle est indispensable.
- Ne jamais inventer un tarif. Le seul tarif autorisé ici est exactement « 29 € ».
- Si la réponse n’est pas certaine, proposer directement le manager de la salle au lieu d’improviser.
- Ne pas mentionner Deciplus, bots techniques, ni systèmes internes.
- Encourager à rester OU à parler au manager, sans forcer.
`.trim();

const FALLBACKS = {
  time: "Votre abonnement donne accès aux cinq salles et à l’accès libre de 10h à 21h, 6 jours sur 7. Un autre créneau ou une autre salle pourrait mieux vous convenir.",
  move: 'Votre abonnement donne accès aux cinq salles Boxing Center. Vérifiez si l’une d’elles reste proche de votre nouveau domicile.',
  medical:
    'En cas de blessure, une suspension sans frais peut être étudiée pour conserver vos conditions tarifaires. Votre manager de salle pourra la confirmer.',
  club: 'Votre formule donne accès aux cinq salles et à toutes les disciplines. Le manager peut vous proposer une autre salle ou une formule plus adaptée.',
  money:
    'Si le prix est le problème, une offre à 29 € peut exceptionnellement être étudiée par votre manager de salle.',
  other:
    'Votre manager de salle peut vérifier une suspension, un autre créneau ou une formule mieux adaptée. Je peux vous transmettre son contact.',
};

function cleanReply(content, fallback) {
  let reply = String(content || '')
    .replace(/^```[\w]*\n?|```$/g, '')
    .replace(/^(bonjour|bonsoir|salut)[\s,!.:;-]*/i, '')
    .replace(/\benviron\s+29\s*€/gi, '29 €')
    .trim();
  if (!reply) return fallback;

  const sentences = reply.match(/[^.!?]+[.!?]?/g) || [reply];
  const seen = new Set();
  const unique = [];
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(sentence.trim());
    if (unique.length === 3) break;
  }
  reply = unique.join(' ').trim();
  const words = reply.split(/\s+/);
  if (words.length > 55) reply = `${words.slice(0, 55).join(' ').replace(/[,;:]$/, '')}.`;
  return reply || fallback;
}

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
            'Rédige une seule réponse nouvelle, sans répéter les éléments déjà dits. Si tu ne sais pas, redirige vers le manager.',
          ].join('\n'),
        },
      ],
      { maxTokens: 160, temperature: 0.25 }
    );
    const reply = cleanReply(content, fallback);
    return { reply: reply || fallback, source: 'groq' };
  } catch (err) {
    return { reply: fallback, source: 'template-fallback', error: err.message };
  }
}

module.exports = { guideRetention, FALLBACKS, KNOWLEDGE };
