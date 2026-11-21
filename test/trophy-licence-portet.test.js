'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLicenceLoisirsProduct,
  gymForInscriptionOrder,
} = require('../lib/offer-document-copy');
const { clubForOrder, CLUB_PORTET } = require('../storefront/lib/pdf-layout');

test('licence Trophy 20 force Portet meme si Minimes est demande', () => {
  const product = { id: 'licence-loisirs-trophy', name: 'Licence loisirs Trophy 50 €' };
  assert.equal(isLicenceLoisirsProduct(product, {}), true);
  assert.equal(gymForInscriptionOrder(product, { product_id: product.id }, 'minimes'), 'portet');
  assert.equal(gymForInscriptionOrder(product, { product_id: product.id }, 'etats-unis'), 'portet');
  assert.equal(clubForOrder({ product_id: product.id, customer_full: { gym: 'portet' } }), CLUB_PORTET);
});

test('les autres offres gardent la salle demandee', () => {
  assert.equal(gymForInscriptionOrder({ id: 'offre-duo' }, {}, 'minimes'), 'minimes');
});
