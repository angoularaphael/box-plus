'use strict';

/**
 * Base de connaissances des conseillers du site (Chloe, Fabien, Nassim).
 *
 * Source unique : Base_connaissances_Agents_IA_Boxing_Center_2026_V4
 * (fichier brut, 18/08/2026). Les réponses ne s'appuient plus sur le
 * catalogue boutique ni sur un socle réécrit à la main.
 *
 * Le prompt = sections V4 utiles à la question + planning de la salle
 * détectée. On ne charge pas les 18 sections à chaque message (quota modèle).
 * Même logique de sélection que le bot téléphone (David) : répondre à LA
 * question avec les faits du fichier (âges, quartier, créneaux).
 */

const fs = require('fs');
const path = require('path');

const V4_PATH = path.join(__dirname, 'knowledge', 'Base_connaissances_V4.txt');
const V4_TEXT = fs.readFileSync(V4_PATH, 'utf8').replace(/\r\n/g, '\n');

/* ------------------------------------------------------------------ *
 * SALLES — détection de la question (adresses = section 3 de la V4)
 * ------------------------------------------------------------------ */

const PLANNING_HUB = 'https://boxingcenter.fr/salle-de-sport-toulouse/';

const GYMS = {
  minimes: {
    label: 'Minimes',
    fullLabel: 'Toulouse Minimes / Barrière de Paris',
    address: '12 rue de Fenouillet, 31200 Toulouse',
    manager: 'Mehdi',
    url: 'https://boxe-toulouse.com/',
    planningUrl: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/',
    match: /minimes?\b|barri[eè]re\s*de\s*paris|fenouillet/i,
    planningKey: 'planning-minimes',
  },
  ramonville: {
    label: 'Ramonville',
    fullLabel: 'Ramonville-Saint-Agne',
    address: '33 rue des Ormes, 31520 Ramonville-Saint-Agne',
    manager: 'Pascal',
    url: 'https://mmatoulouse.com/',
    planningUrl: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-ramonville/',
    match: /ramonvilles?|saint[-\s]?agne|des\s+ormes/i,
    planningKey: 'planning-ramonville',
  },
  'st-cyprien': {
    label: 'St-Cyprien',
    fullLabel: 'Toulouse Saint-Cyprien',
    address: '11 rue Sainte-Lucie, 31300 Toulouse',
    manager: 'Dadi',
    url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-saint-cyprien/',
    planningUrl: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-saint-cyprien/',
    match: /st[-\s]?cyprien|saint[-\s]?cyprien|sainte[-\s]?lucie|fer\s+[àa]\s+cheval|\bcyprien\b|reynerie|mirail|bellefontaine|bagatelle/i,
    planningKey: 'planning-saint-cyprien',
  },
  portet: {
    label: 'Portet',
    fullLabel: 'Portet-sur-Garonne',
    address: "61 route d'Espagne, 31120 Portet-sur-Garonne",
    manager: 'Valentin',
    url: 'https://boxing-center-portet.fr/',
    planningUrl: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-portet-sur-garonne-2/',
    match: /portet|route\s+d['’]espagne/i,
    planningKey: 'planning-portet',
  },
  'etats-unis': {
    label: 'États-Unis',
    fullLabel: 'Toulouse États-Unis',
    address: '388 avenue des États-Unis, 31200 Toulouse',
    manager: 'Sébastien',
    url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/',
    planningUrl: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/',
    match: /[eé]tats?[-\s]?unis|lalande|33\s?b/i,
    planningKey: 'planning-etats-unis',
  },
};

/* ------------------------------------------------------------------ *
 * PARSEUR V4
 * ------------------------------------------------------------------ */

function sectionKey(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (/^8\s*BIS\b/i.test(t)) return 'planning-portet';
  const n = t.match(/^(\d+)/);
  if (!n) return null;
  return {
    1: 'regles',
    2: 'disciplines',
    3: 'salles',
    4: 'coachs',
    5: 'planning-minimes',
    6: 'planning-ramonville',
    7: 'planning-saint-cyprien',
    8: 'planning-etats-unis',
    9: 'tarifs',
    10: 'essai',
    11: 'inscription',
    12: 'resiliation',
    13: 'sante',
    14: 'reglement',
    15: 'faq',
    16: 'scripts',
    17: 'vigilance',
    18: null,
  }[n[1]];
}

function parseV4(text) {
  const re = /={10,}\s*\n([^\n]+)\s*\n={10,}\s*\n/g;
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    hits.push({ title: m[1].trim(), start: m.index + m[0].length, at: m.index });
  }
  const out = {};
  for (let i = 0; i < hits.length; i += 1) {
    const key = sectionKey(hits[i].title);
    if (!key) continue;
    const end = i + 1 < hits.length ? hits[i + 1].at : text.length;
    out[key] = `# ${hits[i].title}\n${text.slice(hits[i].start, end).trim()}`;
  }
  return out;
}

