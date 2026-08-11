'use strict';

const { chatCompletion, isAiEnabled } = require('./groq');

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
- Tu n’as AUCUN pouvoir de suspension.
- Réponse type : expliquer que seul le manager de salle peut suspendre, puis proposer « Contacter mon manager » (chips).
- Ne jamais écrire « je lance la suspension », « on peut suspendre pour vous », « voulez-vous que je lance… ».

IDENTITÉ
- Tu ne connais ni le nom, ni l’email, ni le dossier du membre tant qu’il ne les a pas saisis dans le formulaire de résiliation.
- N’invente pas un dossier, un tarif personnalisé, ni un statut d’abonnement.

CONNAISSANCES CLUB
- 5 salles : Minimes (12 rue de Fenouillet, 31200), Ramonville (33 rue des Ormes, 31530), Portet, États-Unis (388 avenue des États-Unis, 31200), St-Cyprien (11 Rue Sainte-Lucie, 31300).
- Accès multi-salles selon formule ; accès libre 6j/7 environ 10h–21h.
- Séance d’essai et offres (29 € / 259 €) via la boutique.
- Changement d’abonnement (prélèvement → comptant) via « Gérer mon abo ».
- Badge / accès en panne → manager de salle.

ALTERNATIVES RÉSILATION (à adapter, sans promettre d’action)
- Manque de temps → autres créneaux / salles / accès libre.
- Déménagement → salle plus proche.
- Blessure → orienter vers le manager pour une éventuelle suspension (toi tu ne la fais pas).
- Financier → exceptionnellement offre à 29 € via le manager. Dire exactement « 29 € », jamais « environ ».

RÈGLES DE CONVERSATION
- Français, naturel, chaleureux. Max ~90 mots. Pas de markdown.
- Ne jamais dire bonjour : la conversation a déjà commencé.
- INTERDIT de renvoyer quasiment le même message que ta réponse précédente.
- Si non / pas maintenant : pivot (autre piste ou question), sans re-proposer la même chose.
- Une seule idée principale. Une question max.
- Ne jamais inventer un tarif. Seul tarif promo autorisé ici : exactement « 29 € ».
- Ne mentionne pas Deciplus, bots, IA, systèmes internes.
`.trim();

const FALLBACKS = {
  time: 'Avec les cinq salles et l’accès libre 10h–21h, on peut souvent trouver un créneau plus simple. C’est plutôt les horaires, la distance, ou une période chargée en ce moment ?',
  move: 'Votre abo multi-salles couvre souvent un déménagement en région toulousaine. Dans quel secteur vous installez-vous ? Je vous oriente vers la salle la plus pratique.',
  medical:
    'Désolé pour votre blessure. Je ne peux pas suspendre l’abonnement moi-même — seul votre manager de salle peut le faire. Souhaitez-vous son contact, ou plutôt continuer vers la résiliation ?',
  club: 'Avant de couper, on peut vérifier une autre salle, un autre créneau ou une formule plus légère. Qu’est-ce qui vous fait pencher pour un autre club ?',
  money:
    'Si le budget pèse, une offre à 29 € peut exceptionnellement être étudiée avec votre manager, ou une formule plus légère. Qu’est-ce qui est le plus difficile aujourd’hui : le montant ou la fréquence ?',
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
    .replace(/\benviron\s+29\s*€/gi, '29 €')
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

async function guideRetention({ reasonId, reasonLabel, freeText, messages = [] }) {
  const fallback = FALLBACKS[reasonId] || FALLBACKS.other;
  const lastUser = lastMemberMessage(messages, freeText);
  const lastBot = lastAssistantMessage(messages);
  const transcript = buildTranscript(messages, freeText);

  // Réponses courtes : ne pas régénérer le même pitch
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
            'Rappel : tu ne peux pas suspendre. Si blessure/pause → orienter vers le manager.',
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
          'Je vous suis. Pour avancer : contacter votre manager (suspension / cas particulier), une info salle/horaires, ou continuer vers la résiliation ?';
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
    return { reply: fallback, source: 'template-fallback', error: err.message };
  }
}

module.exports = {
  guideRetention,
  isAiEnabled,
  FALLBACKS,
};
