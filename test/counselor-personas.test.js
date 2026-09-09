'use strict';

/**
 * Conseillers du chat d'accueil : une seule logique, trois voix.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERSONAS,
  DEFAULT_PERSONA,
  resolvePersona,
  personaIds,
} = require('../storefront/lib/counselor-personas');
const { guideWelcome, isAiEnabled } = require('../storefront/lib/counselor-ai');

test('les trois conseillers sont déclarés', () => {
  assert.deepEqual(personaIds().sort(), ['chloe', 'fabien', 'nassim']);
  assert.equal(DEFAULT_PERSONA, 'chloe');
});

test('un identifiant inconnu ou vide retombe sur Chloe', () => {
  assert.equal(resolvePersona('zorro').id, 'chloe');
  assert.equal(resolvePersona('').id, 'chloe');
  assert.equal(resolvePersona(undefined).id, 'chloe');
  assert.equal(resolvePersona(null).id, 'chloe');
});

test('la résolution tolère la casse et les accents', () => {
  assert.equal(resolvePersona('FABIEN').id, 'fabien');
  assert.equal(resolvePersona('  Nassim  ').id, 'nassim');
  assert.equal(resolvePersona('Chloé').id, 'chloe');
});

test('chaque conseiller a un ton et des relances qui lui sont propres', () => {
  const tones = personaIds().map((id) => PERSONAS[id].tone);
  assert.equal(new Set(tones).size, 3, 'les tons doivent différer');

  const firsts = personaIds().map((id) => PERSONAS[id].fallbacks[0]);
  assert.equal(new Set(firsts).size, 3, 'les relances doivent différer');

  for (const id of personaIds()) {
    assert.ok(PERSONAS[id].fallbacks.length >= 3, `${id} : au moins 3 relances`);
    assert.ok(PERSONAS[id].name.length > 0);
  }
});

test('Fabien vouvoie, Nassim et Chloe tutoient', () => {
  const fabien = PERSONAS.fabien.fallbacks.join(' ');
  assert.ok(/vous|votre/i.test(fabien), 'Fabien doit vouvoyer');
  assert.ok(!/\btu\b|\bton\b/i.test(fabien), 'Fabien ne doit pas tutoyer');

  for (const id of ['chloe', 'nassim']) {
    const txt = PERSONAS[id].fallbacks.join(' ');
    assert.ok(/\bt[eu’']|\bton\b|dis-moi/i.test(txt), `${id} doit tutoyer`);
  }
});

test('les faits contractuels restent identiques d’un conseiller à l’autre', async () => {
  /* Sans clé IA, guideWelcome sert les réponses déterministes : c'est
     exactement là qu'on veut vérifier que les chiffres ne bougent pas.
     La formulation est tirée au sort parmi plusieurs variantes, donc on
     vérifie le fond (badge non rendu) et non une tournure précise. */
  assert.equal(isAiEnabled(), false, 'ce test cible la couche déterministe');

  const question = 'est-ce que le badge est remboursé ?';
  for (const persona of personaIds()) {
    for (let essai = 0; essai < 12; essai += 1) {
      const { reply, source } = await guideWelcome({ freeText: question, messages: [], persona });
      assert.match(source, /faq/, `${persona} doit passer par la réponse factuelle`);
      assert.match(reply, /badge/i, `${persona} : ${reply}`);
      assert.match(reply, /rembours|restitu|propri[ée]t[ée]/i, `${persona} : ${reply}`);
    }
  }
});

test('guideWelcome renvoie le conseiller retenu', async () => {
  const r = await guideWelcome({ freeText: 'bonjour', messages: [], persona: 'nassim' });
  assert.equal(r.persona, 'nassim');
  const d = await guideWelcome({ freeText: 'bonjour', messages: [], persona: 'inconnu' });
  assert.equal(d.persona, 'chloe');
});

test('une question horaire répond depuis la base, pas seulement par un lien', async () => {
  const r = await guideWelcome({
    freeText: 'horaire du Jiu-Jitsu Brésilien lundi à États-Unis',
    messages: [],
    persona: 'chloe',
  });
  assert.equal(r.source, 'knowledge-planning');
  assert.match(r.reply, /États-Unis|Etats-Unis/i);
  assert.match(r.reply, /18h20|Zouhir|Jiu/i);
});

test('sans salle, le planning demande la salle comme David', async () => {
  const r = await guideWelcome({
    freeText: 'je veux voir le planning',
    messages: [],
    persona: 'fabien',
  });
  assert.equal(r.source, 'knowledge-planning');
  assert.match(r.reply, /Minimes/);
  assert.match(r.reply, /vous/i);
});

