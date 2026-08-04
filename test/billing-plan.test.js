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

  it('no longer offers RIB vs CB choice', () => {
    assert.equal(productSupportsBillingChoice(fourWeeks), false);
    assert.equal(productSupportsBillingChoice({ name: 'COMPTANT 12 MOIS', requires_iban: false }), false);
  });

  it('forces rib even if client asks for cb on prelevement', () => {
    assert.equal(normalizeBillingPlan('cb', fourWeeks), 'rib');
    assert.equal(requiresIbanForPlan(fourWeeks, 'cb'), true);
    assert.equal(requiresIbanForPlan(fourWeeks, 'rib'), true);
  });

  it('comptant / 4x sans frais = style carte', () => {
    assert.equal(isComptantStyleProduct({ name: 'COMPTANT 12 MOIS' }), true);
    assert.equal(isComptantStyleProduct({ name: 'OFFRE PROMO', badge: '4× sans frais' }), true);
    assert.equal(normalizeBillingPlan('rib', { name: 'COMPTANT 12 MOIS', requires_iban: false }), null);
  });

  it('applyBillingPlanToProductConfig ignores legacy cb on prelevement', () => {
    const out = applyBillingPlanToProductConfig(
      { requires_iban: true, payment_mode: 'virement' },
      { payment: { billing_plan: 'cb' }, requires_iban: true, product_name: '44,99€/4 semaines' }
    );
    // cb forcé en rib → config inchangée
    assert.equal(out.payment_mode, 'virement');
    assert.equal(out.requires_iban, true);
  });

  it('defaults to rib for 4-week products', () => {
    assert.equal(normalizeBillingPlan(null, fourWeeks), 'rib');
  });
});
