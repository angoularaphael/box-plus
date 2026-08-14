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

test('la relance générique prend la voix du conseiller', async () => {
  const nassim = await guideWelcome({ freeText: 'salut', messages: [], persona: 'nassim' });
  const fabien = await guideWelcome({ freeText: 'salut', messages: [], persona: 'fabien' });
  assert.ok(PERSONAS.nassim.fallbacks.includes(nassim.reply));
  assert.ok(PERSONAS.fabien.fallbacks.includes(fabien.reply));
});
