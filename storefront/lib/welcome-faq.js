'use strict';

/**
 * Réponses déterministes tirées de la FAQ V4.
 * Servies AVANT l'appel au modèle, et à la place du menu générique
 * quand Groq sature — c'est ce menu qui faisait paraître Chloe « bête ».
 */

const { PLANNING_HUB } = require('./bc-knowledge');
const { pickVariant } = require('./welcome-knowledge');

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
  const alt = arr.find((v) => similarityScore(v, lastBot) < 0.55);
  return alt || arr[0];
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
  const url = fromBot ? fromBot[0] : PLANNING_HUB;
  const link = `[voir le planning](${url})`;
  return {
    reply: voice(
      persona,
      `C’est ici : ${link}.`,
      `C’est ici : ${link}.`
    ),
    source: 'redirect-planning',
  };
}

function matchWelcomeFaq(text, { persona, lastBot } = {}) {
  const t = String(text || '');
  if (!t.trim()) return null;

  const enfant =
    /\b(fils|fille|enfant|enfants|gamin|gamins|b[ée]b[ée]|baby\s*boxe|ados?|mineur)\b/i.test(t) ||
    /\b([3-9]|1[0-6])\s*ans\b/i.test(t) ||
    /[ée]ducative/i.test(t);

  if (enfant) {
    const baby = voice(
      persona,
      'Oui. Dès **3 ans**, c’est la **Baby Boxe**. Ensuite **Boxe Éducative 7–11 ans** et **12–16 ans**, selon les salles. Un mineur s’inscrit en ligne avec l’accord du représentant légal. Tu vises quelle salle ?',
      'Oui. Dès **3 ans**, c’est la **Baby Boxe**. Ensuite **Boxe Éducative 7–11 ans** et **12–16 ans**, selon les salles. L’inscription d’un mineur se fait en ligne, avec l’accord du représentant légal. Quelle salle vous convient ?'
    );
    return { reply: pickAvoid([baby], lastBot), source: 'faq-v4' };
  }

  if (/d[ée]butant|jamais (box[ée]|pratiqu)|pas sportif|reprends? apr[eè]s|longue pause/i.test(t)) {
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

  if (/femme|f[ée]minin|lady punch|boxing lady/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          voice(
            persona,
            'Oui. Les cours mixtes sont ouverts aux femmes, et il y a aussi des cours **100 % féminins** : **Boxing Lady** et **Lady Punch**. Tu préfères mixte ou 100 % féminin ?',
            'Oui. Les cours mixtes sont ouverts aux femmes, et nous proposons aussi **Boxing Lady** et **Lady Punch** (100 % féminin). Vous préférez mixte ou 100 % féminin ?'
          ),
        ],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/certificat|m[ée]dical/i.test(t)) {
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

  if (/douche|vestiaire/i.test(t)) {
    return {
      reply: pickAvoid(
        ['Oui : **douches individuelles** et vestiaires hommes / femmes.'],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/casier/i.test(t)) {
    return {
      reply: pickAvoid(
        ['Oui, des **casiers** sont dispo. Les effets perso restent sous ta responsabilité (règlement intérieur).'],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/r[ée]nov/i.test(t)) {
    return {
      reply: pickAvoid(
        ['Oui : chaque saison, rénovation (sanitaires, vestiaires) et renouvellement du matériel boxe, Cross Training, musculation et cardio.'],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/r[ée]serv/i.test(t) && /cours|s[ée]ance|place/i.test(t)) {
    return {
      reply: pickAvoid(
        ['Pour les formules concernées, les cours collectifs sont **illimités et sans réservation**. On vérifie juste les conditions de l’offre souscrite.'],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/plusieurs salles|multi[- ]salles|toutes les salles|changer de salle/i.test(t)) {
    return {
      reply: pickAvoid(
        ['Oui **si ta formule le prévoit**. Les offres promo actuelles mettent en avant l’accès aux salles incluses dans l’offre.'],
        lastBot
      ),
      source: 'faq-v4',
    };
  }

  if (/essai|essayer|tester avant|10\s*€/i.test(t)) {
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

  if (/quelle offre|promo|29,99|29\s*€|259|sans engagement/i.test(t)) {
    return {
      reply: pickAvoid(
        [
          'Deux offres promo : **29,99 € / 4 semaines** (28 jours, sans engagement) et **259 € / 12 mois**. La première = flexibilité ; la seconde = le meilleur prix sur l’année.',
        ],
        lastBot
      ),
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
  similarityScore,
};