const SECTIONS = parseV4(V4_TEXT);

const PLANNINGS = {
  minimes: SECTIONS['planning-minimes'] || '',
  ramonville: SECTIONS['planning-ramonville'] || '',
  'st-cyprien': SECTIONS['planning-saint-cyprien'] || '',
  portet: SECTIONS['planning-portet'] || '',
  'etats-unis': SECTIONS['planning-etats-unis'] || '',
};

const CORE = ['regles', 'salles', 'tarifs', 'vigilance']
  .map((k) => SECTIONS[k])
  .filter(Boolean)
  .join('\n\n');

/* ------------------------------------------------------------------ *
 * SÉLECTION DU PLANNING À INJECTER
 * ------------------------------------------------------------------ */

const PLANNING_INTENT =
  /planning|horaire|cr[ée]?neau|quelle?\s+heure|\bquand\b|\bcours\b|s[ée]ance|programme|\bjours?\b|\blundi\b|\bmardi\b|\bmercredi\b|\bjeudi\b|\bvendredi\b|\bsamedi\b|\bdimanche\b|\bmidi\b|\bsoirs?\b|\bmatin\b/i;

const DISCIPLINE_INTENT =
  /boxe|boxing|anglaise|tha[iï]|k1|kick|pieds[-\s]?poings|mma|grappling|jjb|jiu|savate|fran[çc]aise|hyrox|cross|hiit|lady|sparring|baby|[ée]ducative|camp|enfant|ado/i;

function detectGyms(text) {
  const t = String(text || '');
  return Object.keys(GYMS).filter((id) => GYMS[id].match.test(t));
}

const GYM_INDEX = `
# OÙ SE PRATIQUE QUOI (index V4 — aucun horaire ici)
- Minimes : Boxe Anglaise (loisirs et compétiteurs), Boxing Camp, Boxing Lady, Boxe Pieds-Poings, Boxe Éducative, Baby Boxe, Open Sparring.
- Ramonville : Boxe Anglaise, Boxe Pieds-Poings, Boxing Camp, Lady Punch, Grappling, MMA, Boxe Éducative, Baby Boxe.
- Saint-Cyprien : Boxe Anglaise, Boxe Thaï / K1, Boxing Camp, Cross Training, HYROX, Grappling, Lady Punch, Boxe Éducative, Baby Boxe.
- Portet : Boxe Anglaise (loisirs, amateurs et pros), Kick / K1, Boxe Française, Lady Kick, Boxing Lady, préparation physique, Sparring, Boxe Éducative, Baby Boxe. Planning PROVISOIRE.
- États-Unis : Boxe Anglaise, Boxe Pieds-Poings, MMA, Grappling, Jiu-Jitsu Brésilien, HYROX, Cross Training, Boxing HIIT, Lady Punch.
Cours 100 % féminins : Boxing Lady à Minimes et Portet · Lady Punch à Ramonville, Saint-Cyprien et États-Unis · Lady Kick à Portet.
Tant qu'aucune salle n'est nommée, ne donne ni jour, ni heure, ni coach : demande d'abord la salle.
`.trim();

const DISCIPLINE_GYMS = [
  { test: /\bmma\b|arts martiaux mixtes/i, gyms: ['etats-unis', 'ramonville'] },
  { test: /grappling|lutte au sol|sol sans frappe/i, gyms: ['etats-unis', 'st-cyprien', 'ramonville'] },
  { test: /jjb|jiu[-\s]?jitsu/i, gyms: ['etats-unis'] },
  { test: /hyrox/i, gyms: ['st-cyprien', 'etats-unis'] },
  { test: /cross[-\s]?training|crossfit/i, gyms: ['st-cyprien', 'etats-unis'] },
  { test: /boxing hiit|\bhiit\b/i, gyms: ['etats-unis'] },
  { test: /lady punch/i, gyms: ['ramonville', 'st-cyprien', 'etats-unis'] },
  { test: /boxing lady/i, gyms: ['minimes', 'portet'] },
  { test: /lady kick/i, gyms: ['portet'] },
  { test: /savate|boxe fran[çc]aise/i, gyms: ['portet'] },
  { test: /open sparring/i, gyms: ['minimes'] },
  { test: /boxing camp/i, gyms: ['minimes', 'ramonville', 'st-cyprien'] },
  { test: /pr[ée]paration physique|prépa physique/i, gyms: ['portet'] },
];

