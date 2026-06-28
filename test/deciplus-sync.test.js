const test = require('node:test');
const assert = require('node:assert/strict');
const { inferStripeEuros, mapDeciplusItem } = require('../storefront/lib/deciplus-sync');

test('inferStripeEuros — 1ère échéance depuis titre', () => {
  assert.equal(inferStripeEuros({ title: 'OFFRE A 29€', price: 419.86 }), 29);
  assert.equal(inferStripeEuros({ title: 'OFFRE PROMO 38.99€ ADULTE', price: 545.86 }), 38.99);
  assert.equal(inferStripeEuros({ title: 'COMPTANT 3 MOIS', price: 150 }), 150);
  assert.equal(inferStripeEuros({ title: 'OFFRE PROMO 9€', price: 9 }), 9);
});

test('mapDeciplusItem — nom identique Deciplus', () => {
  const item = mapDeciplusItem({
    id: 99,
    title: 'OFFRE A 29€',
    price: 419.86,
    categoryId: 'abo',
    categoryTitle: 'Abonnements',
    type: 'abo',
  });
  assert.equal(item.name, 'OFFRE A 29€');
  assert.equal(item.price_cents, 2900);
  assert.equal(item.requires_iban, true);
  assert.ok(item.deciplus_total_note.includes('419'));
});
