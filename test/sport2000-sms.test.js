'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sport2000SmsText,
  normalizeFrenchMobile,
  LINK,
} = require('../scripts/send-sport2000-sms');

test('SMS Sport2000 — seance offerte David + STOP GSM', () => {
  const sms = sport2000SmsText();
  assert.match(sms, /c'est David/);
  assert.match(sms, /debutant OK/i);
  assert.match(sms, /seance-offerte\.boxingcenter\.fr\/s/);
  assert.match(sms, /STOP: reponds STOP/);
  assert.match(sms, /\{prenom\}/);
  assert.equal(LINK, 'https://seance-offerte.boxingcenter.fr/s');
  assert.doesNotMatch(sms, /[éèêëàâùûîïôöç]/i);
  assert.ok(sms.length <= 160);
});

test('normalise mobiles FR 06/07/336/337', () => {
  assert.equal(normalizeFrenchMobile('0693527901'), '+33693527901');
  assert.equal(normalizeFrenchMobile('33762513034'), '+33762513034');
  assert.equal(normalizeFrenchMobile('+33612345678'), '+33612345678');
  assert.equal(normalizeFrenchMobile('0512345678'), '');
  assert.equal(normalizeFrenchMobile(''), '');
});
