'use strict';

const { chatCompletion, isAiEnabled } = require('./groq');

const KNOWLEDGE = `
Tu es David, conseiller virtuel Boxing Center (Toulouse). Tu aides les adhérents : résiliation, formules, salles, horaires, blessure, prix, badge, séance d’essai, matériel.

CONNAISSANCES CLUB
- 5 salles : Minimes (12 rue de Fenouillet, 31200), Ramonville (33 rue des Ormes, 31530), Portet, États-Unis (388 avenue des États-Unis, 31200), St-Cyprien (11 Rue Sainte-Lucie, 31300).
- Accès multi-salles selon formule ; accès libre 6j/7 environ 10h–21h (muscu / cardio / boxe).
- Disciplines + encadrement coach ; événements (Trophy, Anglaise, Pieds-Poing, stages) si à jour médicalement.
- Séance d’essai gratuite possible via la boutique.
- Changement d’abonnement (ex. prélèvement → comptant) possible via « Gérer mon abo » / parcours boutique.
- Badge / accès : souvent lié à l’abonnement actif ; en cas de souci, orienter vers le manager de salle.
- Matériel : boutique en ligne Boxing Center (gants, etc.).

ALTERNATIVES RÉSILATION (à adapter, pas à réciter)
- Manque de temps → autres créneaux / salles / accès libre ; suspension courte si pic temporaire.
- Déménagement → vérifier une salle près du nouveau domicile.
- Blessure / médical → suspension sans frais possible pour garder le tarif à la reprise ; ne pas forcer si le membre refuse.
- Changement de club → multi-salles + partenaires (Nobles Arts Portésiens, Toulouse Mini Boxing Club).
- Financier → exceptionnellement offre à 29 € via le manager. Dire exactement « 29 € », jamais « environ ».
- Autre → écouter, clarifier, proposer 1 option pertinente.

FAQ COURTES (réponds utilement, sans script figé)
- « C’est quoi le prix ? » → selon formule (mensuel / comptant / offres 29 € et 259 € l’année) ; proposer de regarder /offres-speciales ou abonnements.
- « Horaires ? » → accès libre ~10h–21h 6j/7 + cours selon planning salle.
- « Je déménage à… » → demander le quartier / ville et proposer la salle la plus proche.
- « Mon badge ne marche pas » → vérifier abo actif, puis manager de salle.
- « Je veux changer d’abo » → expliquer le parcours changement / Gérer mon abo.
- « Je veux juste une info » → répondre à la question ; ne pousse pas la rétention.

RÈGLES DE CONVERSATION (OBLIGATOIRES)
- Français, naturel, chaleureux. Max ~90 mots (3–4 phrases). Pas de markdown.
- Ne jamais dire bonjour : la conversation a déjà commencé.
- Ne pas répéter le motif du membre mot pour mot.
- INTERDIT de renvoyer quasiment le même message que ta réponse précédente.
- Si le membre dit non / pas maintenant / autre chose : ne redis pas la suspension ni la même offre. Pivot : pose 1 question OU propose une autre piste concrète OU demande ce qu’il préfère.
- Si le membre dit oui à une offre déjà faite : confirme brièvement la prochaine étape (ex. contacter manager / continuer le parcours).
- Une seule idée principale par message. Une question max, sauf besoin réel.
- Ne jamais inventer un tarif. Seul tarif promo autorisé ici : exactement « 29 € ».
- Ne mentionne pas Deciplus, bots, IA, systèmes internes.
- Email manager uniquement si le membre demande un humain / contact.
- Encourager sans forcer ni culpabiliser.
`.trim();

const FALLBACKS = {
  time: 'Avec les cinq salles et l’accès libre 10h–21h, on peut souvent trouver un créneau plus simple. C’est plutôt les horaires, la distance, ou une période chargée en ce moment ?',
  move: 'Votre abo multi-salles couvre souvent un déménagement en région toulousaine. Dans quel secteur vous installez-vous ? Je vous oriente vers la salle la plus pratique.',
  medical:
    'Désolé pour la blessure. On peut regarder une suspension pour garder vos conditions à la reprise, ou juste adapter la reprise. Qu’est-ce qui vous aiderait le plus là ?',
  club: 'Avant de couper, on peut vérifier une autre salle, un autre créneau ou une formule plus légère. Qu’est-ce qui vous fait pencher pour un autre club ?',
  money:
    'Si le budget pèse, une offre à 29 € peut exceptionnellement être étudiée, ou une formule plus légère. Qu’est-ce qui est le plus difficile aujourd’hui : le montant ou la fréquence ?',
  other:
    'Je peux vous aider sur les salles, les formules, une suspension ou une résiliation. Dites-moi simplement ce que vous voulez régler en priorité.',
};

