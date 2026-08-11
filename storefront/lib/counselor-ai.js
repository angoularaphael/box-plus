'use strict';

const { chatCompletion, isAiEnabled } = require('./groq');
const {
  WELCOME_KNOWLEDGE,
  matchManagerFromText,
  pickVariant,
} = require('./welcome-knowledge');

const KNOWLEDGE = `
Tu es David, conseiller virtuel Boxing Center (Toulouse). Tu aides les adhérents sur le parcours « Gérer mon abonnement ».

CE QUE TU SAIS FAIRE (UNIQUEMENT)
- Guider le client (infos salles, formules, horaires, parcours boutique).
- Accompagner vers la résiliation via le parcours en ligne (après les étapes du chat).
- Orienter vers un manager de salle pour tout le reste.

CE QUE TU NE PEUX PAS FAIRE (INTERDIT DE LE PROMETTRE OU DE DIRE QUE TU LE FAIS)
- Suspendre / mettre en pause un abonnement.
- Modifier un abonnement, un badge, un prélèvement, une date, un tarif.
- Lancer une procédure Deciplus, un remboursement, une exception tarifaire.
- Agir « pour » le membre sans qu’il ait fourni ses infos dans le parcours.

SUSPENSION / BLESSURE / PAUSE
- Tu n’as AUCUN pouvoir de suspension toi-même.
- ORDRE OBLIGATOIRE en cas de blessure / médical / pause :
  1) D’abord demander clairement : « Souhaitez-vous suspendre votre abonnement le temps de votre rétablissement ? »
  2) Si OUI → expliquer que seul le manager peut le faire, et inviter à cliquer sur « Contacter mon manager ».
  3) Si NON → inviter à cliquer sur « Je reste — merci pour les infos », ou « Continuer vers la résiliation ».
- Ne jamais écrire « je lance la suspension » / « on suspend pour vous ».
- Ne saute pas l’étape 1 : ne propose pas d’abord le manager sans avoir demandé s’ils veulent suspendre.

IDENTITÉ
- Tu ne connais ni le nom, ni l’email, ni le dossier du membre tant qu’il ne les a pas saisis dans le formulaire de résiliation.
- N’invente pas un dossier, un tarif personnalisé, ni un statut d’abonnement.

CONNAISSANCES CLUB
- 5 salles : Minimes (12 rue de Fenouillet, 31200), Ramonville (33 rue des Ormes, 31530), Portet, États-Unis (388 avenue des États-Unis, 31200), St-Cyprien (11 Rue Sainte-Lucie, 31300).
- Managers (EXACT) : Minimes = Medhi, Ramonville = Pascal, St-Cyprien = Daddy, Portet = Valentin, États-Unis = Sébastien. Ne jamais inventer un autre prénom.
- Accès multi-salles selon formule ; accès libre 6j/7 environ 10h–21h.
- Séance d’essai et offres (29,99 € / 259 €) via la boutique.
- Résiliation web : uniquement les formules par prélèvement (pas les comptants / forfaits).
- Changement d’abonnement (prélèvement → comptant) via « Gérer mon abo ».
- Badge / accès en panne → manager de salle.

ALTERNATIVES RÉSILATION (à adapter, sans promettre d’action)
- Manque de temps → autres créneaux / salles / accès libre.
- Déménagement → salle plus proche.
- Blessure → d’abord demander s’ils souhaitent suspendre ; si oui → manager ; si non → rester / résilier.
- Financier → exceptionnellement offre à 29,99 € via le manager. Dire exactement « 29,99 € », jamais « environ ».

RÈGLES DE CONVERSATION
- Français, naturel, chaleureux. Max ~90 mots. Pas de markdown.
- Ne jamais dire bonjour : la conversation a déjà commencé.
- INTERDIT de renvoyer quasiment le même message que ta réponse précédente.
- Si non / pas maintenant : invite clairement à cliquer sur « Je reste — merci pour les infos » (bouton en bas), ou manager / résiliation. Ne repose pas la même question.
- Une seule idée principale. Une question max.
- Ne jamais inventer un tarif. Seul tarif promo autorisé ici : exactement « 29,99 € ».
- Ne mentionne pas Deciplus, bots, IA, systèmes internes.
`.trim();