const PLANNING_BUDGET = 5000;

function packPlannings(ids) {
  const kept = [];
  const skipped = [];
  let size = 0;
  for (const id of ids) {
    const block = PLANNINGS[id];
    if (!block) continue;
    if (kept.length && size + block.length > PLANNING_BUDGET) {
      skipped.push(GYMS[id] ? GYMS[id].label : id);
      continue;
    }
    kept.push(block);
    size += block.length;
  }
  const note = skipped.length
    ? `\n\nCette discipline existe aussi à ${skipped.join(' et ')} : tu peux le mentionner et proposer d'en donner les horaires, mais tu n'as pas ces créneaux sous les yeux — ne les invente pas.`
    : '';
  return kept.join('\n\n') + note;
}

function planningContext(text) {
  const t = String(text || '');
  const gyms = detectGyms(t);
  if (gyms.length) return packPlannings(gyms);

  const byDiscipline = DISCIPLINE_GYMS.find((d) => d.test.test(t));
  if (byDiscipline) return packPlannings(byDiscipline.gyms);

  if (PLANNING_INTENT.test(t) || DISCIPLINE_INTENT.test(t)) return GYM_INDEX;
  return '';
}

/* ------------------------------------------------------------------ *
 * SÉLECTION DES SECTIONS V4
 * ------------------------------------------------------------------ */

function wantsKids(text) {
  return /enfant|fils|fille|gamin|ado|mineur|baby|bébé|[ée]ducative|\b\d+\s*ans?\b/i.test(text || '');
}

