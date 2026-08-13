/**
 * 4× PayPlug Oney + PayPal — validations et statuts.
 */
const assert = require('assert');
const {
  customerDetails,
  validateOneyCustomer,
  formatPayplugError,
  isPayplugPaymentPaid,
  isPayplugPaymentPending,
} = require('../storefront/lib/payplug');

function run() {
  const incomplete = customerDetails(
    {
      customer_short: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@test.fr', phone: '0612345678' },
    },
    { address: '12 rue de la Boxe', postal_code: '3100', city: 'Toulouse' }
  );
  assert.ok(!incomplete.title, 'pas de civilité par défaut Monsieur');
  const missing = validateOneyCustomer(incomplete);
  assert.ok(missing.some((m) => /civilité/i.test(m)));
  assert.ok(missing.some((m) => /code postal/i.test(m)));

  const ok = customerDetails(
    {
      customer_short: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@test.fr', phone: '0612345678' },
    },
    { address: '12 rue de la Boxe', postal_code: '31000', city: 'Toulouse', gender: 'F' }
  );
  assert.equal(ok.title, 'mrs');
  assert.equal(ok.mobile_phone_number, '+33612345678');
  assert.deepEqual(validateOneyCustomer(ok), []);

  const man = customerDetails(
    { customer_full: { gender: 'M', first_name: 'Jean', last_name: 'Boxe', email: 'j@b.fr', phone: '07 11 22 33 44' } },
    { address: '1 rue', postal_code: '31200', city: 'Toulouse' }
  );
  assert.equal(man.title, 'mr');
  assert.equal(man.mobile_phone_number, '+33711223344');
  assert.deepEqual(validateOneyCustomer(man), []);

  assert.equal(
    formatPayplugError({
      message: 'The payment cannot be created',
      body: { details: [{ field: 'billing.postcode', message: 'invalid postcode' }] },
    }),
    'The payment cannot be created — invalid postcode'
  );

  assert.equal(isPayplugPaymentPaid({ is_paid: true }), true);
  assert.equal(isPayplugPaymentPaid({ is_paid: false, failure: { message: 'refused' } }), false);
  assert.equal(
    isPayplugPaymentPaid({
      is_paid: false,
      auto_capture: true,
      authorization: { authorized_at: 1710000000 },
      payment_method: { type: 'oney_x4_without_fees', is_pending: false },
    }),
    true,
    'Oney autorisé + auto_capture = payé'
  );
  assert.equal(
    isPayplugPaymentPaid({
      is_paid: false,
      authorization: { authorized_at: null },
      payment_method: { type: 'oney_x4_without_fees', is_pending: true },
    }),
    false,
    'Oney encore en revue ≠ payé'
  );
  assert.equal(
    isPayplugPaymentPending({
      is_paid: false,
      payment_method: { is_pending: true },
    }),
    true
  );

  console.log('ok — 4× PayPlug validations / Oney paid vs pending');
}

run();