const FALLBACKS = {
  time: 'Avec les cinq salles et l’accès libre 10h–21h, on peut souvent trouver un créneau plus simple. C’est plutôt les horaires, la distance, ou une période chargée en ce moment ?',
  move: 'Votre abo multi-salles couvre souvent un déménagement en région toulousaine. Dans quel secteur vous installez-vous ? Je vous oriente vers la salle la plus pratique.',
  medical:
    'Désolé pour votre blessure. Souhaitez-vous suspendre votre abonnement le temps de votre rétablissement ?',
  club: 'Avant de couper, on peut vérifier une autre salle, un autre créneau ou une formule plus légère. Qu’est-ce qui vous fait pencher pour un autre club ?',
  money:
    'Si le budget pèse, une offre à 29,99 € peut exceptionnellement être étudiée avec votre manager, ou une formule plus légère. Qu’est-ce qui est le plus difficile aujourd’hui : le montant ou la fréquence ?',
  other:
    'Je peux vous guider (salles, formules, horaires) ou vous accompagner vers une résiliation. Pour une suspension ou un cas particulier, il faudra votre manager de salle. Que voulez-vous faire ?',
};

const PIVOT_FALLBACKS = [
  'Compris. Si vous souhaitez rester, cliquez sur « Je reste — merci pour les infos » juste en bas. Sinon vous pouvez contacter votre manager ou continuer vers la résiliation.',
  'OK. Pour clôturer sans résilier, cliquez sur « Je reste — merci pour les infos ». Sinon : manager de salle, ou parcours de résiliation.',
  'Très bien. Cliquez sur « Je reste — merci pour les infos » si ça vous suffit, ou choisissez manager / résiliation en bas.',
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
    .replace(/\benviron\s+29(?:,99)?\s*€/gi, '29,99 €')
    .replace(/\b29\s*€/gi, '29,99 €')
    .replace(/je (peux|vais|lance|lance\s+la)\s+suspend/gi, 'votre manager peut suspend')
    .replace(/on (peut|va)\s+suspend/gi, 'votre manager peut suspend')
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

function isInjuryMessage(text) {
  return /bless|fractur|accident|op[eé]ration|m[eé]dical|entorse|tendon|pause|suspend/i.test(
    String(text || '')
  );
}

function lastBotAskedSuspend(lastBot) {
  return /souhaitez-vous\s+suspend|voulez-vous\s+suspend|suspendre votre abonnement/i.test(
    String(lastBot || '')
  );
}

async function guideRetention({ reasonId, reasonLabel, freeText, messages = [] }) {
  const fallback = FALLBACKS[reasonId] || FALLBACKS.other;
  const lastUser = lastMemberMessage(messages, freeText);
  const lastBot = lastAssistantMessage(messages);
  const transcript = buildTranscript(messages, freeText);
  const injuryContext = reasonId === 'medical' || isInjuryMessage(lastUser) || isInjuryMessage(freeText);

  // Après la question suspension : oui → manager / non → rester
  if (lastBotAskedSuspend(lastBot) && isShortAccept(lastUser)) {
    return {
      reply:
        'Parfait. Je ne peux pas suspendre moi-même : cliquez sur « Contacter mon manager » et choisissez votre salle — il finalisera la suspension avec vous.',
      source: 'pivot-accept-suspend',
    };
  }
  if (lastBotAskedSuspend(lastBot) && isShortRefusal(lastUser)) {
    return {
      reply:
        'Compris. Si vous restez, cliquez sur « Je reste — merci pour les infos ». Sinon vous pouvez continuer vers la résiliation.',
      source: 'pivot-refuse-suspend',
    };
  }

  // Première fois blessure/médical : demander la suspension AVANT le manager
  if (injuryContext && !lastBotAskedSuspend(lastBot)) {
    const userTurns = (messages || []).filter((m) => m.role === 'user' || m.role === 'member').length;
    if (userTurns <= 3 || reasonId === 'medical') {
      return { reply: FALLBACKS.medical, source: 'ask-suspend-first' };
    }
  }

  // Réponses courtes génériques : ne pas régénérer le même pitch
  if (lastBot && isShortRefusal(lastUser)) {
    return {
      reply:
        'Compris. Si vous préférez rester, cliquez sur « Je reste — merci pour les infos » juste en bas. Sinon vous pouvez contacter votre manager ou continuer vers la résiliation.',
      source: 'pivot-refusal',
    };
  }
  if (lastBot && isShortAccept(lastUser) && /suspend|pause|manager/i.test(lastBot)) {
    return {
      reply:
        'Parfait. Cliquez sur « Contacter mon manager » et choisissez votre salle — lui seul peut traiter une suspension. Je ne peux pas la lancer depuis ce chat.',
      source: 'pivot-accept-manager',
    };
  }

  if (!isAiEnabled()) {
    return { reply: injuryContext ? FALLBACKS.medical : fallback, source: 'template' };
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
            injuryContext
              ? 'Contexte blessure/médical : si tu n’as pas encore demandé s’ils veulent suspendre, pose CETTE question en premier. Ne propose pas le manager avant leur oui.'
              : 'Rappel : tu ne peux pas suspendre toi-même.',
            'Si le membre dit non / pas intéressé (hors question suspension) : « Je reste — merci pour les infos », sinon manager ou résiliation.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { maxTokens: 280, temperature: 0.75 }
    );
    let reply = cleanReply(content, injuryContext ? FALLBACKS.medical : fallback);

    // Garde-fou : blessure sans question suspend → forcer la question
    if (
      injuryContext &&
      !lastBotAskedSuspend(lastBot) &&
      !lastBotAskedSuspend(reply) &&
      !isShortAccept(lastUser) &&
      !isShortRefusal(lastUser)
    ) {
      return { reply: FALLBACKS.medical, source: 'guard-ask-suspend' };
    }

    // Garde-fou anti-doublon si le modèle ressert le même texte
    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      if (isShortRefusal(lastUser)) {
        reply =
          'Compris. Cliquez sur « Je reste — merci pour les infos » si vous restez avec nous, sinon contactez votre manager ou continuez vers la résiliation.';
      } else if (injuryContext && !lastBotAskedSuspend(lastBot)) {
        reply = FALLBACKS.medical;
      } else {
        reply =
          'Je vous suis. Cliquez sur « Je reste — merci pour les infos » si ça vous va, ou choisissez manager / résiliation en bas.';
      }
      return { reply, source: 'dedup' };
    }

    // Filet de sécurité : jamais promettre une suspension
    if (/je (lance|peux lancer|vais lancer|peux suspend|vais suspend)/i.test(reply)) {
      reply = FALLBACKS.medical;
      return { reply, source: 'guard-suspend' };
    }

    return { reply: reply || fallback, source: 'groq' };
  } catch (err) {
    return { reply: injuryContext ? FALLBACKS.medical : fallback, source: 'template-fallback', error: err.message };
  }
}