const PIVOT_FALLBACKS = [
  'Compris. Dans ce cas, qu’est-ce qui vous aiderait le plus : garder l’abo en pause, changer de formule, ou simplement une info sur votre salle ?',
  'OK, on laisse ça de côté. Vous préférez qu’on regarde les créneaux / salles, le tarif, ou le parcours de résiliation ?',
  'Très bien. Dites-moi juste ce que vous voulez faire maintenant et je vous oriente clairement.',
];

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9à-ÿ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a, b) {
  const wa = new Set(normalizeText(a).split(' ').filter((w) => w.length > 3));
  const wb = new Set(normalizeText(b).split(' ').filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / Math.max(wa.size, wb.size);
}

function isShortRefusal(text) {
  return /^(non|nan|nope|pas maintenant|non merci|autre chose|non je (ne )?veux pas|laisse|stop)\b/i.test(
    String(text || '').trim()
  );
}

function isShortAccept(text) {
  return /^(oui|ouais|ok|d['’]accord|vas-y|je veux|go|parfait)\b/i.test(String(text || '').trim());
}

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
    if (unique.length === 4) break;
  }
  reply = unique.join(' ').trim();
  const words = reply.split(/\s+/);
  if (words.length > 90) reply = `${words.slice(0, 90).join(' ').replace(/[,;:]$/, '')}.`;
  return reply || fallback;
}

function buildTranscript(messages = [], freeText = '') {
  const lines = [];
  for (const m of messages) {
    const role = m.role === 'assistant' || m.role === 'bot' ? 'David' : 'Membre';
    const text = String(m.content || m.text || '').trim();
    if (!text) continue;
    lines.push(`${role}: ${text.slice(0, 400)}`);
  }
  if (!lines.length && freeText) {
    lines.push(`Membre: ${String(freeText).slice(0, 1200)}`);
  }
  return lines.slice(-12).join('\n');
}

function lastMemberMessage(messages = [], freeText = '') {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'user' || m.role === 'member') {
      return String(m.content || m.text || '').trim();
    }
  }
  const parts = String(freeText || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || '';
}

function lastAssistantMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'assistant' || m.role === 'bot') {
      return String(m.content || m.text || '').trim();
    }
  }
  return '';
}

async function guideRetention({ reasonId, reasonLabel, freeText, messages = [] }) {
  const fallback = FALLBACKS[reasonId] || FALLBACKS.other;
  const lastUser = lastMemberMessage(messages, freeText);
  const lastBot = lastAssistantMessage(messages);
  const transcript = buildTranscript(messages, freeText);

  // Réponses courtes : ne pas régénérer le même pitch
  if (lastBot && isShortRefusal(lastUser)) {
    const pivot = PIVOT_FALLBACKS[Math.floor(Math.random() * PIVOT_FALLBACKS.length)];
    return { reply: pivot, source: 'pivot-refusal' };
  }
  if (lastBot && isShortAccept(lastUser) && /suspension|suspend/i.test(lastBot)) {
    return {
      reply:
        'Parfait. Pour lancer la suspension, cliquez sur « Contacter mon manager » et choisissez votre salle — il finalisera avec vous sans frais pour garder vos conditions.',
      source: 'pivot-accept',
    };
  }

  if (!isAiEnabled()) {
    return { reply: fallback, source: 'template' };
  }

  try {
    const { content } = await chatCompletion(
      [
        {
          role: 'system',
          content: `${KNOWLEDGE}\n\nTu réponds UNIQUEMENT avec le message à afficher au membre (pas de préambule).`,
        },
        {
          role: 'user',
          content: [
            `Motif choisi : ${reasonLabel || reasonId || 'autre'}`,
            transcript ? `Historique récent :\n${transcript}` : 'Pas encore d’historique.',
            lastBot ? `Ta dernière réponse (à NE PAS répéter) : ${lastBot.slice(0, 500)}` : '',
            `Dernier message du membre : ${lastUser || '(vide)'}`,
            '',
            'Rédige la prochaine réponse : utile, différente de la précédente, adaptée au dernier message.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { maxTokens: 280, temperature: 0.75 }
    );
    let reply = cleanReply(content, fallback);

    // Garde-fou anti-doublon si le modèle ressert le même texte
    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      if (isShortRefusal(lastUser)) {
        reply = PIVOT_FALLBACKS[Math.floor(Math.random() * PIVOT_FALLBACKS.length)];
      } else {
        reply =
          'Je vous suis. Pour avancer sans tourner en rond : vous voulez plutôt une suspension, un changement de formule, une info salle/horaires, ou continuer vers la résiliation ?';
      }
      return { reply, source: 'dedup' };
    }

    return { reply: reply || fallback, source: 'groq' };
  } catch (err) {
    return { reply: fallback, source: 'template-fallback', error: err.message };
  }
}

module.exports = {
  guideRetention,
  FALLBACKS,
  KNOWLEDGE,
  similarityScore,
  isShortRefusal,
};
