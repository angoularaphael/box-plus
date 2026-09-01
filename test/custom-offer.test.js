const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCustomOfferProduct,
  prepareCustomOffer,
  landingUrl,
  parsePriceCents,
  normalizeMode,
} = require('../storefront/lib/custom-offer');

test('parsePriceCents accepte euros et virgule', () => {
  assert.equal(parsePriceCents({ price_euros: '39,90' }), 3990);
  assert.equal(parsePriceCents({ price_cents: 25900 }), 25900);
  assert.equal(parsePriceCents({ price_euros: '0' }), null);
});

test('normalizeMode mappe abonnement / prélèvement', () => {
  assert.equal(normalizeMode('comptant'), 'comptant');
  assert.equal(normalizeMode('abonnement'), 'abonnement');
  assert.equal(normalizeMode('prelevement'), 'abonnement');
  assert.equal(normalizeMode(''), null);
});

test('buildCustomOfferProduct comptant sans IBAN', () => {
  const p = buildCustomOfferProduct({ price_euros: 80, mode: 'comptant', label: 'Offre Youssef' });
  assert.equal(p.subsection, 'comptant');
  assert.equal(p.requires_iban, false);
  assert.equal(p.price_cents, 8000);
  assert.equal(p.display_name, 'Offre Youssef');
  assert.match(p.id, /^custom-[a-f0-9]+$/);
});

test('buildCustomOfferProduct abonnement avec IBAN', () => {
  const p = buildCustomOfferProduct({ price_euros: 35, mode: 'abonnement' });
  assert.equal(p.subsection, 'prelevement');
  assert.equal(p.requires_iban, true);
  assert.equal(p.duration_label, 'Toutes les 4 semaines');
  assert.equal(p.price_cents, 3500);
});

test('prepareCustomOffer + landingUrl', () => {
  const prepared = prepareCustomOffer({
    price_euros: 49,
    mode: 'comptant',
    first_name: 'Léa',
    gym: 'minimes',
  });
  assert.equal(prepared.source, 'custom_offer');
  assert.equal(prepared.gym, 'minimes');
  assert.equal(prepared.customer_short.first_name, 'Léa');
  const url = landingUrl(
    { order_id: 'BC-1', access_token: 'abc' },
    'https://boutique.boxingcenter.fr'
  );
  assert.equal(url, 'https://boutique.boxingcenter.fr/offre-perso?order=BC-1&token=abc');
});