const WELCOME_FALLBACKS = [
  'Je peux t’aider sur les offres **29,99 €** / **259 €**, les 5 salles, l’essai, les CGV ou le règlement — dis-moi juste ce que tu cherches.',
  'Offres, salles, essai ou docs légaux : je te guide. Tu veux partir sur quoi en premier ?',
  'Dis-moi ce qui t’intéresse — formule, salle, séance d’essai ou formalités — et je te réponds direct.',
];

const WELCOME_FALLBACK = WELCOME_FALLBACKS[0];

const REDIRECT_DAVID = [
  'Pour résilier un abo **par prélèvement**, ouvre « Gérer mon abo » : **David** t’accompagne. Les formules **comptant** se voient avec le **manager** en salle.',
  'Résiliation en ligne = parcours **David** (prélèvements sans engagement). Comptant / forfait → ton **manager** en présentiel via « Gérer mon abo ».',
  'Je ne gère pas les résils ici. Passe par « Gérer mon abo » : **David** pour le prélèvement, **manager** pour le comptant.',
];

const FAQ_VARIANTS = {
  offer29: [
    'L’offre à **29,99 €** / 4 semaines : 1ʳᵉ échéance CB ou PayPal, puis prélèvement, **sans engagement** ni préavis. Accès aux **5 salles** et toutes les disciplines.',
    '**29,99 €** toutes les 4 semaines, sans engagement : tu paies la 1ʳᵉ fois (CB/PayPal), puis prélèvement. Multi-salles + toutes disciplines.',
    'Formule flexible : **29,99 €** / 4 sem., résiliable sans préavis. Accès libre aux 5 clubs Boxing Center.',
  ],
  offer259: [
    'L’offre à **259 €** / 12 mois : en **1×** ou **4× sans frais** (**64,75 €**). Pas de prélèvement mensuel — accès illimité aux 5 salles.',
    '**259 €** pour 12 mois, paiement **1×** ou **4×** (**64,75 €**, sans frais). Forfait comptant, pas de mensualité après.',
    'Saison à **259 €** : un an d’accès 5 salles, en une fois ou en 4 échéances égales sans frais.',
  ],
  gyms: [
    '5 salles : **Minimes**, **Ramonville**, **St-Cyprien**, **Portet**, **États-Unis**. Accès libre ~**10h–21h30**, 7j/7. Managers : Medhi, Pascal, Daddy, Valentin, Sébastien.',
    'Tu as le choix entre Minimes, Ramonville, St-Cyprien, Portet et États-Unis — accès libre ~10h–21h30. Quelle zone te parle ?',
    'Réseau toulousain : 5 clubs, même abo multi-salles selon formule. Dis-moi ton quartier, je te pointe la plus pratique.',
  ],
  legal: [
    'Tenue de sport + eau pour démarrer. **Gants perso** OK sur rings/sacs (désinfecter). Docs : CGV, règlement intérieur et déclaration médicale en ligne / à l’inscription.',
    'Pour démarrer : tenue propre, eau, et les docs (CGV, règlement, attestation médicale) sont sur la boutique. Gants perso autorisés si désinfectés.',
    'Côté formalités : CGV + règlement + déclaration médicale. En salle, tenue de sport ; gants perso OK sur sacs/rings après désinfection.',
  ],
  trial: [
    'Oui, les **débutants** sont les bienvenus. Tu peux réserver une **séance d’essai** en ligne : un coach t’accueille, pas besoin d’expérience ni de gros matériel.',
    'Pas d’expérience requise — réserve un **essai** en ligne, un coach te prend en charge. Tu arrives en tenue, c’est tout.',
    'Essai possible avant de t’engager : inscription courte en ligne, ambiance loisir, débutants OK.',
  ],
};

