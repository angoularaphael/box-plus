const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOrderPayload,
  validateCheckoutForm,
} = require('../storefront/lib/orders');

const product = {
  id: 'offre-duo',
  name: 'OFFRE A 29€',
  price_cents: 2900,
  requires_iban: true,
  requires_payment: true,
};

test('buildOrderPayload format BOXPLUS', () => {
  const payload = buildOrderPayload(
    {
      first_name: 'Jean',
      last_name: 'Dupont',
      email: 'jean@test.fr',
      phone: '0612345678',
      gym: 'minimes',
      birthdate: '1990-01-01',
      gender: 'M',
      iban: 'FR7630001007941234567890185',
      order_id: 'STORE-TEST-1',
    },
    product
  );

  assert.equal(payload.product_name, 'OFFRE A 29€');
  assert.equal(payload.payment.amount, 29);
  assert.equal(payload.payment.iban, 'FR7630001007941234567890185');
  assert.equal(payload.source, 'storefront-stripe');
});

test('validateCheckoutForm exige IBAN pour offre payante', () => {
  const errors = validateCheckoutForm(
    { first_name: 'A', last_name: 'B', email: 'a@b.fr', phone: '0600000000', gym: 'minimes', birthdate: '1990-01-01', gender: 'M' },
    product
  );
  assert.ok(errors.includes('IBAN requis'));
});
