'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  productSupportsBillingChoice,
  normalizeBillingPlan,
  requiresIbanForPlan,
  applyBillingPlanToProductConfig,
} = require('../lib/billing-plan');

describe('billing-plan', () => {
  const fourWeeks = {
    name: '44,99€/4 semaines',
    requires_iban: true,
    subsection: 'prelevement',
  };

  it('detects 4-week offers with billing choice', () => {
    assert.equal(productSupportsBillingChoice(fourWeeks), true);
    assert.equal(productSupportsBillingChoice({ name: 'COMPTANT 12 MOIS', requires_iban: false }), false);
  });

  it('cb plan skips iban', () => {
    assert.equal(requiresIbanForPlan(fourWeeks, 'cb'), false);
    assert.equal(requiresIbanForPlan(fourWeeks, 'rib'), true);
  });

  it('applyBillingPlanToProductConfig sets card mode', () => {
    const out = applyBillingPlanToProductConfig(
      { requires_iban: true, payment_mode: 'virement' },
      { payment: { billing_plan: 'cb' } }
    );
    assert.equal(out.payment_mode, 'card');
    assert.equal(out.skip_rib_prompt, true);
    assert.equal(out.requires_iban, false);
  });

  it('defaults to rib for 4-week products', () => {
    assert.equal(normalizeBillingPlan(null, fourWeeks), 'rib');
  });
});