function cleanWelcomeReply(content, fallback) {
  let reply = cleanReply(content, fallback);
  reply = reply
    .replace(/\s*(Si tu as d['’]autres questions[^.]*(?:\.|$))/gi, '')
    .replace(/\s*(Besoin d['’](?:un|une|autre|d['’]autres)[^?]+\?)\s*$/gi, '')
    .replace(/\s*(N['’]hésite pas[^.!]*[.!]?)\s*$/gi, '')
    .replace(/\s*(Je suis l[àa]\s*!?)\s*$/gi, '')
    .replace(/\s*(Fais[- ]le moi savoir[!]?)\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Liens markdown [texte](url) → texte (url) pour le chat HTML
  reply = reply.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
  return reply || fallback;
}

function welcomeFallbackReply(lastUser, lastBot) {
  const pick = (key) => {
    const variants = FAQ_VARIANTS[key] || WELCOME_FALLBACKS;
    let reply = pickVariant(variants);
    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      const alt = variants.find((v) => similarityScore(v, lastBot) < 0.55);
      if (alt) reply = alt;
    }
    return reply;
  };
  if (/29|sans engagement|4 semaines|pr[eé]l[eè]vement/i.test(lastUser)) {
    return { reply: pick('offer29'), source: 'faq' };
  }
  if (/259|12 mois|4x|4×|comptant/i.test(lastUser)) {
    return { reply: pick('offer259'), source: 'faq' };
  }
  if (/salle|minimes|ramonville|portet|cyprien|[eé]tats/i.test(lastUser)) {
    return { reply: pick('gyms'), source: 'faq' };
  }
  if (/cgv|r[eè]glement|m[eé]dical|attestation|gants|mat[eé]riel/i.test(lastUser)) {
    return { reply: pick('legal'), source: 'faq' };
  }
  if (/essai|gratuit|d[eé]butant/i.test(lastUser)) {
    return { reply: pick('trial'), source: 'faq' };
  }
  return { reply: pickVariant(WELCOME_FALLBACKS), source: 'template' };
}

async function guideWelcome({ freeText, messages = [] } = {}) {
  const lastUser = lastMemberMessage(messages, freeText);
  const lastBot = lastAssistantMessage(messages);

  if (/résili|resili|annul.*abo|arrêter.*abo|arreter.*abo/i.test(lastUser)) {
    let reply = pickVariant(REDIRECT_DAVID);
    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      reply = REDIRECT_DAVID.find((v) => similarityScore(v, lastBot) < 0.55) || reply;
    }
    return { reply, source: 'redirect-david' };
  }

  const managerReply = matchManagerFromText(lastUser);
  if (managerReply) {
    return { reply: managerReply, source: 'managers' };
  }

  const fallback = pickVariant(WELCOME_FALLBACKS);
  if (!isAiEnabled()) {
    return welcomeFallbackReply(lastUser, lastBot);
  }

  try {
    const transcript = buildTranscript(messages, freeText).replace(/David:/g, 'Chloée:');
    const { content } = await chatCompletion(
      [
        { role: 'system', content: WELCOME_KNOWLEDGE },
        {
          role: 'user',
          content: [
            'Réponds au visiteur boutique. Réponse directe, factuelle, sans formule de fin. Si managers : noms exacts de la base.',
            'Rédige une réponse utile et **différente** de ta précédente (autre angle / autre formulation).',
            transcript ? `Conversation:\n${transcript}` : '',
            lastBot ? `Ta dernière réponse (à NE PAS répéter) : ${lastBot.slice(0, 500)}` : '',
            lastUser ? `Dernier message: ${lastUser}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { maxTokens: 320, temperature: 0.75 }
    );
    let reply = cleanWelcomeReply(content, fallback).replace(/29 €/g, '29,99 €');

    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      const alt = welcomeFallbackReply(lastUser, lastBot);
      reply = alt.reply;
      return { reply, source: 'dedup' };
    }

    return { reply: reply || fallback, source: 'groq' };
  } catch (err) {
    return { ...welcomeFallbackReply(lastUser, lastBot), source: 'template-fallback', error: err.message };
  }
}

module.exports = {
  guideRetention,
  guideWelcome,
  isAiEnabled,
  FALLBACKS,
  WELCOME_FALLBACK,
};
