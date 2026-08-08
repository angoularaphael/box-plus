#!/usr/bin/env node
/**
 * Tests unitaires — coloriage mismatch identité (changement d’abo / résiliation).
 * Usage: node scripts/test-identity-mismatch-unit.js
 */
'use strict';

const {
  computeIdentityMismatches,
  CHANGE_MATCH_FIELDS,
} = require('../bot/member');
const { normalizeOrder, validateOrder } = require('../lib/normalize');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function test(name, fn) {
  fn();
  console.log(`OK  ${name}`);
}

test('mauvaise date seule → uniquement birthdate', () => {
  const { mismatchFields } = computeIdentityMismatches(
    {
      lastName: 'Dupont',
      firstName: 'Marie',
      birth: '12/12/2012',
      phone: '0612345678',
      foundViaPhone: true,
    },
    {
      last_name: 'DUPONT',
      first_name: 'marie',
      birthdate: '2000-01-01',
      phone: '0612345678',
    },
    { fields: CHANGE_MATCH_FIELDS }
  );
  assert(
    mismatchFields.length === 1 && mismatchFields[0] === 'birthdate',
    `attendu [birthdate], got ${JSON.stringify(mismatchFields)}`
  );
});

test('casse / accents ignorés sur nom-prénom', () => {
  const { mismatchFields } = computeIdentityMismatches(
    { lastName: 'Léa-Martin', firstName: 'Jean', birth: '01/01/1990', phone: '' },
    { last_name: 'lea martin', first_name: 'JEAN', birthdate: '1990-01-01', phone: '0600000000' },
    { fields: CHANGE_MATCH_FIELDS }
  );
  assert(mismatchFields.length === 0, `attendu [], got ${JSON.stringify(mismatchFields)}`);
});

test('année Deciplus 2 chiffres comparable', () => {
  const { mismatchFields } = computeIdentityMismatches(
    { lastName: 'Test', firstName: 'A', birth: '15/03/95', phone: '' },
    { last_name: 'Test', first_name: 'A', birthdate: '1995-03-15', phone: '' },
    { fields: CHANGE_MATCH_FIELDS }
  );
  assert(mismatchFields.length === 0, `attendu [], got ${JSON.stringify(mismatchFields)}`);
});

test('fiche sans nom lisible → ne colore pas nom/prénom', () => {
  const { mismatchFields } = computeIdentityMismatches(
    { lastName: '', firstName: '', birth: '01/01/2000', phone: '', foundViaPhone: true },
    { last_name: 'X', first_name: 'Y', birthdate: '1990-01-01', phone: '0611111111' },
    { fields: CHANGE_MATCH_FIELDS }
  );
  assert(
    !mismatchFields.includes('last_name') && !mismatchFields.includes('first_name'),
    `ne doit pas marquer noms vides: ${JSON.stringify(mismatchFields)}`
  );
  assert(mismatchFields.includes('birthdate'), 'birthdate doit être en erreur');
});

test('mauvais prénom + mauvaise date → 2 champs seulement', () => {
  const { mismatchFields } = computeIdentityMismatches(
    { lastName: 'Dupont', firstName: 'Paul', birth: '01/01/1990', phone: '0600000000' },
    { last_name: 'Dupont', first_name: 'Marie', birthdate: '2001-01-01', phone: '0600000000' },
    { fields: CHANGE_MATCH_FIELDS }
  );
  assert(
    mismatchFields.length === 2 &&
      mismatchFields.includes('first_name') &&
      mismatchFields.includes('birthdate'),
    `attendu first_name+birthdate, got ${JSON.stringify(mismatchFields)}`
  );
});

test('changement comptant : payload vente valide (montant)', () => {
  const amountEuros = 295;
  const order = normalizeOrder({
    order_id: `CHANGE-TEST-${Date.now()}`,
    action: 'sale',
    first_name: 'Test',
    last_name: 'Change',
    birthdate: '1990-01-01',
    phone: '0612345678',
    email: 'test-change@example.com',
    gym: 'minimes',
    gender: 'M',
    address: '1 rue Test',
    postal_code: '31000',
    city: 'Toulouse',
    product_name: 'COMPTANT 3 MOIS',
    requires_payment: true,
    requires_iban: false,
    sale_type: 'abonnement',
    paiement_comptant: true,
    payment: {
      amount: amountEuros,
      method: 'stripe',
      status: 'paid',
      date: new Date().toISOString(),
      stripe_session_id: 'cs_test_x',
    },
  });
  const errors = validateOrder(order);
  assert(errors.length === 0, `validation vente changement: ${errors.join(', ')}`);
  assert(order.payment.amount === amountEuros, 'montant euros attendu');
});

console.log('\nTous les tests identité / changement OK');
