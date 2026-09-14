'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifySepaRemark,
  shouldResiliateUnpaid,
  SEPA_REASON,
} = require('../lib/sepa-unpaid-policy');

test('AM04 / fonds insuffisant : skip jusqu’à 3 impayés', () => {
  assert.equal(classifySepaRemark('AM04 Provision insuffisante'), SEPA_REASON.INSUFFICIENT_FUNDS);
  assert.equal(classifySepaRemark('fond insuffisant'), SEPA_REASON.INSUFFICIENT_FUNDS);
  const one = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AM04 Provision insuffisante'],
  });
  assert.equal(one.ok, false);
  assert.equal(one.why, 'am04_wait_three');
  const three = shouldResiliateUnpaid({
    n: 3,
    remarks: ['AM04 Provision insuffisante'],
  });
  assert.equal(three.ok, true);
  assert.equal(three.why, 'am04_three_unpaid');
});

test('MD01 absence de mandat → immédiat', () => {
  assert.equal(
    classifySepaRemark('MD01 Pas d’autorisation / Absence de mandat'),
    SEPA_REASON.NO_MANDATE
  );
  assert.equal(
    shouldResiliateUnpaid({
      unpaid_count: 1,
      remarks: ['MD01 Pas d’autorisation / Absence de mandat'],
    }).ok,
    true
  );
});

test('fiche sans e-mail ni téléphone → immédiat', () => {
  const one = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AM04 Provision insuffisante'],
    email: '',
    phone: '',
  });
  assert.equal(one.ok, true);
  assert.equal(one.why, 'missing_contact');
  const withPhone = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AM04 Provision insuffisante'],
    email: '',
    phone: '06 12 34 56 78',
  });
  assert.equal(withPhone.ok, false);
  assert.equal(withPhone.why, 'am04_wait_three');
});

test('AC01 RIB inexploitable et MS02 refus débiteur → immédiat', () => {
  assert.equal(
    classifySepaRemark('AC01 Coordonnee Bancaire inexploitable'),
    SEPA_REASON.BAD_BANK
  );
  assert.equal(
    classifySepaRemark('MS02 Sur ordre du client / Refus du débiteur'),
    SEPA_REASON.DEBTOR_REFUSAL
  );
  assert.equal(classifySepaRemark('(Erreur JSON Syntax error)'), SEPA_REASON.JSON_ERROR);
  assert.equal(
    shouldResiliateUnpaid({ unpaid_count: 1, remarks: ['AC01 Coordonnée Bancaire inexploitable'] }).ok,
    true
  );
  assert.equal(
    shouldResiliateUnpaid({ unpaid_count: 1, remarks: ['refus du débiteur'] }).ok,
    true
  );
  assert.equal(
    shouldResiliateUnpaid({ unpaid_count: 1, remarks: ['Erreur JSON Syntax error'] }).ok,
    true
  );
});

test('résiliation impayés : jamais Annuler la vente (neverVoid)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/cancel-sale.js'), 'utf8');
  assert.match(src, /neverVoid/);
  assert.doesNotMatch(src, /allowStarted:\s*true/);
  const script = require('fs').readFileSync(
    require('path').join(__dirname, '../scripts/mail-rib-and-resiliate-unpaid.js'),
    'utf8'
  );
  assert.match(script, /neverVoid:\s*true/);
  assert.doesNotMatch(script, /forceVoid/);
});
