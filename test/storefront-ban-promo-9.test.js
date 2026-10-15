const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isStorefrontProduct,
  isBannedStorefrontProduct,
} = require('../storefront/lib/storefront-copy');

test('offre promo 9 € interdite sur la boutique', () => {
  const sample = { id: 'offre-promo-9', name: 'OFFRE PROMO 9€', type: 'abo', category: 'Abonnements' };
  assert.equal(isBannedStorefrontProduct(sample), true);
  assert.equal(isStorefrontProduct(sample), false);
});

test('sync Deciplus dp-101 promo 9 € interdit', () => {
  const sample = {
    id: 'dp-101',
    deciplus_id: 101,
    name: 'OFFRE PROMO 9€',
    type: 'abo',
    category: 'Abonnements',
  };
  assert.equal(isStorefrontProduct(sample), false);
});

test('offres promo 38,99 € et 34,99 € interdites', () => {
  assert.equal(
    isBannedStorefrontProduct({ id: 'offre-promo-adulte', name: 'OFFRE PROMO 38.99€ ADULTE' }),
    true
  );
  assert.equal(
    isBannedStorefrontProduct({ id: 'offre-promo-etudiant', name: 'OFFRE PROMO 34.99€ ETUDIANTS' }),
    true
  );
  assert.equal(isBannedStorefrontProduct({ id: 'dp-102', deciplus_id: 102, name: 'x' }), true);
  assert.equal(isBannedStorefrontProduct({ id: 'dp-103', deciplus_id: 103, name: 'x' }), true);
});
