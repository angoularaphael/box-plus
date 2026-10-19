'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAdultFixedTermComptant, productSupportsInstallmentChoice, productSupportsScalapay,
  supportsScalapayCheckout, requiresIbanForPlan, normalizePaymentPlan, productNeedsAutoBadge,
} = require('../lib/billing-plan');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { buildUpsellForOrder } = require('../storefront/lib/blade-upsell');

for (const months of [3, 6, 12]) {
  test(`comptant ${months} mois : fractionnement sans RIB, Portet PayPal, gants après paiement`, () => {
    const id = `comptant-${months}-mois`;
    const product = findEnrichedProduct(id);
    assert.ok(product);
    for (const p of [product, { id }, { id: 'dp-live', legacy_id: id }, { name: `COMPTANT ${months} MOIS` }]) {
      assert.equal(isAdultFixedTermComptant(p), true);
      assert.equal(productSupportsInstallmentChoice(p), true);
      assert.equal(productSupportsScalapay(p), true);
      assert.equal(normalizePaymentPlan('4x', p), '4x');
      assert.equal(normalizePaymentPlan('scalapay', p), 'scalapay');
      assert.equal(requiresIbanForPlan(p, 'rib', '4x'), false);
      assert.equal(supportsScalapayCheckout(p, 'portet'), false);
      assert.equal(supportsScalapayCheckout(p, 'minimes'), true);
    }
    assert.equal(productNeedsAutoBadge(product), false);
    const order = { product_snapshot: product, payment: { status: 'paid' } };
    assert.equal(buildUpsellForOrder(order).show, true);
    assert.deepEqual(buildUpsellForOrder(order).product.pickup_gyms,
      ['Barrière de Paris - Minimes', 'Toulouse St-Cyprien']);
    assert.equal(buildUpsellForOrder({ ...order, payment: { status: 'pending' } }).show, false);
  });
}

test('les offres récurrentes et enfants gardent leurs règles', () => {
  assert.equal(isAdultFixedTermComptant({ id: 'baby-boxe', price_cents: 25000 }), false);
  assert.equal(productSupportsScalapay({ id: '44-99-4-semaines' }), false);
  assert.equal(requiresIbanForPlan({ id: 'baby-boxe' }, 'rib', '4x'), true);
});
