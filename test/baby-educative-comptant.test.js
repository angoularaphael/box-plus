'use strict';

/**
 * Baby Boxe + Boxe éducative — paiement comptant (1× ou 4×),
 * comme l’offre 259 € : pas d’IBAN / prélèvement, calendrier 4×.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  productSupportsInstallmentChoice,
  isComptantStyleProduct,
  requiresIbanForPlan,
  normalizePaymentPlan,
  normalizeBillingPlan,
  productNeedsAutoBadge,
  paymentModeLabel,
} = require('../lib/billing-plan');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { buildOrderPayload } = require('../storefront/lib/orders');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { buildFourXInfoComptaNote } = require('../lib/info-compta-note');

const BABY_STATIC = {
  id: 'baby-boxe',
  name: 'BABY BOXE',
  badge: '1× ou 4× sans frais',
  supports_installment_choice: true,
  requires_iban: false,
  requires_payment: true,
  price_cents: 25000,
  subsection: 'enfants',
};

const EDU_STATIC = {
  id: 'boxe-educative',
  name: 'BOXE EDUCATIVE',
  badge: '1× ou 4× sans frais',
  supports_installment_choice: true,
  requires_iban: false,
  requires_payment: true,
  price_cents: 29500,
  subsection: 'enfants',
};

/** Comme après sync Deciplus (id live + IBAN abo) — cas qui cassait le dispatch. */
const BABY_SYNCED_BROKEN = {
  id: 'dp-93',
  legacy_id: 'baby-boxe',
  name: 'BABY BOXE',
  price_cents: 25000,
  requires_iban: true,
  requires_payment: true,
  sale_type: 'abonnement',
  type: 'abo',
};

const EDU_SYNCED_BROKEN = {
  id: 'dp-45',
  legacy_id: 'boxe-educative',
  name: 'BOXE EDUCATIVE',
  price_cents: 29500,
  requires_iban: true,
  requires_payment: true,
  sale_type: 'abonnement',
  type: 'abo',
};

function sampleInput(overrides = {}) {
  return {
    order_id: 'BC-TEST-ENFANT',
    first_name: 'Léa',
    last_name: 'Martin',
    email: 'lea.enfant@example.com',
    phone: '0612345678',
    birthdate: '2018-03-12',
    gender: 'F',
    gym: 'minimes',
    address: '1 rue du Test',
    postal_code: '31000',
    city: 'Toulouse',
    payment_method: 'stripe',
    ...overrides,
  };
}

