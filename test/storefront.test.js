const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOrderPayload,
  validateCheckoutForm,
  validateFullForm,
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

test('validateIbanForm refuse un IBAN FR trop court même sur offre 12 mois', () => {
  const { validateIbanForm } = require('../storefront/lib/orders');
  const promo = {
    id: 'offre-saison',
    name: 'OFFRE PROMO 12 MOIS',
    supports_installment_choice: true,
  };
  const errors = validateIbanForm(
    { iban: 'FR4630002067510000039563', billing_plan: 'rib', payment_plan: '4x' },
    promo
  );
  assert.ok(errors.some((e) => /27 caract/i.test(e)), errors.join(', '));
});

test('validateOrder — IBAN invalide sur commande payée : RIB différé, pas de blocage', () => {
  const { normalizeOrder, validateOrder } = require('../lib/normalize');
  const order = normalizeOrder({
    order_id: 'BC-TEST-IBAN-SHORT',
    product_name: 'OFFRE PROMO 12 MOIS',
    gym: 'minimes',
    customer: { first_name: 'Lea', last_name: 'Test', email: 'lea@test.fr', phone: '0612345678' },
    payment: {
      amount: 64.75,
      status: 'paid',
      payment_plan: '4x',
      billing_plan: 'rib',
      iban: 'FR4630002067510000039563',
    },
  });
  assert.deepEqual(validateOrder(order), []);
  assert.equal(order.payment.iban, null);
});

test('markPaymentPaidAsync ignore un IBAN trop court', async () => {
  process.env.BOXPLUS_ORDERS_DIR = require('path').join(
    require('os').tmpdir(),
    `boxplus-iban-paid-${Date.now()}`
  );
  process.env.BOXPLUS_ORDERS_REMOTE = '0';
  const product = {
    id: 'offre-saison',
    name: 'OFFRE PROMO 12 MOIS',
    requires_iban: true,
    supports_installment_choice: true,
    price_cents: 25900,
  };
  const { createDraftAsync, markPaymentPaid, loadOrderAsync } = require('../storefront/lib/order-lifecycle');
  const draft = await createDraftAsync({
    product_id: product.id,
    product,
    customer_short: {
      first_name: 'Elie',
      last_name: 'Kabore',
      email: 'elie@test.fr',
      phone: '0750098655',
    },
  });
  await markPaymentPaid(draft.order_id, {
    method: 'payplug',
    payment_plan: '4x',
    billing_plan: 'rib',
    iban: 'FR7613506100008518444605',
  });
  const saved = await loadOrderAsync(draft.order_id);
  assert.ok(!saved.payment.iban);
});

test('validateFullForm sans IBAN si billing_plan cb (4 semaines)', () => {
  const fourWeeks = {
    name: '44,99€/4 semaines',
    requires_iban: true,
    subsection: 'prelevement',
  };
  const errors = validateFullForm(
    { gender: 'M', gym: 'minimes', billing_plan: 'cb' },
    fourWeeks
  );
  assert.ok(!errors.includes('IBAN requis'));
});

test('isStripeCheckoutPaid — uniquement si Stripe confirme le débit', () => {
  const { isStripeCheckoutPaid } = require('../storefront/lib/stripe-checkout');
  assert.equal(isStripeCheckoutPaid({ payment_status: 'paid' }), true);
  assert.equal(isStripeCheckoutPaid({ payment_status: 'no_payment_required' }), true);
  assert.equal(isStripeCheckoutPaid({ payment_status: 'unpaid' }), false);
  assert.equal(isStripeCheckoutPaid(null), false);
});