test('un enfant de 3 ans reçoit la Baby Boxe, pas un menu générique', async () => {
  const r = await guideWelcome({
    freeText: 'J’ai un fils de 3 ans comment faire pour l’inscrire ?',
    messages: [],
    persona: 'chloe',
  });
  assert.match(r.reply, /Baby Boxe/i);
  assert.match(r.reply, /3 ans/);
  assert.doesNotMatch(r.reply, /dis-moi juste ce que tu cherches/i);
  assert.match(r.source, /knowledge-kids|faq-v4|faq/);
});

test('« il n’y a pas de cours enfants ? » est corrigé, pas un menu', async () => {
  const r = await guideWelcome({
    freeText: 'Ya pas de cours pour les enfants ?',
    messages: [],
    persona: 'chloe',
  });
  assert.match(r.source, /knowledge-kids|faq/);
  assert.match(r.reply, /Baby Boxe|Éducative|educative/i);
});

test('l’ouvrir après un lien planning renvoie le même lien', async () => {
  const r = await guideWelcome({
    freeText: 'l’ouvrir',
    messages: [
      { role: 'assistant', content: 'Le planning de **Minimes**, c’est ici : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/).' },
      { role: 'user', content: 'l’ouvrir' },
    ],
    persona: 'chloe',
  });
  assert.equal(r.source, 'redirect-planning');
  assert.match(r.reply, /minimes/i);
});

test('une séance d’essai n’est pas traitée comme une demande de planning', async () => {
  const r = await guideWelcome({
    freeText: 'je veux une séance d’essai à 10 €',
    messages: [],
    persona: 'chloe',
  });
  assert.notEqual(r.source, 'redirect-planning', r.reply);
});

test('Jiu-Jitsu Brésilien n’est pas traité comme une résiliation', async () => {
  const r = await guideWelcome({
    freeText: 'c’est quoi le Jiu-Jitsu Brésilien',
    messages: [],
    persona: 'chloe',
  });
  assert.notEqual(r.source, 'redirect-david', r.reply);
});

test('une vraie demande de résiliation passe toujours par David', async () => {
  const r = await guideWelcome({
    freeText: 'je veux résilier mon abonnement',
    messages: [],
    persona: 'chloe',
  });
  assert.equal(r.source, 'redirect-david');
});

test('la relance générique prend la voix du conseiller', async () => {
  const nassim = await guideWelcome({ freeText: 'salut', messages: [], persona: 'nassim' });
  const fabien = await guideWelcome({ freeText: 'salut', messages: [], persona: 'fabien' });
  assert.ok(PERSONAS.nassim.fallbacks.includes(nassim.reply));
  assert.ok(PERSONAS.fabien.fallbacks.includes(fabien.reply));
});

test('2 ans trop jeune, 4 ans Baby Boxe — pas la boxe anglaise adulte', async () => {
  const r = await guideWelcome({
    freeText: 'Je souhaite inscrire mes enfants de 2 ans et 4 ans à la boxe anglaise.',
    messages: [],
    persona: 'chloe',
  });
  assert.match(r.source, /knowledge-kids|faq-v4|faq/);
  assert.match(r.reply, /trop jeune|3 ans/i);
  assert.match(r.reply, /Baby Boxe/i);
  assert.doesNotMatch(r.reply, /éducative 7/i);
});

test('Chloe dit qu’il n’y a pas de clim dans les salles', async () => {
  const r = await guideWelcome({
    freeText: 'il y a la clim dans les salles ?',
    messages: [],
    persona: 'chloe',
  });
  assert.match(r.source, /faq/);
  assert.match(r.reply, /aucune|pas de clim|climatis/i);
  assert.doesNotMatch(r.reply, /sont climatisées/i);
});

test('après la Baby Boxe, « les prix » donne 250 € / 295 €, pas le script 29,99', async () => {
  const r = await guideWelcome({
    freeText: 'Ok et les prix ?',
    messages: [
      { role: 'user', content: 'Minimes' },
      {
        role: 'assistant',
        content:
          'Le planning **Baby Boxe / éducative** de **Minimes** : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/).',
      },
      { role: 'user', content: 'Ok et les prix ?' },
    ],
    persona: 'chloe',
  });
  assert.match(r.reply, /250/);
  assert.match(r.reply, /295/);
  assert.doesNotMatch(r.reply, /On ne dit pas/);
});

test('un adulte ce soir aux Minimes n’est pas recollé à la Baby Boxe', async () => {
  const r = await guideWelcome({
    freeText:
      'Je suis un adulte, c’est quoi le planning des Minimes pour ce soir je veux essayer un entrainement de boxe',
    messages: [
      {
        role: 'assistant',
        content:
          'Le planning **Baby Boxe / éducative** de **Minimes** : [voir le planning](https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/).',
      },
      {
        role: 'user',
        content:
          'Je suis un adulte, c’est quoi le planning des Minimes pour ce soir je veux essayer un entrainement de boxe',
      },
    ],
    persona: 'chloe',
  });
  assert.doesNotMatch(r.reply, /Baby Boxe \/ éducative/);
  assert.match(r.reply, /Minimes/i);
  assert.match(r.source, /planning/);
});