describe('Baby Boxe / Boxe éducative — comptant 1× / 4×', () => {
  it('détecte le choix 1× / 4× (id, legacy, nom, dp-*)', () => {
    assert.equal(productSupportsInstallmentChoice(BABY_STATIC), true);
    assert.equal(productSupportsInstallmentChoice(EDU_STATIC), true);
    assert.equal(productSupportsInstallmentChoice(BABY_SYNCED_BROKEN), true);
    assert.equal(productSupportsInstallmentChoice(EDU_SYNCED_BROKEN), true);
    assert.equal(productSupportsInstallmentChoice({ id: 'dp-93', name: 'BABY BOXE' }), true);
    assert.equal(productSupportsInstallmentChoice({ id: 'dp-45', name: 'BOXE EDUCATIVE' }), true);
    assert.equal(
      productSupportsInstallmentChoice({ legacy_id: 'baby-boxe', name: 'Autre' }),
      true
    );
    assert.equal(
      productSupportsInstallmentChoice({ legacy_id: 'boxe-educative', name: 'Autre' }),
      true
    );
  });

  it('est un produit style comptant (pas de prélèvement / badge auto)', () => {
    for (const p of [BABY_STATIC, EDU_STATIC, BABY_SYNCED_BROKEN, EDU_SYNCED_BROKEN]) {
      assert.equal(isComptantStyleProduct(p), true, p.id);
      assert.equal(productNeedsAutoBadge(p), false, p.id);
      assert.equal(normalizeBillingPlan('rib', p), null, p.id);
      assert.equal(requiresIbanForPlan(p, 'rib'), false, p.id);
    }
  });

  it('normalise payment_plan once / 4x', () => {
    assert.equal(normalizePaymentPlan('once', BABY_STATIC), 'once');
    assert.equal(normalizePaymentPlan('4x', BABY_STATIC), '4x');
    assert.equal(normalizePaymentPlan('payplug_4x', EDU_SYNCED_BROKEN), '4x');
    assert.match(paymentModeLabel(EDU_STATIC, null, 'once'), /une fois/i);
    assert.match(paymentModeLabel(EDU_STATIC, null, '4x'), /4× sans frais/i);
  });

  it('buildOrderPayload Baby 1× — sans IBAN, paiement comptant', () => {
    const payload = buildOrderPayload(sampleInput({ payment_plan: 'once' }), BABY_STATIC);
    assert.equal(payload.requires_iban, false);
    assert.equal(payload.payment_plan, 'once');
    assert.equal(payload.paiement_comptant, true);
    assert.equal(payload.payment.iban, null);
    assert.equal(payload.payment.amount, 250);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);
  });

  it('buildOrderPayload Boxe éducative 4× — sans IBAN + note dates', () => {
    const payload = buildOrderPayload(
      sampleInput({ payment_plan: '4x', payment_method: 'payplug', order_id: 'BC-TEST-EDU-4X' }),
      EDU_STATIC
    );
    assert.equal(payload.requires_iban, false);
    assert.equal(payload.payment_plan, '4x');
    assert.equal(payload.paiement_comptant, true);
    assert.equal(payload.payment.amount, 295);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);

    const note = buildFourXInfoComptaNote(normalizeOrder(payload), {
      label: 'BOXE EDUCATIVE',
      amount: 295,
    });
    assert.match(note, /4× sans frais/);
    assert.match(note, /2ᵉ échéance/);
    assert.match(note, /3ᵉ échéance/);
    assert.match(note, /4ᵉ échéance/);
    assert.match(note, /73,75/);
  });

  it('catalogue Deciplus « cassé » (requires_iban true) — dispatch sans IBAN', () => {
    for (const p of [BABY_SYNCED_BROKEN, EDU_SYNCED_BROKEN]) {
      const payload = buildOrderPayload(sampleInput({ payment_plan: 'once' }), p);
      assert.equal(payload.requires_iban, false, p.id);
      assert.equal(payload.paiement_comptant, true, p.id);
      assert.deepEqual(validateOrder(normalizeOrder(payload)), [], p.id);
    }
  });

  it('produits enrichis boutique — comptant 1×/4×, onglet enfants', () => {
    const baby = findEnrichedProduct('baby-boxe') || findEnrichedProduct('dp-93');
    const edu = findEnrichedProduct('boxe-educative') || findEnrichedProduct('dp-45');
    assert.ok(baby, 'baby-boxe doit être résolue');
    assert.ok(edu, 'boxe-educative doit être résolue');

    for (const p of [baby, edu]) {
      assert.equal(p.requires_iban, false, p.id);
      assert.equal(p.supports_installment_choice, true, p.id);
      assert.equal(p.subsection, 'enfants', p.id);
      assert.match(String(p.installments_note || ''), /4× sans frais/i, p.id);
      assert.equal(isComptantStyleProduct(p), true, p.id);

      const once = buildOrderPayload(sampleInput({ payment_plan: 'once' }), p);
      assert.equal(once.requires_iban, false, p.id);
      assert.equal(once.paiement_comptant, true, p.id);
      assert.deepEqual(validateOrder(normalizeOrder(once)), [], p.id);

      const four = buildOrderPayload(
        sampleInput({ payment_plan: '4x', payment_method: 'payplug' }),
        p
      );
      assert.equal(four.payment_plan, '4x', p.id);
      assert.deepEqual(validateOrder(normalizeOrder(four)), [], p.id);
    }

    assert.equal(baby.price_cents, 25000);
    assert.equal(edu.price_cents, 29500);
  });
});
