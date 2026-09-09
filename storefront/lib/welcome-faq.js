'use strict';

/**
 * Réponses déterministes tirées de la FAQ V4.
 * Servies AVANT l'appel au modèle, et à la place du menu générique
 * quand Groq sature — c'est ce menu qui faisait paraître Chloe « bête ».
 */

const { PLANNING_HUB, GYMS, detectGyms } = require('./bc-knowledge');
const { pickVariant } = require('./welcome-knowledge');

const DISCIPLINES_SALLE = {
  minimes: 'Boxe Anglaise, Boxing Camp, Boxing Lady, Boxe Pieds-Poings, Boxe Éducative, Baby Boxe, Open Sparring',
  ramonville: 'Boxe Anglaise, Boxe Pieds-Poings, Boxing Camp, Lady Punch, Grappling, MMA, Boxe Éducative, Baby Boxe',
  'st-cyprien': 'Boxe Anglaise, Boxe Thaï / K1, Boxing Camp, Cross Training, HYROX, Grappling, Lady Punch, Boxe Éducative, Baby Boxe',
  portet: 'Boxe Anglaise, Kick / K1, Boxe Française, Lady Kick, Boxing Lady, préparation physique, Sparring, Boxe Éducative, Baby Boxe',
  'etats-unis': 'Boxe Anglaise, Boxe Pieds-Poings, MMA, Grappling, JJB, HYROX, Cross Training, Boxing HIIT, Lady Punch',
};

function isFabien(persona) {
  return persona && persona.id === 'fabien';
}

function voice(persona, tu, vous) {
  return isFabien(persona) ? vous : tu;
}