function agesIn(text) {
  return [...String(text || '').matchAll(/(\d+)\s*ans?/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n < 20);
}

function sliceHeading(body, startRe, endRe) {
  const src = String(body || '');
  const start = src.search(startRe);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = endRe ? rest.search(endRe) : -1;
  return (end > 0 ? rest.slice(0, end) : rest).trim();
}

function babyPlanningLines() {
  return String(V4_TEXT || '')
    .split('\n')
    .filter((l) => /baby boxe|éducative 7|éducative 12|dès 3 ans|educative 7|educative 12/i.test(l))
    .slice(0, 40)
    .join('\n');
}

function kidsExtras(text) {
  if (!wantsKids(text)) return '';
  const disc = SECTIONS.disciplines || '';
  const faq = SECTIONS.faq || '';
  return [
    sliceHeading(disc, /2\.4\.|Baby Boxe/i, /\n2\.5\./),
    sliceHeading(faq, /À partir de quel âge|age les enfants/i, /\nQ :/),
    babyPlanningLines(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function fallbackFromKnowledge(text, { vous = false } = {}) {
  const ages = agesIn(text);
  if (!wantsKids(text) && !ages.length) return '';
  const tooYoung = ages.filter((a) => a < 3);
  const baby = ages.filter((a) => a >= 3 && a <= 6);
  const edu = ages.filter((a) => a >= 7 && a <= 11);
  const ado = ages.filter((a) => a >= 12 && a <= 16);
  const parts = [];
  if (tooYoung.length) {
    parts.push(
      vous
        ? `La Baby Boxe commence à **3 ans**. Un enfant de ${tooYoung.join(' et ')} ans est trop jeune pour s'inscrire.`
        : `La Baby Boxe commence à **3 ans**. Un enfant de ${tooYoung.join(' et ')} ans est trop jeune pour s'inscrire.`
    );
  }
  if (baby.length || (!ages.length && wantsKids(text) && !tooYoung.length && !edu.length && !ado.length)) {
    const who = baby.length
      ? `${vous ? 'À' : 'À'} ${baby.join(' et ')} ans`
      : vous
        ? 'Pour un jeune enfant'
        : 'Pour un jeune enfant';
    parts.push(
      `${who}, ce n'est pas la boxe anglaise adulte : c'est la **Baby Boxe**, dès 3 ans. C'est ludique, le samedi après-midi selon la salle. L'inscription se fait en ligne.`
    );
  }
  if (edu.length) {
    parts.push(
      `De 7 à 11 ans, c'est la **boxe éducative**, mercredi et samedi. L'inscription se fait en ligne.`
    );
  }
  if (ado.length) {
    parts.push(`De 12 à 16 ans, c'est la **boxe éducative 12-16 ans**, mercredi et samedi.`);
  }
  parts.push(
    vous
      ? 'Quelle salle vous arrange ? **Minimes**, **Portet**, **Ramonville**, **Saint-Cyprien** ou **États-Unis** ?'
      : 'Quelle salle te va ? **Minimes**, **Portet**, **Ramonville**, **Saint-Cyprien** ou **États-Unis** ?'
  );
  return parts.join(' ');
}

const ALWAYS = ['tarifs'];

const ON_DEMAND = [
  {
    key: 'regles',
    test: /d[ée]butant|confirm[ée]|comp[ée]tit|accessible|niveau|mixte|femme|homme|enfant/i,
  },
  { key: 'vigilance', test: /dimanche|7j|provisoire|portet|clim|chauff|horaire d['’]ouverture/i },
  {
    key: 'disciplines',
    test: /c['’]est quoi|discipline|apprendre|commencer|self[-\s]?d[ée]fense|diff[ée]rence entre|pratiqu/i,
  },
  { key: 'salles', test: /salle|adresse|o[uù]\s+(est|se trouve)|parking|m[ée]tro|quartier|proche|implant/i },
  {
    key: 'coachs',
    test: /coach|prof|entra[îi]neur|encadr|qui\s+(donne|anime|s'occupe)|mehdi|dadi|brice|j[ée]r[ôo]me|zouhir|valentin|sonia|renaud|samuel|nicolas|enzo|mourad|ingrid|farouk|hicham|tawee|yannis|cl[ée]ment|chlo[ée]|david/i,
  },
  { key: 'essai', test: /essai|essayer|tester|10\s*€|d[ée]couvrir/i },
  { key: 'inscription', test: /inscri|s'abonner|abonner|dossier|mineur|enfant|parent|papier|document|contrat|adh[ée]sion|activ/i },
  { key: 'resiliation', test: /(?<![A-Za-zÀ-ÿ])r[ée]sili|annul|arr[êe]ter|stopper|pr[ée]l[èe]vement|rembours|engagement|r[ée]tractation|badge|quitter|me d[ée]sinscrire/i },
  { key: 'sante', test: /m[ée]dical|certificat|sant[ée]|bless|douleur|malaise|prot[èe]ge|gant|casque|s[ée]curit[ée]|retard|sparring|enceinte|op[ée]r/i },
  { key: 'reglement', test: /r[èe]glement|tenue|vestiaire|douche|casier|photo|vid[ée]o|alcool|fum|interdit|badge|comportement/i },
  {
    key: 'faq',
    test: /d[ée]butant|femme|enfant|[aâ]ge|3\s*ans|certificat|chauff|climatis|\bclim\b|r[ée]nov|douche|casier|essai|r[ée]serv|plusieurs salles|multi|r[ée]sili|rembours|quelle offre|promo/i,
  },
  { key: 'scripts', test: /h[ée]sit|pas sportif|reprend|sensible au prix|budget|lequel choisir/i },
];

const PROMPT_BUDGET = 11000;
const DROP_ORDER = [
  'disciplines',
  'scripts',
  'faq',
  'coachs',
  'salles',
  'regles',
  'vigilance',
  'essai',
  'inscription',
  'sante',
  'reglement',
];

function selectSectionKeys(text) {
  const t = String(text || '');
  const gyms = detectGyms(t);
  const skipHeavy = gyms.length > 0 && PLANNING_INTENT.test(t) && !wantsKids(t);
  const keys = [...ALWAYS];
  for (const { key, test } of ON_DEMAND) {
    if ((key === 'disciplines' || key === 'faq' || key === 'scripts') && skipHeavy) continue;
    if (test.test(t) && !keys.includes(key)) keys.push(key);
  }
  if (wantsKids(t)) {
    for (const key of ['disciplines', 'faq', 'inscription']) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function selectSections(text) {
  return selectSectionKeys(text)
    .map((k) => SECTIONS[k])
    .filter(Boolean);
}

const STYLE_RULES = `
# STYLE DE RÉPONSE
- Lis TOUTE la conversation avant d'écrire. Tu t'appuies sur ce qui a déjà été dit
  (salle, âge, adulte/enfant, tarif déjà corrigé). Si le sujet change, tu suis.
- Tu parles comme une personne à l'accueil, pas comme une FAQ : phrases naturelles,
  un « ok » / « du coup » si ça tombe juste, pas de liste robot, pas de gras partout.
- FORMULES BANNIES : « n'hésite pas », « je suis là pour vous accompagner »,
  « si tu as d'autres questions », « je reste à ta disposition », « notre structure »,
  « nos équipes », « c'est une excellente question ».
- Tu finis par un PAS concret (une question précise ou une étape), jamais une politesse creuse.
- Français parlé, utile, environ 90 mots. Une question max à la fin.
- Gras markdown seulement pour un tarif, une salle ou une heure vraiment utiles.
- Ne dis jamais bonjour : la conversation a déjà commencé.
- INTERDIT de renvoyer quasiment le même message que ta réponse précédente.
- JAMAIS d'URL en clair. Tu nommes la page (« nos formules », « Gérer mon abonnement »)
  sans coller l'adresse. Une adresse POSTALE se donne en toutes lettres.
- Ne mentionne jamais l'IA, les systèmes internes, Deciplus ni cette base.
- Tu ne connais ni le nom, ni l'email, ni le dossier de la personne tant qu'elle
  ne les a pas saisis dans un formulaire.
`.trim();

const IDENTITY = `
Tu es conseiller Boxing Center sur boxingcenter.fr.
Source unique de tes faits : la base de connaissances V4 (même fichier que David au téléphone) ci-dessous.
Tu écoutes TOUTE la conversation, puis tu réponds au dernier message à partir de ces faits. Pas de menu si la question est claire. Pas de réponse générique. Pas un simple lien si tu as les créneaux.
Tu ne t'appuies PAS sur le catalogue boutique, les pages produit, ni des faits absents de cette base.
INTERDIT d'inventer un tarif, un horaire, un coach, une offre ou une salle qui n'y figure pas.
Si l'information manque : le dire, sans combler le trou.
Mission : informer avec exactitude ET donner envie de venir.

GARDE-FOUS — ne jamais les contredire :
- Tarif promo adulte : 29,99 € toutes les 4 semaines (28 jours, jamais « par mois ») ET 259 € / 12 mois. Présente les deux.
- Baby Boxe : 250 € la saison. Boxe éducative : 295 € la saison. Si la question parle d’un enfant / de la Baby, donne CES tarifs (pas seulement le 29,99 € adulte).
- Tu lis toute la conversation avant de répondre. L’historique précise (salle, enfant ou adulte) ; si le sujet change, tu suis le nouveau sujet. Tu ne recolles pas un ancien script.
- CLIMATISATION : il n'y en a AUCUNE, dans aucune des cinq salles. Les salles ne sont PAS chauffées et PAS climatisées ; elles sont isolées pour rester supportables. Tu ne réponds JAMAIS oui, même partiellement, même pour une seule salle.
- Moins de 3 ans : trop jeune. Baby Boxe à partir de 3 ans. 3 à 6 ans : Baby Boxe, pas la boxe anglaise adulte, pas la boxe éducative 7-11. 7-11 : éducative. 12-16 : éducative ados.
- Reynerie / Mirail / Bellefontaine / Bagatelle = Saint-Cyprien (11 rue Sainte-Lucie).
- Si une salle ou un quartier est nommé, tu donnes les créneaux de CETTE salle (jour, heure, coach) tels qu'écrits dans la base. Tu ne récites pas le planning adulte du soir pour un enfant.
- Femmes : cours mixtes ouverts + Boxing Lady et Lady Punch (100 % féminin).
- Cours collectifs : illimités et sans réservation pour les formules concernées.
- Dimanche : ne pas inventer d'horaires. Pages salles = lundi au samedi, 10h00–21h30.
- Cours « compétiteurs » : public confirmé uniquement, jamais une découverte pour un débutant.
- Essai adulte : 10 €. Enfants : essai offert, ils ne paient pas. Pas de créneau à choisir : venir 5 minutes avant le début du cours.
`.trim();

function buildKnowledge(userText) {
  const planning = planningContext(userText);
  const extras = kidsExtras(userText);
  const planningBlock = planning
    ? `# PLANNINGS (extraits V4 — seuls horaires autorisés)\n${planning}`
    : '';
  const extraBlock = extras
    ? `# EXTRAITS ENFANTS (source unique — Baby Boxe / éducative)\n${extras}`
    : '';
  let keys = selectSectionKeys(userText);
  const wrap = (sectionKeys) =>
    [IDENTITY, ...sectionKeys.map((k) => SECTIONS[k]).filter(Boolean), extraBlock, planningBlock, STYLE_RULES]
      .filter(Boolean)
      .join('\n\n');
  let out = wrap(keys);
  for (const drop of DROP_ORDER) {
    if (out.length <= PROMPT_BUDGET) break;
    if (!keys.includes(drop)) continue;
    keys = keys.filter((k) => k !== drop);
    out = wrap(keys);
  }
  return out;
}

module.exports = {
  GYMS,
  CORE,
  SECTIONS,
  PLANNINGS,
  GYM_INDEX,
  PLANNING_HUB,
  V4_PATH,
  detectGyms,
  planningContext,
  selectSections,
  buildKnowledge,
  wantsKids,
  agesIn,
  fallbackFromKnowledge,
  kidsExtras,
};
