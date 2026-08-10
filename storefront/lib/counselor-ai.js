'use strict';

const { chatCompletion, isAiEnabled } = require('./groq');

const KNOWLEDGE = `
Ressources Boxing Center (Toulouse) pour accompagner un adhérent (résiliation, formule, salles) :

AVANTAGES ABONNEMENT
- Accès aux 5 salles : Minimes (12 rue de Fenouillet, 31200), Ramonville (33 rue des Ormes, 31530), Portet, États-Unis (388 avenue des États-Unis, 31200), St-Cyprien (11 Rue Sainte-Lucie, 31300).
- Toutes les disciplines, encadrement coach.
- Accès libre 6j/7 de 10h à 21h (musculation, cardio, boxe).
- Événements : Boxing Center Trophy, Anglaise, Pieds-Poing, stages (si à jour médicalement).

ALTERNATIVES À LA RÉSILATION
- Manque de temps : plannings des 5 salles ; accès libre flexible 10h–21h.
- Déménagement : abo multi-salles — vérifier une salle près du nouveau domicile.
- Blessure / médical : suspension sans frais possible pour garder le tarif à la reprise.
- Changement de club : multi-salles + partenaires (Nobles Arts Portésiens, Toulouse Mini Boxing Club).
- Financier : exceptionnellement, offre à 29 € via le manager. Dire exactement « 29 € », jamais « environ ».
- Autre : écouter, proposer suspension / changement de formule.

RÈGLES
- Français, ton chaleureux et naturel : tu peux parler un peu (jusqu’à ~120 mots, 4–5 phrases).
- Ne jamais dire bonjour : la conversation est déjà commencée.
- Ne pas répéter le motif du membre mot pour mot.
- Jusqu’à 2 questions utiles pour comprendre et aider.
- Ne jamais inventer un tarif. Seul tarif autorisé ici : exactement « 29 € ».
- Si tu manques d’un détail, pose une question claire — ne renvoie pas systématiquement vers un email manager.
- Ne pas mentionner Deciplus, bots techniques, ni systèmes internes.
- Encourager à rester ou à explorer une alternative, sans forcer ni paniquer.
- Ne donne une adresse email manager que si le membre demande explicitement un contact humain.
`.trim();

const FALLBACKS = {
  time: "Votre abonnement donne accès aux cinq salles et à l’accès libre de 10h à 21h, 6 jours sur 7. Un autre créneau ou une autre salle pourrait mieux vous convenir — on peut aussi regarder une suspension temporaire si c’est juste une période chargée.",
  move: 'Votre abonnement donne accès aux cinq salles Boxing Center. Vérifiez si l’une d’elles reste proche de votre nouveau domicile : souvent ça évite de tout couper.',
  medical:
    'En cas de blessure, une suspension sans frais peut souvent être étudiée pour conserver vos conditions tarifaires à la reprise. Dites-moi ce qui vous bloque aujourd’hui et on voit la meilleure option.',
  club: 'Votre formule donne accès aux cinq salles et à toutes les disciplines. Avant de partir, on peut vérifier une autre salle, un autre créneau ou une formule plus adaptée.',
  money:
    'Si le prix est le problème, une offre à 29 € peut exceptionnellement être étudiée. On peut aussi regarder une formule plus légère — qu’est-ce qui pèse le plus pour vous ?',
  other:
    'Je peux vous aider à voir une suspension, un autre créneau ou une formule mieux adaptée. Expliquez-moi un peu votre situation et on avance ensemble.',
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
    if (unique.length === 5) break;
  }
  reply = unique.join(' ').trim();
  const words = reply.split(/\s+/);
  if (words.length > 120) reply = `${words.slice(0, 120).join(' ').replace(/[,;:]$/, '')}.`;
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
            freeText ? `Échanges du membre : ${String(freeText).slice(0, 1200)}` : 'Pas de précision libre.',
            '',
            'Rédige une réponse utile et humaine pour poursuivre la conversation. Ne renvoie vers un email manager que si c’est vraiment nécessaire ou demandé.',
          ].join('\n'),
        },
      ],
      { maxTokens: 320, temperature: 0.55 }
    );
    const reply = cleanReply(content, fallback);
    return { reply: reply || fallback, source: 'groq' };
  } catch (err) {
    return { reply: fallback, source: 'template-fallback', error: err.message };
  }
}

module.exports = { guideRetention, FALLBACKS, KNOWLEDGE };
