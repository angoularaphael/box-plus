'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  productSupportsPassSport,
  passSportChargeCents,
  passSportEmailForGym,
  wantsPassSport,
  PASS_SPORT_CENTS,
} = require('../lib/pass-sport');

test('Pass Sport uniquement Baby Boxe et Boxe éducative', () => {
  assert.equal(productSupportsPassSport({ id: 'dp-93', legacy_id: 'baby-boxe', name: 'BABY BOXE' }), true);
  assert.equal(productSupportsPassSport({ id: 'dp-45', legacy_id: 'boxe-educative', name: 'BOXE EDUCATIVE' }), true);
  assert.equal(productSupportsPassSport({ id: 'dp-91', name: 'COMPTANT 6 MOIS', price_cents: 25000 }), false);
  assert.equal(productSupportsPassSport({ id: 'offre-saison', name: 'OFFRE PROMO 12 MOIS' }), false);
});

test('50 € déduits : 200 € Baby Boxe, 245 € enfants', () => {
  assert.equal(passSportChargeCents({ id: 'dp-93', price_cents: 25000 }), 20000);
  assert.equal(passSportChargeCents({ id: 'dp-45', price_cents: 29500 }), 24500);
  assert.equal(PASS_SPORT_CENTS, 5000);
  assert.equal(passSportChargeCents({ id: 'dp-100', price_cents: 25900 }), 25900);
});

test('email Pass Sport : Portet à part, les autres salles au club', () => {
  assert.equal(passSportEmailForGym('portet'), 'boxingcenterportet@gmail.com');
  assert.equal(passSportEmailForGym('Portet-sur-Garonne'), 'boxingcenterportet@gmail.com');
  assert.equal(passSportEmailForGym('minimes'), 'boxingcenter31@gmail.com');
  assert.equal(passSportEmailForGym('ramonville'), 'boxingcenter31@gmail.com');
  assert.equal(passSportEmailForGym('st-cyprien'), 'boxingcenter31@gmail.com');
  assert.equal(passSportEmailForGym('etats-unis'), 'boxingcenter31@gmail.com');
});

test('wantsPassSport accepte les valeurs du formulaire', () => {
  assert.equal(wantsPassSport({ pass_sport: true }), true);
  assert.equal(wantsPassSport({ pass_sport: '1' }), true);
  assert.equal(wantsPassSport({ pass_sport: false }), false);
  assert.equal(wantsPassSport({}), false);
});