function similarityScore(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9à-ÿ\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const wa = new Set(norm(a).split(' ').filter((w) => w.length > 3));
  const wb = new Set(norm(b).split(' ').filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / Math.max(wa.size, wb.size);
}

function pickAvoid(list, lastBot) {
  const arr = (Array.isArray(list) ? list : [list]).filter(Boolean);
  if (!arr.length) return '';
  if (!lastBot) return pickVariant(arr);
  let best = arr[0];
  let bestScore = similarityScore(best, lastBot);
  for (const v of arr.slice(1)) {
    const s = similarityScore(v, lastBot);
    if (s < bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

const KIDS_PLANNING_GYMS = ['minimes', 'ramonville', 'st-cyprien', 'portet'];

/* Une question qui cite un jour, une heure ou un coach veut le créneau exact. */
const PRECISE_PLANNING_ASK =
  /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi)\b|quelle?\s+heures?|quels?\s+(cr[ée]neaux?|horaires?|coachs?|soirs?|jours?)|[àa]\s+quelle\s+heure|c['’]est quand/i;

function kidsPlanningIntent(text, lastBot, messages) {
  const t = String(text || '');
  const last = String(lastBot || '');
  const recent = (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .map((m) => String(m.content || m.text || ''))
    .join(' ');
  const blob = `${t}\n${last}\n${recent}`;
  const now =
    /baby\s*boxe|b[ée]b[ée]|\b(fils|fille|enfant|enfants|gamin|gamins|gamines?|mineur|petits?)\b|\b([3-6])\s*ans\b|[ée]ducative/i.test(
      t
    );
  const before =
    /Baby Boxe|Boxe Éducative|educative|\b3 ans\b|7–11|12–16|cours enfants|pieds-poings 3|ton petit|inscrire/i.test(
      `${last} ${recent}`
    );
  return now || before || (/enfant|fils|fille|Baby Boxe/i.test(blob) && /planning|salle|club|horaire/i.test(t));
}

function lastChosenGymId(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.role !== 'user' && m.role !== 'member') continue;
    const ids = detectGyms(m.content || m.text || '');
    if (ids.length === 1) return ids[0];
  }
  return null;
}

function gymMdLink(id) {
  const g = GYMS[id];
  return `[${g.label}](${g.planningUrl})`;
}

function matchKidsPlanning(text, lastBot, persona, messages) {
  const t = String(text || '');
  if (!kidsPlanningIntent(t, lastBot, messages)) return null;

  let ids = detectGyms(t);
  if (ids.length !== 1) {
    const remembered = lastChosenGymId(messages);
    if (remembered) ids = [remembered];
  }
  if (ids.length === 1) {
    const id = ids[0];
    const g = GYMS[id];
    const link = `[voir le planning](${g.planningUrl})`;
    if (id === 'etats-unis') {
      return {
        reply: voice(
          persona,
          `Aux **États-Unis**, les 3–6 ans c’est **Boxe pieds-poings** (pas la Baby Boxe). Planning : ${link}.`,
          `Aux **États-Unis**, les 3–6 ans correspondent à la **Boxe pieds-poings** (pas la Baby Boxe). Planning : ${link}.`
        ),
        source: 'redirect-planning',
      };
    }
    return {
      reply: voice(
        persona,
        `Le planning **Baby Boxe / éducative** de **${g.label}** : ${link}.`,
        `Le planning **Baby Boxe / éducative** de **${g.label}** se trouve ici : ${link}.`
      ),
      source: 'redirect-planning',
    };
  }

  const eu = GYMS['etats-unis'];
  const variants = [
    voice(
      persona,
      `Pour la **Baby Boxe dès 3 ans**, ouvre la salle : ${KIDS_PLANNING_GYMS.map(gymMdLink).join(' · ')} (Portet = samedi). Aux **États-Unis**, c’est pieds-poings 3–6 ans : [${eu.label}](${eu.planningUrl}).`,
      `Pour la **Baby Boxe dès 3 ans** : ${KIDS_PLANNING_GYMS.map(gymMdLink).join(' · ')} (Portet = samedi). Aux **États-Unis**, pieds-poings 3–6 ans : [${eu.label}](${eu.planningUrl}).`
    ),
    `**Baby Boxe** = Minimes, Ramonville, Saint-Cyprien, Portet. Liens directs : ${KIDS_PLANNING_GYMS.map(gymMdLink).join(' · ')}. États-Unis = pieds-poings 3–6 ans, pas Baby Boxe.`,
  ];
  return { reply: pickAvoid(variants, lastBot), source: 'redirect-planning' };
}

function matchPlanningFollowup(text, lastBot, persona) {
  const t = String(text || '').trim();
  if (
    !/^(l['’]?ouvrir|ouvre[- ]le|le lien|ouvrir|celui[- ]l[àa]|ok ouvre)\b/i.test(t) &&
    !/ouvrir (le )?(lien|planning)/i.test(t)
  ) {
    return null;
  }
  const fromBot = String(lastBot || '').match(/https?:\/\/[^\s)]+/);
  let url = fromBot ? fromBot[0] : '';
  if (!url) {
    const ids = detectGyms(lastBot);
    if (ids.length === 1) url = GYMS[ids[0]].planningUrl;
  }
  url = url || PLANNING_HUB;
  const link = `[voir le planning](${url})`;
  return {
    reply: voice(persona, `C’est ici : ${link}.`, `C’est ici : ${link}.`),
    source: 'redirect-planning',
  };
}

function matchNamedGymFollowup(text, lastBot, persona, messages) {
  const t = String(text || '').trim();
  const last = String(lastBot || '');
  if (!t || !last) return null;

  if (
    /lesquelles|laquelle|les salles alors|donc lesquelles|et lesquelles/i.test(t) &&
    /salle|Balma|Minimes|p[ée]rim[èe]tre|clubs?/i.test(last)
  ) {
    return {
      reply: voice(
        persona,
        '5 salles : **Minimes**, **Ramonville**, **Saint-Cyprien**, **Portet**, **États-Unis**. Accès **lundi–samedi 10h–21h30**. Tu es de quel quartier ?',
        'Cinq salles : **Minimes**, **Ramonville**, **Saint-Cyprien**, **Portet**, **États-Unis**. Accès **lundi–samedi 10h–21h30**. De quel secteur venez-vous ?'
      ),
      source: 'faq-v4',
    };
  }

  const ids = detectGyms(t);
  if (ids.length !== 1) return null;
  if (/adresse|o[uù] (est|se trouve)|c['’]est o[uù]|manager|responsable/i.test(t) && t.length > 22) {
    return null;
  }

  const id = ids[0];
  const g = GYMS[id];

  /* « Ramonville le mardi, quelle heure ? » attend les créneaux de la V4,
     pas l'adresse et un lien : on laisse passer vers le planning détaillé. */
  if (PRECISE_PLANNING_ASK.test(t)) return null;

  if (kidsPlanningIntent(t, last, messages) || /Baby Boxe|3 ans|enfant|petit|inscrire/i.test(last)) {
    return matchKidsPlanning(`planning ${g.label}`, last, persona, messages);
  }

  const managerCtx = /\bmanagers?\b|responsable(s)? de salle/i.test(last);
  if (managerCtx && !/planning|horaire|cr[ée]neau|baby/i.test(t)) {
    return {
      reply: `Le manager de **${g.label}**, c’est **${g.manager}**. Adresse : ${g.address}.`,
      source: 'managers',
    };
  }

  const choosing =
    /salle|club|planning|horaire|laquelle|Minimes|Ramonville|Portet|Cyprien|[ée]tats|Baby Boxe|quartier|tous les plannings|voir le planning/i.test(
      last
    );
  if (!choosing && !/^(et |alors )?(minimes?|ramonville|portet|st[-\s]?cyprien|saint[-\s]?cyprien|cyprien|[eé]tats)/i.test(t)) {
    return null;
  }

  const link = `[voir le planning](${g.planningUrl})`;
  return {
    reply: voice(
      persona,
      `**${g.label}** : ${g.address}. Planning : ${link}.`,
      `**${g.label}** se trouve au ${g.address}. Planning : ${link}.`
    ),
    source: 'redirect-planning',
  };
}

function isClubOpeningHours(text) {
  const t = String(text || '');
  if (/planning|cr[ée]neaux?|emploi du temps|programme des cours/i.test(t)) return false;
  return (
    /horaire[s]?\s+d['’]?ouverture|heures?\s+d['’]?ouverture/i.test(t) ||
    /jusqu['’]?[àae]?\s+quelle\s+heure/i.test(t) ||
    /vous [êe]tes ouvert/i.test(t) ||
    (/ouvert/i.test(t) && /dimanche|lundi|samedi|7\s*j|7j\/7|week[- ]?end/i.test(t))
  );
}

function openingHoursReply(lastBot) {
  return {
    reply: pickAvoid(
      [
        'Ouverture indiquée : **lundi au samedi, 10h00–21h30**. On n’invente pas d’horaires le **dimanche** : les salles ne publient pas de créneaux ce jour-là.',
        '**Lundi au samedi 10h–21h30**. Le dimanche, pas d’horaire de cours dans la base : on ne promet pas d’accès.',
        'Les salles affichent **10h–21h30 du lundi au samedi**. Rien n’est publié pour le dimanche, donc on ne dit pas « ouvert 7j/7 ».',
      ],
      lastBot
    ),
    source: 'faq-v4',
  };
}

function kidsAgeBand(t) {
  const m = String(t || '').match(/\b([1-9]|1[0-6])\s*ans\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 3 && n <= 6) return 'baby';
  if (n >= 7 && n <= 11) return 'edu-7';
  if (n >= 12 && n <= 16) return 'edu-12';
  if (n < 3) return 'too-young';
  return null;
}

function matchWelcomeFaq(text, { persona, lastBot, messages } = {}) {
  const t = String(text || '');
  if (!t.trim()) return null;

  const last = String(lastBot || '');

  const enfant =
    /\b(fils|fille|enfant|enfants|gamin|gamines?|gamins|baby\s*boxe|ados?|mineur|petits?|coll[ée]giens?|lyc[ée]ens?)\b/i.test(
      t
    ) ||
    /b[ée]b[ée]/i.test(t) ||
    /\b([3-9]|1[0-6])\s*ans\b/i.test(t) ||
    /[ée]ducative/i.test(t);
  const parleDeSalle = /quelle salle|dans quelle salle|o[uù] (ça|ca|c['’]est)|quelle club/i.test(t);
  const contexteEnfant = /Baby Boxe|3 ans|éducative|educative|enfant/i.test(last);

  if ((parleDeSalle && (enfant || contexteEnfant)) || (enfant && /salle/i.test(t) && !detectGyms(t).length)) {
    const salles = voice(
      persona,
      'La **Baby Boxe dès 3 ans** est à **Minimes**, **Ramonville**, **Saint-Cyprien** et **Portet** (le samedi). Aux **États-Unis**, c’est **Boxe pieds-poings 3–6 ans**. Tu vises laquelle ?',
      'La **Baby Boxe dès 3 ans** est à **Minimes**, **Ramonville**, **Saint-Cyprien** et **Portet** (le samedi). Aux **États-Unis**, c’est **Boxe pieds-poings 3–6 ans**. Quelle salle vous convient ?'
    );
    return { reply: pickAvoid([salles], lastBot), source: 'faq-v4' };
  }

  if (enfant) {
    const ages = [...String(t).matchAll(/\b([1-9]|1[0-6])\s*ans\b/gi)].map((m) => Number(m[1]));

    /* États-Unis n'a pas de Baby Boxe : les 3–6 ans y font pieds-poings. */
    const nommees = detectGyms(t);
    if (
      nommees.length === 1 &&
      nommees[0] === 'etats-unis' &&
      (/baby/i.test(t) || ages.some((n) => n >= 3 && n <= 6))
    ) {
      const eu = GYMS['etats-unis'];
      return {
        reply: voice(
          persona,
          `Aux **États-Unis**, il n’y a pas de Baby Boxe : les **3–6 ans** font **Boxe pieds-poings**. Planning : [voir le planning](${eu.planningUrl}). La **Baby Boxe** est à Minimes, Ramonville, Saint-Cyprien et Portet.`,
          `Aux **États-Unis**, il n’y a pas de Baby Boxe : les **3–6 ans** font **Boxe pieds-poings**. Planning : [voir le planning](${eu.planningUrl}). La **Baby Boxe** se trouve à Minimes, Ramonville, Saint-Cyprien et Portet.`
        ),
        source: 'faq-v4',
      };
    }

    if (ages.some((n) => n < 3) && ages.some((n) => n >= 3 && n <= 6)) {
      return {
        reply:
          'Moins de **3 ans** : trop jeune. Dès **3 ans** (donc 4 ans) : **Baby Boxe**, approche ludique — pas la boxe anglaise adulte.',
        source: 'faq-v4',
      };
    }
    const band = kidsAgeBand(t);
    if (band === 'too-young') {
      return {
        reply: voice(
          persona,
          'La **Baby Boxe commence à 3 ans**. En dessous, on n’a pas de créneau dans la base. Tu peux revenir dès 3 ans.',
          'La **Baby Boxe commence à 3 ans**. En dessous, aucun créneau n’est publié. Vous pourrez inscrire l’enfant dès 3 ans.'
        ),
        source: 'faq-v4',
      };
    }
    if (band === 'edu-7') {
      return {
        reply: pickAvoid(
          [
            voice(
              persona,
              'À cet âge, c’est la **Boxe Éducative 7–11 ans** (selon les salles). Inscription **en ligne** avec l’accord du représentant légal. Tu vises Minimes, Ramonville, Saint-Cyprien ou Portet ?',
              'À cet âge, c’est la **Boxe Éducative 7–11 ans**, selon les salles. L’inscription se fait **en ligne** avec l’accord du représentant légal.'
            ),
            '**7–11 ans** = Boxe Éducative. Les salles enfants sont Minimes, Ramonville, Saint-Cyprien et Portet.',
          ],
          lastBot
        ),
        source: 'faq-v4',
      };
    }
    if (band === 'edu-12') {
      return {
        reply: pickAvoid(
          [
            voice(
              persona,
              'Pour un ado, c’est la **Boxe Éducative 12–16 ans**. Inscription en ligne avec le représentant légal. Tu veux quelle salle ?',
              'Pour un adolescent, c’est la **Boxe Éducative 12–16 ans**. Inscription en ligne avec le représentant légal.'
            ),
            '**12–16 ans** : Boxe Éducative ados, selon le planning de la salle.',
          ],
          lastBot
        ),
        source: 'faq-v4',
      };
    }
    const variants = isFabien(persona)
      ? [
          'Oui. Dès **3 ans**, c’est la **Baby Boxe**. Ensuite **Boxe Éducative 7–11 ans** et **12–16 ans**, selon les salles. L’inscription d’un mineur se fait en ligne, avec l’accord du représentant légal. Quelle salle vous convient ?',
          'Oui, il y a bien des cours enfants : **Baby Boxe dès 3 ans**, puis **7–11 ans** et **12–16 ans**. Un mineur s’inscrit en ligne avec le représentant légal.',
          'Les plus jeunes commencent en **Baby Boxe (dès 3 ans)**. Les salles : Minimes, Ramonville, Saint-Cyprien, Portet — et pieds-poings 3–6 ans aux États-Unis.',
        ]
      : [
          'Oui. Dès **3 ans**, c’est la **Baby Boxe**. Ensuite **Boxe Éducative 7–11 ans** et **12–16 ans**, selon les salles. Un mineur s’inscrit en ligne avec l’accord du représentant légal. Tu vises quelle salle ?',
          'Oui, il y a bien des cours enfants : **Baby Boxe dès 3 ans**, puis **7–11 ans** et **12–16 ans**. Un mineur s’inscrit en ligne avec le parent.',
          'Les plus jeunes commencent en **Baby Boxe (dès 3 ans)**. Salles : Minimes, Ramonville, Saint-Cyprien, Portet — et pieds-poings 3–6 ans aux États-Unis.',
        ];
    return { reply: pickAvoid(variants, lastBot), source: 'faq-v4' };
  }

  if (isClubOpeningHours(t) || /dimanche|7\s*j|7j\/7|week[- ]?end/i.test(t)) {
    return openingHoursReply(lastBot);
  }

  const gymIds = detectGyms(t);
  const adresseAsk =
    /adresse|o[uù] (est|se trouve)|c['’]est o[uù]|trouver la salle|comment (y )?aller|o[uù] c['’]est|la salle est o[uù]|o[uù] exactement/i.test(
      t
    );
  /* « Et la salle est où exactement ? » : la salle nommée deux tours plus haut. */
  const adresseGym = gymIds.length === 1 ? gymIds[0] : adresseAsk ? lastChosenGymId(messages) : null;
  if (adresseGym && adresseAsk) {
    const g = GYMS[adresseGym];
    return {
      reply: voice(
        persona,
        `**${g.label}** : ${g.address}. Le planning est ici : [voir le planning](${g.planningUrl}).`,
        `**${g.label}** se trouve au ${g.address}. Planning : [voir le planning](${g.planningUrl}).`
      ),
      source: 'faq-v4',
    };
  }

  if (
    gymIds.length === 1 &&
    /quoi comme cours|quels cours|qu['’]est[- ]ce qu['’]il y a|disciplines?/i.test(t) &&
    !/planning|horaire|cr[ée]neau/i.test(t)
  ) {
    const g = GYMS[gymIds[0]];
    const list = DISCIPLINES_SALLE[gymIds[0]];
    return {
      reply: `À **${g.label}** : ${list}. Pour les jours et heures : [voir le planning](${g.planningUrl}).`,
      source: 'faq-v4',
    };
  }

  if (
    /quelles? salles?|o[uù] [êe]tes[- ]vous|5 clubs|cinq salles|liste des salles|combien de salles|nombre de salles/i.test(
      t
    ) &&
    !enfant
  ) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            '5 salles : **Minimes**, **Ramonville**, **Saint-Cyprien**, **Portet**, **États-Unis**. Accès **lundi–samedi 10h–21h30**. Tu es de quel quartier ?',
            'Cinq salles : **Minimes**, **Ramonville**, **Saint-Cyprien**, **Portet**, **États-Unis**. Accès **lundi–samedi 10h–21h30**. De quel secteur venez-vous ?'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/balma/i.test(t)) {
    return {
      reply:
        '**Balma** n’est pas dans le périmètre Boxing Center actuel. Les 5 salles : Minimes, Ramonville, Saint-Cyprien, Portet, États-Unis.',
      source: 'faq-v4',
    };
  }

  if (/comp[ée]tit(eur|eurs|ion)/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Les cours **compétiteurs / compétition** sont **réservés aux confirmés**. Un débutant commence en **loisir tous niveaux**, pas dans ces groupes.',
          '« Compétiteurs » = public confirmé, pas une découverte. Pour débuter : cours loisirs, ou essai à **10 €**.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/jiu|jjb/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Le **Jiu-Jitsu Brésilien (JJB)** : combat **au sol**, contrôle, leviers, soumissions, **sans frappes**. Débutants OK. C’est à **États-Unis** (Zouhir). Pour l’horaire : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/).',
          '**JJB** = sol, sans coups. Uniquement à la salle **États-Unis**. Lien planning de la salle : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/).',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/\bmma\b|arts martiaux mixtes/i.test(t)) {
    return {
      reply:
        'Le **MMA** mélange frappe debout, lutte et sol. Cours **tous niveaux** sauf groupe compétiteur. Salles : **États-Unis** et **Ramonville**.',
      source: 'faq-v4',
    };
  }

  if (/grappling|lutte au sol/i.test(t)) {
    return {
      reply:
        'Le **Grappling** : combat **au sol sans frappes** (projections, contrôles, soumissions). Débutants OK. Salles : **États-Unis**, **Saint-Cyprien**, **Ramonville**.',
      source: 'faq-v4',
    };
  }

  if (/hyrox/i.test(t)) {
    return {
      reply: '**HYROX** : endurance + force (course et exercices fonctionnels), **tous niveaux**. Salles : **Saint-Cyprien** et **États-Unis**.',
      source: 'faq-v4',
    };
  }

  if (/boxing hiit|\bhiit\b/i.test(t)) {
    return {
      reply: 'Le **Boxing HIIT** : cardio intense inspiré de la boxe, **tous niveaux**. Surtout à **États-Unis**.',
      source: 'faq-v4',
    };
  }

  if (/open sparring|sparring/i.test(t) && !/portet/i.test(t)) {
    return {
      reply:
        'L’**Open Sparring** (Minimes) n’est **pas** la première séance d’un total débutant : d’abord un cours technique loisir ou un **essai à 10 €**. Le coach gère les oppositions.',
      source: 'faq-v4',
    };
  }

  if (/boxing camp/i.test(t)) {
    return {
      reply:
        '**Boxing Camp** : boxe + préparation physique (sacs, corde, cardio), **sans obligation d’opposition**. Tous niveaux. Salles : Minimes, Ramonville, Saint-Cyprien.',
      source: 'faq-v4',
    };
  }

  if (/cross[-\s]?training|crossfit/i.test(t)) {
    return {
      reply:
        'Le **Cross Training** : circuits cardio / force / agilité, **tous niveaux**. Salles notamment **Saint-Cyprien** et **États-Unis**.',
      source: 'faq-v4',
    };
  }

  if (/femme|f[ée]minin|lady punch|boxing lady|lady kick/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'Oui. Les cours mixtes sont ouverts aux femmes, et il y a aussi des cours **100 % féminins** : **Boxing Lady** (Minimes, Portet), **Lady Punch** (Ramonville, Saint-Cyprien, États-Unis) et **Lady Kick** (Portet). Tu préfères mixte ou 100 % féminin ?',
            'Oui. Les cours mixtes sont ouverts aux femmes, et nous proposons **Boxing Lady**, **Lady Punch** et **Lady Kick** (100 % féminin). Vous préférez mixte ou 100 % féminin ?'
          ),
          'Cours **100 % féminins** : **Lady Punch** (Ramonville, Saint-Cyprien, États-Unis), **Boxing Lady** (Minimes, Portet) et **Lady Kick** (Portet). Les cours mixtes restent ouverts aux femmes.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/tha[iï]|muay|\bk1\b|kick|pieds[-\s]?poings/i.test(t)) {
    return {
      reply:
        '**Boxe Thaï / K1 / pieds-poings** : combat debout, débutants OK sauf groupe compétiteur. Thaï/K1 surtout **Saint-Cyprien** ; pieds-poings aussi Minimes, Ramonville, États-Unis ; Kick/K1 à **Portet**.',
      source: 'faq-v4',
    };
  }

  if (/savate|boxe fran[çc]aise/i.test(t)) {
    return {
      reply: 'La **Savate / Boxe Française** se pratique à **Portet**. Tous niveaux sauf groupe compétiteur.',
      source: 'faq-v4',
    };
  }

  if (/muscu|cardio|acc[eè]s libre/i.test(t)) {
    return {
      reply:
        'Oui, **accès libre musculation / cardio / Cross Training selon la formule**. Les salles ont des espaces dédiés (détail selon le club).',
      source: 'faq-v4',
    };
  }

  if (/fum|vapot/i.test(t)) {
    return {
      reply: 'Interdit de **fumer ou vapoter** dans les locaux.',
      source: 'faq-v4',
    };
  }

  if (/[ée]tudiant/i.test(t)) {
    return {
      reply:
        'Une **offre étudiant** figure parmi les formules. Le **prix exact** est celui affiché sur la boutique au moment de la commande — on n’invente pas un tarif.',
      source: 'faq-v4',
    };
  }

  if (/coaching individuel|coach perso|cours particuliers?/i.test(t)) {
    return {
      reply:
        'Le **coaching individuel** existe. Conditions et tarif : ceux affichés sur la boutique — on ne cite pas un prix hors base.',
      source: 'faq-v4',
    };
  }

  if (/d[ée]but(e|er|ant)|jamais (box[ée]|pratiqu)|pas sportif|reprends? apr[eè]s|longue pause/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'Oui : la grande majorité des cours collectifs sont **tous niveaux**. Le coach adapte. Seuls les groupes **compétiteurs** sont réservés aux confirmés. Tu veux plutôt la boxe, le MMA ou un cours 100 % féminin ?',
            'Oui : la grande majorité des cours collectifs sont **tous niveaux**. Le coach adapte l’intensité. Seuls les groupes **compétiteurs** sont réservés aux confirmés. Que souhaitez-vous essayer ?'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/certificat|m[ée]dical/i.test(t) && !/suspend|bless/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Pour une pratique **loisir**, le certificat médical n’est pas systématiquement obligatoire. Il peut l’être pour les **compétiteurs**, licenciés, ou si une règle fédérale l’impose.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/chauff|climatis|\bclim\b/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Non : les salles **ne sont pas chauffées ni climatisées**. Elles sont isolées pour rester supportables à l’entraînement.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/photo|vid[ée]o|film/i.test(t)) {
    return {
      reply:
        'Photo / vidéo d’une personne identifiable : **respect de la vie privée**. Vigilance absolue dans les **vestiaires et sanitaires**.',
      source: 'faq-v4',
    };
  }

  if (/douche|vestiaire/i.test(t)) {
    return {
      reply: pickAvoid(['Oui : **douches individuelles** et vestiaires hommes / femmes.'], lastBot),
      source: 'faq-v4',
    };
  }

  if (/casier/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'Oui, des **casiers** sont dispo. Les effets perso restent sous ta responsabilité (règlement intérieur).',
            'Oui, des **casiers** sont disponibles. Les effets personnels restent sous votre responsabilité (règlement intérieur).'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/r[ée]nov/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Oui : chaque saison, rénovation (sanitaires, vestiaires) et renouvellement du matériel boxe, Cross Training, musculation et cardio.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/r[ée]serv/i.test(t) && /cours|s[ée]ance|place/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Pour les formules concernées, les cours collectifs sont **illimités et sans réservation**. On vérifie juste les conditions de l’offre souscrite.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/plusieurs salles|multi[- ]salles|toutes les salles|changer de salle/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'Oui **si ta formule le prévoit**. Les offres promo actuelles mettent en avant l’accès aux salles incluses dans l’offre.',
            'Oui **si votre formule le prévoit**. Les offres promo actuelles mettent en avant l’accès aux salles incluses dans l’offre.'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/mat[ée]riel.*(essai|pr[êe]t)|pr[êe]t.*mat[ée]riel|gants.*(essai|fourni)|fournit.*gants/i.test(t)) {
    return {
      reply:
        voice(
          persona,
          'Pour l’**essai**, du matériel **peut être prêté**. En pratique régulière, mieux vaut tes propres protections (gants, etc.).',
          'Pour l’**essai**, du matériel **peut être prêté**. En pratique régulière, mieux vaut vos propres protections (gants, etc.).'
        ),
      source: 'faq-v4',
    };
  }

  if (/gants|prot[èe]ge[- ]dents|casque|tenue/i.test(t) && !/essai/i.test(t)) {
    return {
      reply:
        '**Tenue de sport** propre pour démarrer. **Gants perso** OK sur rings/sacs s’ils sont désinfectés. Protections selon le cours (consignes du coach).',
      source: 'faq-v4',
    };
  }

  if (/essai|essayer|tester|10\s*€|10\s*euros?/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'Oui : séance d’essai à **10 €**, en ligne. Tu choisis la salle et l’activité. Du matériel peut être prêté pour l’essai.',
            'Oui : séance d’essai à **10 €**, réservable en ligne. Vous choisissez la salle et l’activité. Du matériel peut être prêté pour l’essai.'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/badge/i.test(t) && /rembours|rendre|restitu|caution|34/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Non — le **badge (34,99 €)** n’est **pas remboursé** du seul fait de la résiliation : ce n’est **pas une caution**, c’est le support d’accès (sauf obligation légale).',
          voice(
            persona,
            'Le badge reste **ta propriété** ; le montant n’est pas restitué si tu arrêtes l’abo, sauf disposition légale.',
            'Le badge reste **votre propriété** ; le montant n’est pas restitué si vous arrêtez l’abonnement, sauf disposition légale.'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/n['’]?utilise|non[- ]utilisation|rembours.*abo|prolong/i.test(t)) {
    return {
      reply:
        'La **simple non-utilisation** de l’abonnement ne donne **ni remboursement ni prolongation**, sous réserve des droits légaux.',
      source: 'faq-v4',
    };
  }

  if (/r[ée]tract/i.test(t) || /14\s*jours/i.test(t)) {
    return {
      reply:
        'Vente à distance : **14 jours** de rétractation légale, selon les **CGV**. Ce n’est pas la même chose qu’une résiliation d’abo en cours.',
      source: 'faq-v4',
    };
  }

  if (
    /quelle offre|promo|29,99|29\s*€|29\s*euros?|259|sans engagement|c['’]est combien|combien (co[uû]te|l['’]abo|l['’]abonnement|la formule)|\btarifs?|\bprix\b|\babonnement\b|\babo\b|par mois|mensuel|4 semaines|pr[ée]l[èe]vement/i.test(
      t
    )
  ) {
    return {
      reply: pickAvoid(
        [
          'Deux offres promo : **29,99 € / 4 semaines** (28 jours, **pas un mois**) et **259 € / 12 mois**. La première = flexibilité ; la seconde = le meilleur prix sur l’année.',
          'On ne dit pas « 29 € par mois » : c’est **29,99 € toutes les 4 semaines** (28 jours), ou **259 € / 12 mois**.',
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/lendemain|activation|quand je peux entrer|d[ée]lai.*acc[eè]s/i.test(t)) {
    return {
      reply:
        'Sous réserve du paiement et du dossier, l’accès peut être activé **à compter du lendemain** de la validation en ligne.',
      source: 'faq-v4',
    };
  }

  if (/retard/i.test(t)) {
    return {
      reply:
        'Un **retard important** (autour de **10 min**) peut empêcher d’entrer en cours si l’échauffement / les consignes de sécu sont passés : c’est le **coach** qui décide.',
      source: 'faq-v4',
    };
  }

  if (/malaise|vertige|perte de connaissance|essouffl|cardiaque|douleur|bless/i.test(t)) {
    return {
      reply: voice(
        persona,
        'En cas de **malaise, douleur inhabituelle, vertige ou gêne respiratoire** : tu **arrêtes la séance**, tu préviens tout de suite le **coach ou le personnel**, et tu consultes un professionnel de **santé** avant de reprendre si besoin.',
        'En cas de **malaise, douleur inhabituelle, vertige ou gêne respiratoire** : vous **arrêtez la séance**, vous prévenez immédiatement le **coach ou le personnel**, et vous consultez un professionnel de **santé** avant reprise si la situation le justifie.'
      ),
      source: 'faq-v4',
    };
  }

  if (/d[ée]finitif|provisoire|susceptible de changer|[çc]a peut changer/i.test(t)) {
    return {
      reply:
        'Le planning **Portet** est affiché comme **provisoire** — il peut encore bouger. Les autres salles suivent les plannings de rentrée 2026–2027 de la base.',
      source: 'faq-v4',
    };
  }

  if (/prorata|p[ée]riode d[ée]j[àa] pay/i.test(t)) {
    return {
      reply:
        'La résiliation prend effet **à la fin de la période déjà payée**. Pas de remboursement **au prorata** d’une période de 4 semaines déjà commencée, sauf obligation légale.',
      source: 'faq-v4',
    };
  }

  if (/pr[ée]lev|[ée]ch[ée]ance/i.test(t) && /72|avant|arr[êe]t|stop|emp[êe]ch|[ée]viter|annul/i.test(t)) {
    return {
      reply:
        'Pour bloquer la **prochaine échéance**, la résiliation doit être enregistrée **plus de 72 h avant** la date de prélèvement. Enregistrée dans les **72 h**, l’échéance reste due : l’accès continue 4 semaines, puis l’abo s’arrête sans nouvelle demande.',
      source: 'faq-v4',
    };
  }

  if (/inscri|s['’]abonner|comment faire/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'L’inscription se fait **en ligne** : tu choisis l’offre, tu remplis tes infos, tu paies et tu valides les docs. Un mineur a besoin de l’accord du représentant légal. Tu vises adulte ou enfant ?',
            'L’inscription se fait **en ligne** : choix de l’offre, informations, paiement et validation des documents. Pour un mineur, l’accord du représentant légal est nécessaire. Adulte ou enfant ?'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  return null;
}

module.exports = {
  matchWelcomeFaq,
  matchPlanningFollowup,
  matchKidsPlanning,
  matchNamedGymFollowup,
  lastChosenGymId,
  kidsPlanningIntent,
  isClubOpeningHours,
  similarityScore,
};
