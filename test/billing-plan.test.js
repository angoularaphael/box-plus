'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  productSupportsBillingChoice,
  isComptantStyleProduct,
  normalizeBillingPlan,
  requiresIbanForPlan,
  applyBillingPlanToProductConfig,
} = require('../lib/billing-plan');

describe('billing-plan', () => {
  const fourWeeks = {
    name: '44,99€/4 semaines',
    requires_iban: true,
    subsection: 'prelevement',
    sale_type: 'abonnement',
  };

  it('4-week offers support RIB or CB choice', () => {
    assert.equal(productSupportsBillingChoice(fourWeeks), true);
    assert.equal(productSupportsBillingChoice({ name: 'COMPTANT 12 MOIS', requires_iban: false }), false);
  });

  it('cb plan still needs iban for badge ~72h', () => {
    assert.equal(normalizeBillingPlan('cb', fourWeeks), 'cb');
    assert.equal(requiresIbanForPlan(fourWeeks, 'cb'), true);
    assert.equal(requiresIbanForPlan(fourWeeks, 'rib'), true);
  });

  it('comptant / 4x sans frais = style carte', () => {
    assert.equal(isComptantStyleProduct({ name: 'COMPTANT 12 MOIS' }), true);
    assert.equal(isComptantStyleProduct({ name: 'OFFRE PROMO', badge: '4× sans frais' }), true);
    assert.equal(productSupportsBillingChoice({ name: 'OFFRE PROMO', badge: '4× sans frais', requires_iban: true }), false);
  });

  it('applyBillingPlanToProductConfig sets card mode', () => {
    const out = applyBillingPlanToProductConfig(
      { requires_iban: true, payment_mode: 'virement' },
      { payment: { billing_plan: 'cb' }, requires_iban: true, product_name: '44,99€/4 semaines' }
    );
    assert.equal(out.payment_mode, 'card');
    assert.equal(out.skip_rib_prompt, true);
    assert.equal(out.requires_iban, false);
  });

  it('defaults to rib for 4-week products', () => {
    assert.equal(normalizeBillingPlan(null, fourWeeks), 'rib');
  });
});
