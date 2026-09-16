/**
 * Scalapay via PayPlug — flags, bornes montant, message d’erreur.
 */
const assert = require('assert');
const {
  isScalapayEnabled,
  isAmountEligibleForScalapay,
  SCALAPAY_MIN_CENTS,
  SCALAPAY_MAX_CENTS,
  SCALAPAY_UNAVAILABLE_MESSAGE,
  formatPayplugError,
  isPayplugPaymentPaid,
} = require('../storefront/lib/payplug');

function run() {
  assert.equal(SCALAPAY_MIN_CENTS, 500);
  assert.equal(SCALAPAY_MAX_CENTS, 200000);

  assert.equal(isAmountEligibleForScalapay(499), false);
  assert.equal(isAmountEligibleForScalapay(500), true);
  assert.equal(isAmountEligibleForScalapay(25900), true);
  assert.equal(isAmountEligibleForScalapay(200000), true);
  assert.equal(isAmountEligibleForScalapay(200001), false);

  const prev = process.env.PAYPLUG_SCALAPAY_ENABLED;
  delete process.env.PAYPLUG_SCALAPAY_ENABLED;
  assert.equal(isScalapayEnabled(), false, 'Scalapay désactivé par défaut');
  process.env.PAYPLUG_SCALAPAY_ENABLED = '0';
  assert.equal(isScalapayEnabled(), false);
  process.env.PAYPLUG_SCALAPAY_ENABLED = '1';
  assert.equal(isScalapayEnabled(), true);
  if (prev === undefined) delete process.env.PAYPLUG_SCALAPAY_ENABLED;
  else process.env.PAYPLUG_SCALAPAY_ENABLED = prev;

  assert.match(
    formatPayplugError({
      message: 'Access to this feature is not available.',
      body: { message: 'Access to this feature is not available.', details: [{ field: 'payment_method', message: 'scalapay' }] },
    }),
    /Scalapay/
  );
  assert.ok(SCALAPAY_UNAVAILABLE_MESSAGE.length > 10);

  assert.equal(isPayplugPaymentPaid({ is_paid: true, payment_method: { type: 'scalapay' } }), true);
  assert.equal(
    isPayplugPaymentPaid({
      is_paid: false,
      payment_method: { type: 'scalapay', is_pending: true },
    }),
    false
  );

  console.log('ok — Scalapay PayPlug flags / bornes / paid');
}

run();
