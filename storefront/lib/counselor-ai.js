'use strict';

const { chatCompletion, isAiEnabled } = require('./groq');
const {
  WELCOME_KNOWLEDGE,
  matchManagerFromText,
  pickVariant,
} = require('./welcome-knowledge');
const { resolvePersona } = require('./counselor-personas');
const { buildKnowledge, GYMS, detectGyms, fallbackFromKnowledge, planningContext, wantsKids, PLANNING_HUB } = require('./bc-knowledge');
const {
  matchWelcomeFaq,
  matchPlanningFollowup,
  matchKidsPlanning,
  matchNamedGymFollowup,
  lastChosenGymId,
  kidsPlanningIntent,
  isClubOpeningHours,
} = require('./welcome-faq');

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
- 5 salles : Minimes (12 rue de Fenouillet, 31200), Ramonville (33 rue des Ormes, 31530), Portet (61 route d'Espagne, 31120), États-Unis (388 avenue des États-Unis, 31200), St-Cyprien (11 Rue Sainte-Lucie, 31300).
- Résiliation et changement d’abonnement : la vérification Deciplus se fait sur ces 5 salles uniquement. JAMAIS sur Balma (ancienne salle, autre opérateur).
- Managers (EXACT) : Minimes = Mehdi, Ramonville = Pascal, St-Cyprien = Dadi, Portet = Valentin, États-Unis = Sébastien. Ne jamais inventer un autre prénom.
- Accès multi-salles selon formule ; pages salles : lundi au samedi, 10h00–21h30. Ne jamais inventer d’horaire du dimanche.
- Séance d’essai et offres (29 € / 259 €) via la boutique.
- Résiliation web : uniquement les formules par prélèvement (pas les comptants / forfaits).
- Changement d’abonnement (prélèvement → comptant) via « Gérer mon abo ».
- Badge / accès en panne → manager de salle.

RÉSILIATION — RÈGLES À CONNAÎTRE (ne jamais les contredire)
- La demande n’est définitive que lorsque le membre la valide électroniquement dans le parcours en ligne. Un message ici, un mot au coach ou à l’accueil ne valent pas résiliation.
- Délai technique : la demande doit être enregistrée PLUS DE 72 HEURES avant la date du prochain prélèvement. À 72 h ou moins, l’échéance reste due et est prélevée : le membre garde son accès pendant la nouvelle période de 4 semaines et la résiliation prend effet à la fin de celle-ci, sans nouvelle demande.
- La résiliation prend effet à la fin de la période déjà payée — ce n’est PAS un arrêt sous 72 h. Pas de remboursement au prorata d’une période de 4 semaines commencée, sauf obligation légale.
- Formules payées comptant (3 / 6 / 12 mois) : durée ferme, non résiliables avant terme pour changement d’avis ou non-utilisation.
- Vente à distance : 14 jours de rétractation légale selon les CGV.
- Badge (34,99 €) : non remboursé du seul fait de la résiliation, ce n’est pas une caution.
- La simple non-utilisation de l’abonnement ne donne droit ni à remboursement ni à prolongation.

ALTERNATIVES RÉSILATION (à adapter, sans promettre d’action)
- Manque de temps → autres créneaux / salles / accès libre.
- Déménagement → salle plus proche.
- Blessure → d’abord demander s’ils souhaitent suspendre ; si oui → manager ; si non → rester / résilier.
- Financier → exceptionnellement offre à 29 € via le manager. Dire exactement « 29 € », jamais « environ ».

RÈGLES DE CONVERSATION
- Français, naturel, chaleureux. Max ~90 mots. Pas de markdown.
- Ne jamais dire bonjour : la conversation a déjà commencé.
- INTERDIT de renvoyer quasiment le même message que ta réponse précédente.
- Si non / pas maintenant : invite clairement à cliquer sur « Je reste — merci pour les infos » (bouton en bas), ou manager / résiliation. Ne repose pas la même question.
- Une seule idée principale. Une question max.
- Ne jamais inventer un tarif. Seul tarif promo autorisé ici : exactement « 29 € ».
- Ne mentionne pas Deciplus, bots, IA, systèmes internes.
`.trim();

const FALLBACKS = {
  time: 'Avec les cinq salles et l’accès libre du lundi au samedi 10h–21h30, on peut souvent trouver un créneau plus simple. C’est plutôt les horaires, la distance, ou une période chargée en ce moment ?',
  move: 'Votre abo multi-salles couvre souvent un déménagement en région toulousaine. Dans quel secteur vous installez-vous ? Je vous oriente vers la salle la plus pratique.',
  medical:
    'Désolé pour votre blessure. Souhaitez-vous suspendre votre abonnement le temps de votre rétablissement ?',
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

function isInternalUnlockPhrase(text) {
  const t = normalizeText(text);
  return t === 'mode developpement' || t === 'mode developpeur' || t === 'mode dev';
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
  'Je peux t’aider sur les offres **29,99 €** / **259 €**, les 5 salles, l’essai ou le règlement — dis-moi juste ce que tu cherches.',
  'Offres, salles, essai ou docs : je te guide. Tu veux partir sur quoi en premier ?',
  'Dis-moi ce qui t’intéresse — formule, salle, séance d’essai ou formalités — et je te réponds direct.',
];

const WELCOME_FALLBACK = WELCOME_FALLBACKS[0];

/* Le délai de 72 h est une règle contractuelle : il doit figurer dès la première
   réponse sur la résiliation, pas seulement dans le parcours de David. */
const REDIRECT_DAVID = [
  'Pour résilier un abo **par prélèvement**, ouvre « Gérer mon abo » : **David** t’accompagne. Enregistre ta demande **plus de 72 h avant ta prochaine échéance**, sinon elle est encore prélevée. Les formules **comptant** se voient avec le **manager** en salle.',
  'Résiliation en ligne = parcours **David** (prélèvements sans engagement), à faire **plus de 72 h avant le prochain prélèvement**. Comptant / forfait → ton **manager** en présentiel.',
  'Je ne gère pas les résils ici. Passe par « Gérer mon abo » : **David** pour le prélèvement, **manager** pour le comptant. Compte **72 h avant l’échéance** pour éviter le prochain prélèvement.',
];

const REDIRECT_DAVID_VOUS = [
  'Pour résilier un abonnement **par prélèvement**, ouvrez « Gérer mon abo » : **David** vous accompagne. Votre demande doit être enregistrée **plus de 72 h avant votre prochaine échéance**, sans quoi elle sera encore prélevée. Les formules **comptant** se règlent avec le **manager** en salle.',
  'La résiliation en ligne passe par le parcours **David** (prélèvements sans engagement), **plus de 72 h avant le prochain prélèvement**. Pour un forfait comptant, voyez votre **manager** en présentiel.',
  'Je ne traite pas les résiliations ici. Rendez-vous sur « Gérer mon abo » : **David** pour le prélèvement, le **manager** pour le comptant. Prévoyez **72 h avant l’échéance**.',
];

const FAQ_VARIANTS = {
  offer29: [
    'L’offre promo sans engagement : **29,99 € toutes les 4 semaines** (28 jours, pas un mois). Cours illimités, accès aux salles de l’offre, résiliation sous réserve du délai technique de **72 h**.',
    '**29,99 €** / 4 semaines, sans engagement de durée. Ce n’est pas un prélèvement mensuel : 4 semaines = 28 jours.',
    'Formule flexible : **29,99 €** toutes les 4 semaines, cours illimités. L’ancienne grille affichait environ 44,99 €.',
  ],
  offer259: [
    'L’offre année : **259 € / 12 mois** (prix normal affiché 400 €). C’est l’option la plus économique si tu pratiques toute l’année.',
    '**259 €** pour 12 mois, cours illimités et accès aux salles de l’offre — plus avantageux que le 29,99 € / 4 semaines sur la durée.',
    'Saison à **259 €** : un an, cours illimités. À prendre si tu sais que tu vas t’entraîner sur l’année.',
  ],
  gyms: [
    '5 salles : **Minimes**, **Ramonville**, **St-Cyprien**, **Portet**, **États-Unis**. Accès **du lundi au samedi, 10h–21h30**. Managers : Mehdi, Pascal, Dadi, Valentin, Sébastien.',
    'Tu as le choix entre Minimes, Ramonville, St-Cyprien, Portet et États-Unis — accès du lundi au samedi, 10h–21h30. Quelle zone te parle ?',
    'Réseau toulousain : 5 clubs, même abo multi-salles selon formule. Dis-moi ton quartier, je te pointe la plus pratique.',
  ],
  legal: [
    'Tenue de sport + eau pour démarrer. **Gants perso** OK sur rings/sacs (désinfecter). Docs : CGV, règlement intérieur et déclaration médicale en ligne / à l’inscription.',
    'Pour démarrer : tenue propre, eau, et les docs (CGV, règlement, attestation médicale) sont sur la boutique. Gants perso autorisés si désinfectés.',
    'Côté formalités : CGV + règlement + déclaration médicale. En salle, tenue de sport ; gants perso OK sur sacs/rings après désinfection.',
  ],
  clim: [
    'Non : les salles **ne sont pas chauffées ni climatisées**. Elles sont isolées pour rester supportables à l’entraînement.',
    'Pas de clim, nulle part : les salles **ne sont pas climatisées** et **pas chauffées**, mais correctement isolées.',
    '**Pas de clim** : les 5 salles **ne sont pas climatisées** (ni chauffées). Elles sont isolées pour rester supportables pendant les cours.',
  ],
  kidsBaby: [
    'Dès **3 ans**, c’est la **Baby Boxe** (ludique, motricité) — pas la boxe anglaise adulte. **7–11 ans** : boxe éducative. **12–16 ans** : éducative ados. En dessous de 3 ans, trop jeune.',
    'Un enfant de **3 à 6 ans** va en **Baby Boxe**, pas en boxe anglaise. **7–11** : éducative. **Moins de 3 ans** : trop jeune. Inscription en ligne.',
    '**Baby Boxe dès 3 ans**, éducative **7–11** puis **12–16**. Ce n’est pas le cours adulte. Quelle salle ?',
  ],
  trial: [
    'Les **débutants** sont les bienvenus. Réserve une **séance d’essai à 10 €** en ligne : un coach t’accueille, pas besoin d’expérience ni de gros matériel.',
    'Pas d’expérience requise — réserve un **essai à 10 €** en ligne, un coach te prend en charge. Tu arrives en tenue, c’est tout.',
    'Essai possible avant de t’engager : **10 €** la séance, inscription courte en ligne, ambiance loisir, débutants OK.',
  ],
  badgeRefund: [
    'Non — le **badge (~34,99 €) n’est pas remboursé** si tu résilies : c’est **ton** support d’accès (pas une caution du club).',
    'Le badge reste **ta propriété** ; le montant badge n’est pas restitué en cas d’arrêt d’abonnement.',
    'Pas de remboursement badge à la résiliation : tu conserves le badge, le prélèvement badge correspond à la fourniture/activation.',
  ],
  longTerm: [
    'Sur **12 mois**, le plus économique reste **259 €** — bien moins cher que **29,99 € / 4 sem.** sur la durée. Je te conseille cette formule si tu es sûr(e) de t’entraîner.',
    'Pour le **long terme**, prends **259 € / 12 mois** : meilleur prix annuel. Le **29,99 € / 4 sem.** convient si tu veux rester **sans engagement**.',
    'Mon conseil économique : **259 €** pour l’année. Le 29,99 € / 4 sem., c’est la flexibilité — plus coûteux sur 12 mois.',
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

const PLANNING_ASK =
  /planning|horaires?|cr[ée]neaux?|quelle?\s+heure|emploi du temps|programme des cours/i;

const KID_LINE = /baby boxe|d[èe]s 3 ans|3\s*[–-]\s*6|7\s*[–-]\s*11|12\s*[–-]\s*16|10\s*[–-]\s*16|enfants|ados/i;

const KIDS_BANDS = [
  { min: 3, max: 6, re: /baby\s*boxe|d[èe]s 3 ans|3\s*[–-]\s*6/i },
  { min: 7, max: 11, re: /7\s*[–-]\s*11/i },
  { min: 12, max: 16, re: /12\s*[–-]\s*16|10\s*[–-]\s*16/i },
];

function kidsBandRe(text) {
  const ages = [...String(text || '').matchAll(/\b([1-9]|1[0-6])\s*ans\b/gi)].map((m) => Number(m[1]));
  const band = KIDS_BANDS.find((b) => ages.some((a) => a >= b.min && a <= b.max));
  return band ? band.re : null;
}

const DAY_HEADER = /^(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE)\b/i;
const ZONE_HEADER = /^8\.[A-C]\..*[–-]\s*(.+?)\s*$/i;

/**
 * Lit un bloc planning V4 en gardant le jour de l'en-tête : une ligne de cours
 * ne porte pas son jour, seule la position sous « MARDI » le dit.
 */
function planningEntries(block) {
  const out = [];
  let day = '';
  let zone = '';
  for (const raw of String(block || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const zoneHit = ZONE_HEADER.exec(line);
    if (zoneHit) {
      zone = zoneHit[1].replace(/^SALLE\s+/i, '').toLowerCase();
      continue;
    }
    if (DAY_HEADER.test(line)) {
      day = line.match(DAY_HEADER)[1].toLowerCase();
      continue;
    }
    if (!line.startsWith('-') || !line.includes('|')) continue;
    const parts = line
      .replace(/^[-\s]+/, '')
      .replace(/\.\s*$/, '')
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length || !/\d{1,2}h\d{2}/.test(parts[0])) continue;
    const [horaire, cours = '', coach = ''] = parts;
    const jour = day ? day.charAt(0).toUpperCase() + day.slice(1) : '';
    const salle = zone && !/^boxe$/i.test(zone) ? ` (salle ${zone})` : '';
    const qui = /coach/i.test(coach) ? ` · ${coach}` : '';
    out.push({
      day,
      cours: `${cours} ${parts.slice(2).join(' ')}`,
      text: `${jour} ${horaire} · ${cours}${qui}${salle}`.trim(),
    });
  }
  return out;
}

function recentMemberText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .filter((m) => m.role === 'user' || m.role === 'member')
    .map((m) => String(m.content || m.text || ''))
    .join(' ');
}

function planningFromKnowledge(text, persona, lastBot, messages) {
  const t = String(text || '');
  const vous = persona && persona.id === 'fabien';
  let ids = detectGyms(t);
  if (ids.length !== 1) {
    const remembered = lastChosenGymId(messages);
    if (remembered) ids = [remembered];
  }
  const kidsCtx =
    wantsKids(t) ||
    kidsPlanningIntent(t, lastBot, messages);
  /* « Quel est le créneau exact ? » : charger le planning de la salle retenue. */
  const ctxText = ids.length === 1 ? `${t} ${GYMS[ids[0]].label}` : t;
  const block = planningContext(ctxText) || '';
  const all = planningEntries(block);

  const topic = [];
  if (/jiu|jjb/i.test(t)) topic.push(/jiu|jjb/i);
  if (/\bmma\b/i.test(t)) topic.push(/\bmma\b/i);
  if (/grappling/i.test(t)) topic.push(/grappling/i);
  if (/hyrox/i.test(t)) topic.push(/hyrox/i);
  if (kidsCtx) topic.push(/baby|[ée]ducative|enfants|ados|dès 3|pieds-poings/i);
  if (/lady punch/i.test(t)) topic.push(/lady punch/i);
  if (/boxing lady/i.test(t)) topic.push(/boxing lady/i);
  if (/hiit/i.test(t)) topic.push(/hiit/i);
  const dayRe = /(lundi|mardi|mercredi|jeudi|vendredi|samedi)/i.exec(t);
  let entries = all;
  if (topic.length) {
    const hit = entries.filter((e) => topic.some((re) => re.test(e.cours)));
    if (hit.length) entries = hit;
  }
  /* Un parent veut le créneau de SA tranche d'âge, pas les 6 premiers cours
     enfants de la salle — sinon la Baby Boxe du samedi passe à la trappe. */
  if (kidsCtx) {
    const kidEntries = all.filter((e) => KID_LINE.test(e.cours));
    const bandRe = kidsBandRe(`${t} ${recentMemberText(messages)}`);
    const banded = bandRe ? kidEntries.filter((e) => bandRe.test(e.cours)) : [];
    if (banded.length) entries = banded;
    else if (kidEntries.length) entries = kidEntries;
  }
  /* Le jour est un en-tête du planning, pas un mot de la ligne : sans cette
     lecture par jour, « Ramonville le mardi » ressortait avec le lundi. */
  if (dayRe) {
    const day = new RegExp(dayRe[1], 'i');
    const onDay = entries.filter((e) => day.test(e.day));
    if (onDay.length) entries = onDay;
  }
  /* « ACCÈS LIBRE » n'est pas un cours : hors sujet si on demande un créneau. */
  if (!/acc[eè]s libre|muscu|libre/i.test(t)) {
    const cours = entries.filter((e) => !/acc[èe]s libre/i.test(e.cours));
    if (cours.length) entries = cours;
  }
  const lines = [];
  for (const e of entries) {
    if (!lines.includes(e.text)) lines.push(e.text);
    if (lines.length === 6) break;
  }

  const gymLink = (id) => {
    const g = GYMS[id];
    return `[${g.label}](${g.planningUrl})`;
  };

  if (kidsCtx && ids.length !== 1) {
    const babyGyms = ['minimes', 'ramonville', 'st-cyprien', 'portet'];
    const eu = GYMS['etats-unis'];
    return {
      reply: vous
        ? `**Baby Boxe dès 3 ans** : ${babyGyms.map(gymLink).join(' · ')} (Portet = samedi). Aux **États-Unis**, c’est **pieds-poings 3–6 ans** : [${eu.label}](${eu.planningUrl}).`
        : `**Baby Boxe dès 3 ans** : ${babyGyms.map(gymLink).join(' · ')} (Portet = samedi). Aux **États-Unis**, c’est **pieds-poings 3–6 ans** : [${eu.label}](${eu.planningUrl}).`,
      source: 'knowledge-planning',
    };
  }

  if (ids.length === 1) {
    const g = GYMS[ids[0]];
    const facts = lines.length ? ` ${lines.join(' · ').replace(/\.$/, '')}.` : '';
    const link = `[voir le planning](${g.planningUrl})`;
    /* La V4 marque le planning Portet « PLANNING PROVISOIRE ». */
    const provisoire = ids[0] === 'portet' ? ' Planning Portet **provisoire**.' : '';
    return {
      reply: vous
        ? `À **${g.label}** (${g.address}) :${facts} Le détail complet : ${link}.${provisoire}`
        : `À **${g.label}** :${facts} Le détail : ${link}.${provisoire}`,
      source: 'knowledge-planning',
    };
  }
  return {
    reply: vous
      ? `Pour le **planning**, quelle salle vous arrange ? **Minimes**, **Portet**, **Ramonville**, **Saint-Cyprien** ou **États-Unis** ? Ou [tous les plannings](${PLANNING_HUB}).`
      : `Pour le **planning**, quelle salle te va ? **Minimes**, **Portet**, **Ramonville**, **Saint-Cyprien** ou **États-Unis** ? Ou [tous les plannings](${PLANNING_HUB}).`,
    source: 'knowledge-planning',
  };
}

function welcomeFallbackReply(lastUser, lastBot, persona, messages = []) {
  const generic = (persona && persona.fallbacks) || WELCOME_FALLBACKS;
  const pick = (key) => {
    const variants = FAQ_VARIANTS[key] || generic;
    let reply = pickVariant(variants);
    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      const alt = variants.find((v) => similarityScore(v, lastBot) < 0.55);
      if (alt) reply = alt;
    }
    return reply;
  };
  if (/clim|climatis|chauff/i.test(lastUser) && !PLANNING_ASK.test(lastUser)) {
    return { reply: pick('clim'), source: 'faq' };
  }
  if (isClubOpeningHours(lastUser)) {
    const hours = matchWelcomeFaq(lastUser, { persona, lastBot, messages });
    if (hours) return hours;
  }
  if (PLANNING_ASK.test(lastUser) && !(/\bessai\b|10\s*€/i.test(lastUser) && !/planning|horaire/i.test(lastUser))) {
    return planningFromKnowledge(lastUser, persona, lastBot, messages);
  }
  const kidsReply = fallbackFromKnowledge(lastUser, { vous: persona && persona.id === 'fabien' });
  if (kidsReply) {
    return { reply: kidsReply, source: 'knowledge-kids' };
  }
  if (/enfant|fils|fille|gamin|baby|bébé|[ée]ducative|\d+\s*ans/i.test(lastUser)) {
    return { reply: pick('kidsBaby'), source: 'faq' };
  }
  const faq = matchWelcomeFaq(lastUser, { persona, lastBot, messages });
  if (faq) return faq;
  if (/29|sans engagement|4 semaines|pr[eé]l[eè]vement/i.test(lastUser)) {
    return { reply: pick('offer29'), source: 'faq' };
  }
  if (/259|12 mois|4x|4×|comptant/i.test(lastUser)) {
    return { reply: pick('offer259'), source: 'faq' };
  }
  if (/reynerie|mirail|bellefontaine|bagatelle/i.test(lastUser)) {
    return {
      reply:
        persona && persona.id === 'fabien'
          ? 'La **Reynerie** / le **Mirail**, c’est **Saint-Cyprien**, 11 rue Sainte-Lucie, près du Fer à Cheval. Manager : **Dadi**.'
          : 'La **Reynerie** / le **Mirail**, c’est **Saint-Cyprien**, 11 rue Sainte-Lucie, près du Fer à Cheval.',
      source: 'faq',
    };
  }
  if (/salle|minimes|ramonville|portet|cyprien|[eé]tats/i.test(lastUser)) {
    return { reply: pick('gyms'), source: 'faq' };
  }
  if (/cgv|r[eè]glement|m[eé]dical|attestation|gants|mat[eé]riel/i.test(lastUser)) {
    return { reply: pick('legal'), source: 'faq' };
  }
  if (/badge.*(rembours|rendre|restitu)|rembours.*badge|rendre.*badge/i.test(lastUser)) {
    return { reply: pick('badgeRefund'), source: 'faq' };
  }
  if (/moins cher|économ|long terme|longue dur[eé]e|sur la dur[eé]e|meilleur prix/i.test(lastUser)) {
    return { reply: pick('longTerm'), source: 'faq' };
  }
  let reply = pickVariant(generic);
  if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
    reply = generic.find((v) => similarityScore(v, lastBot) < 0.55) || reply;
  }
  return { reply, source: 'template' };
}

async function guideWelcome({ freeText, messages = [], persona: personaId } = {}) {
  const persona = resolvePersona(personaId);
  const lastUser = lastMemberMessage(messages, freeText);
  const lastBot = lastAssistantMessage(messages);

  const planningFollow = matchPlanningFollowup(lastUser, lastBot, persona);
  if (planningFollow) {
    return { ...planningFollow, persona: persona.id };
  }

  const gymFollow = matchNamedGymFollowup(lastUser, lastBot, persona, messages);
  if (gymFollow) {
    return { ...gymFollow, persona: persona.id };
  }

  if (PLANNING_ASK.test(lastUser) && !isClubOpeningHours(lastUser)) {
    if (!(/\bessai\b|10\s*€/i.test(lastUser) && !/planning|horaire/i.test(lastUser))) {
      return { ...planningFromKnowledge(lastUser, persona, lastBot, messages), persona: persona.id };
    }
  }

  /* « Brésilien » contient « résili » : ne pas traiter le JJB comme une résiliation. */
  if (/(?<![A-Za-zÀ-ÿ])r[ée]sil|annul.*abo|arr[êe]ter.*abo|arreter.*abo/i.test(lastUser)) {
    const variants = persona.id === 'fabien' ? REDIRECT_DAVID_VOUS : REDIRECT_DAVID;
    let reply = pickVariant(variants);
    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      reply = variants.find((v) => similarityScore(v, lastBot) < 0.55) || reply;
    }
    return { reply, source: 'redirect-david', persona: persona.id };
  }

  const managerReply = matchManagerFromText(lastUser);
  if (managerReply) {
    return { reply: managerReply, source: 'managers' };
  }

  const faqHit = matchWelcomeFaq(lastUser, { persona, lastBot, messages });
  if (faqHit) {
    return { ...faqHit, persona: persona.id };
  }

  const fallback = pickVariant(persona.fallbacks);
  if (!isAiEnabled()) {
    return { ...welcomeFallbackReply(lastUser, lastBot, persona, messages), persona: persona.id };
  }

  try {
    const transcript = buildTranscript(messages, freeText).replace(/David:/g, `${persona.name}:`);
    const { content } = await chatCompletion(
      [
        /* Base V4 uniquement : pas le catalogue boutique. */
        { role: 'system', content: buildKnowledge(`${lastUser}\n${freeText || ''}`) },
        { role: 'system', content: persona.tone },
        {
          role: 'user',
          content: [
            'Réponds à LA question avec les faits de la base seulement — comme David au téléphone, en chat. Réponse directe, factuelle, sans formule de fin.',
            'Aucun tarif, horaire, coach ou offre hors de cette base. Le 29,99 € / 4 semaines de la V4 ne doit pas être arrondi à 29 €.',
            'Si une salle ou un quartier est nommé : créneaux de CETTE salle seulement, pris dans la base. Pas le planning adulte du soir pour un enfant.',
            'Si aucune salle n’est nommée : ne cite PAS d’exemple de créneau (ni Saint-Cyprien ni ailleurs). Demande la salle et donne les liens planning.',
            '3 à 6 ans = Baby Boxe dès 3 ans, pas éducative 7-11, pas boxe anglaise adulte. Moins de 3 ans : trop jeune. Reynerie / Mirail = Saint-Cyprien.',
            'Les salles ne sont PAS climatisées ni chauffées.',
            'Rédige une réponse utile et **différente** de ta précédente (autre angle / autre formulation).',
            `Reste dans la voix de ${persona.name} : les faits ne changent pas, la façon de les dire oui.`,
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
    let reply = cleanWelcomeReply(content, fallback);

    if (
      /\d{1,2}\s*h\s*\d{2}/.test(reply) &&
      (PLANNING_ASK.test(lastUser) ||
        kidsPlanningIntent(lastUser, lastBot, messages) ||
        /\b(fils|fille|enfant|enfants|gamin|baby)\b|\b([3-6])\s*ans\b/i.test(lastUser))
    ) {
      const alt =
        matchKidsPlanning(lastUser, lastBot, persona, messages) ||
        planningFromKnowledge(lastUser, persona, lastBot, messages);
      if (alt) return { ...alt, persona: persona.id, source: 'guard-planning' };
    }

    if (lastBot && similarityScore(reply, lastBot) >= 0.55) {
      const alt =
        matchWelcomeFaq(lastUser, { persona, lastBot, messages }) ||
        welcomeFallbackReply(lastUser, lastBot, persona, messages);
      reply = alt.reply;
      return { reply, source: 'dedup', persona: persona.id };
    }

    return { reply: reply || fallback, source: 'groq', persona: persona.id };
  } catch (err) {
    const alt =
      matchWelcomeFaq(lastUser, { persona, lastBot, messages }) ||
      welcomeFallbackReply(lastUser, lastBot, persona, messages);
    return {
      ...alt,
      source: alt.source === 'faq-v4' ? 'faq-v4' : 'template-fallback',
      persona: persona.id,
      error: err.message,
    };
  }
}

module.exports = {
  guideRetention,
  guideWelcome,
  isAiEnabled,
  isInternalUnlockPhrase,
  FALLBACKS,
  WELCOME_FALLBACK,
};
