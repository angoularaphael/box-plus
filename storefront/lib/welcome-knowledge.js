'use strict';

/**
 * Conseillers d'accueil (Chloe / Fabien / Nassim) — couche managers.
 *
 * Les faits vivent désormais dans `bc-knowledge.js` (base validée du 18/08/2026,
 * source documentaire : word_press/info_bot/). Ce module ne garde que :
 *   - MANAGERS : les responsables de salle en présentiel (utilisé aussi par gym-pickup) ;
 *   - matchManagerFromText : réponse directe à « qui est le manager de X ? » ;
 *   - WELCOME_KNOWLEDGE : socle sans planning, conservé pour compatibilité.
 *
 * La voix de chaque conseiller est gérée par `counselor-personas.js`.
 */

const { GYMS, buildKnowledge } = require('./bc-knowledge');

const SPECIALTIES = {
  minimes: 'Spécialisée Boxe Anglaise (3 rings, pôle compétiteurs)',
  ramonville: 'Sports de combat sur 2 niveaux — octogone 7 m, ring olympique',
  'st-cyprien': 'Toutes disciplines dans 1 salle (centre-ville)',
  portet: 'Boxe & Cross Training — très grande salle',
  'etats-unis': 'Plus grande salle sports de combat — 3 zones (boxe, MMA/sol, fitness)',
};

const ACCESS_HINTS = {
  minimes: 'Métro B – Barrière de Paris (~5 min) · Rocade sortie 31 Les Minimes',
  'st-cyprien': 'Proche du rond-point du Fer à Cheval',
  'etats-unis': 'Périphérique sortie 33b « Lalande »',
};

/** Managers de salle — dérivés de la base validée pour éviter toute divergence. */
const MANAGERS = Object.keys(GYMS).reduce((acc, id) => {
  const gym = GYMS[id];
  acc[id] = {
    name: gym.manager,
    label: gym.label,
    address: gym.address,
    url: gym.url,
    specialty: SPECIALTIES[id] || '',
    ...(ACCESS_HINTS[id] ? { access: ACCESS_HINTS[id] } : {}),
  };
  return acc;
}, {});

/** Socle de connaissances sans planning ciblé — compatibilité ascendante. */
const WELCOME_KNOWLEDGE = buildKnowledge('');

function pickVariant(list) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function matchManagerFromText(text) {
  const t = String(text || '');
  const asksManager =
    /manager|responsable|qui\s+(g[eè]re|dirige|s'?occupe)|chef\s+de\s+salle|coach\s+de\s+(la\s+)?salle|voir\s+(le|un)\s+manager/i.test(
      t
    ) ||
    (/qui\s+c['’]?est|c['’]est\s+qui|quel\s+(est\s+)?(le|la)/i.test(t) &&
      /minimes|ramonville|portet|cyprien|[eé]tats/i.test(t) &&
      /manager|responsable|coach/i.test(t));

  const gymHit = (id) => {
    const g = MANAGERS[id];
    if (!g) return null;
    return GYMS[id] && GYMS[id].match.test(t) ? g : null;
  };

  if (/manager|responsable|qui\s+g[eè]re|coach/i.test(t) || asksManager) {
    for (const id of Object.keys(MANAGERS)) {
      const g = gymHit(id);
      if (g) {
        const urlBit = g.url ? ` (${g.url})` : '';
        return pickVariant([
          `Le manager de **${g.label}**, c’est **${g.name}**. Adresse : ${g.address}. Tu peux le voir en présentiel${urlBit}.`,
          `À **${g.label}**, c’est **${g.name}** qui manage la salle — ${g.address}${urlBit}.`,
          `Pour **${g.label}**, oriente-toi vers **${g.name}** en salle (${g.address})${urlBit}.`,
        ]);
      }
    }
    if (/manager|responsable|managers|coach/i.test(t)) {
      return pickVariant([
        'Les managers : **Medhi** (Minimes), **Pascal** (Ramonville), **Daddy** (St-Cyprien), **Valentin** (Portet), **Sébastien** (États-Unis). Quelle salle ?',
        'Selon la salle : **Medhi** Minimes, **Pascal** Ramonville, **Daddy** St-Cyprien, **Valentin** Portet, **Sébastien** États-Unis. Tu vises laquelle ?',
        'Cinq managers en présentiel — **Medhi**, **Pascal**, **Daddy**, **Valentin**, **Sébastien**. Dis-moi ta salle, je te donne le bon prénom.',
      ]);
    }
  }
  return null;
}

module.exports = {
  MANAGERS,
  WELCOME_KNOWLEDGE,
  matchManagerFromText,
  pickVariant,
};
