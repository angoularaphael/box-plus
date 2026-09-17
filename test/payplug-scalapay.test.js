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
  assert.equal(isScalapayEnabled(), true, 'Scalapay activé par défaut');
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
    /CB|plusieurs fois/i
  );
  assert.ok(SCALAPAY_UNAVAILABLE_MESSAGE.length > 10);
  assert.match(require('../storefront/lib/payplug').SCALAPAY_FEES_HINT, /1,?5\s*%|3×/i);
  assert.match(require('../storefront/lib/payplug').SCALAPAY_REFUSAL_HELP, /boxingcenter31@gmail\.com/);
  assert.match(
    require('../storefront/lib/payplug').SCALAPAY_REFUSAL_HELP,
    /solution de paiement alternative/i
  );

  const { productSupportsScalapay } = require('../lib/billing-plan');
  assert.equal(productSupportsScalapay({ id: 'offre-saison', price_cents: 25900 }), true);
  assert.equal(productSupportsScalapay({ id: 'comptant-12-mois', price_cents: 40000 }), true);
  assert.equal(productSupportsScalapay({ id: 'boxe-educative' }), true);
  assert.equal(productSupportsScalapay({ id: 'baby-boxe' }), true);
  assert.equal(productSupportsScalapay({ id: 'offre-duo', price_cents: 2900 }), false);
  assert.equal(productSupportsScalapay({ id: 'materiel-gants', price_cents: 5000 }), false);

  const { gymSupportsScalapay, supportsScalapayCheckout } = require('../lib/billing-plan');
  assert.equal(gymSupportsScalapay('minimes'), true);
  assert.equal(gymSupportsScalapay('portet'), false);
  assert.equal(gymSupportsScalapay('Portet-sur-Garonne'), false);
  assert.equal(supportsScalapayCheckout({ id: 'offre-saison' }, 'minimes'), true);
  assert.equal(supportsScalapayCheckout({ id: 'offre-saison' }, 'portet'), false);

  const { resolveScalapayDeciplus, isScalapayOrder, scalapayInfoComptaNote } = require('../lib/billing-plan');
  assert.equal(isScalapayOrder({ payment: { payment_plan: 'scalapay' } }), true);
  assert.equal(scalapayInfoComptaNote({ payment: { payment_plan: 'scalapay' } }), '3×/4× Scalapay');
  assert.equal(
    scalapayInfoComptaNote({ payment: { payment_plan: 'scalapay', scalapay_installments: 3 } }),
    '3× Scalapay'
  );
  assert.equal(
    scalapayInfoComptaNote({ payment: { payment_plan: 'scalapay', payment_method: { installment_count: 4 } } }),
    '4× Scalapay'
  );
  assert.equal(
    resolveScalapayDeciplus({ id: 'offre-saison', price_cents: 25900 }, { payment: { amount: 259 } })
      .deciplus_product_name,
    'OFFRE PROMO 12 MOIS'
  );
  assert.equal(
    resolveScalapayDeciplus({ id: 'offre-saison' }, { payment: { amount: 259 } })
      .deciplus_product_search,
    'OFFRE PROMO 12'
  );

  assert.equal(isPayplugPaymentPaid({ is_paid: true, payment_method: { type: 'scalapay' } }), true);
  assert.equal(
    isPayplugPaymentPaid({
      is_paid: false,
      payment_method: { type: 'scalapay', is_pending: true },
    }),
    false
  );

  const fs = require('fs');
  const path = require('path');
  const serverSrc = fs.readFileSync(path.join(__dirname, '../storefront/server.js'), 'utf8');
  assert.equal(
    serverSrc.includes("require('../../lib/billing-plan')"),
    false,
    'storefront/server.js must require ../lib/billing-plan (Vercel root), not ../../lib'
  );

  assert.equal(
    serverSrc.includes("meta.billing_plan === 'rib' ||"),
    false,
    'un 29 € RIB ne doit pas être marqué 4× prélèvement'
  );

  console.log('ok — Scalapay PayPlug flags / bornes / paid');
}

run();
