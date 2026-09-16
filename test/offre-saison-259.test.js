'use strict';

/**
 * Offre promo 259 € (OFFRE PROMO 12 MOIS) — doit se comporter en comptant
 * (1× ou 4×), sans IBAN, même si le catalogue Deciplus sync dit requires_iban.
 * Scalapay = tuile OFFRE PROMO 12 MOIS + note « 4× Scalapay ».
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

const PROMO_STATIC = {
  id: 'offre-saison',
  name: 'OFFRE PROMO 12 MOIS',
  badge: '1× ou 4× sans frais',
  supports_installment_choice: true,
  requires_iban: false,
  requires_payment: true,
  price_cents: 25900,
  subsection: 'comptant',
};

/** Comme après sync Deciplus (id live + IBAN abo) — cas qui cassait le dispatch. */
const PROMO_SYNCED_BROKEN = {
  id: 'dp-100',
  legacy_id: 'offre-saison',
  name: 'OFFRE PROMO 12 MOIS',
  price_cents: 29500,
  requires_iban: true,
  requires_payment: true,
  sale_type: 'abonnement',
  type: 'abo',
};

function sampleInput(overrides = {}) {
  return {
    order_id: 'BC-TEST-259',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada.259@example.com',
    phone: '0612345678',
    birthdate: '1990-01-15',
    gender: 'F',
    gym: 'minimes',
    address: '1 rue du Test',
    postal_code: '31000',
    city: 'Toulouse',
    payment_method: 'stripe',
    ...overrides,
  };
}

describe('offre 259 € — comptant', () => {
  it('détecte le choix 1× / 4× (id, legacy, nom)', () => {
    assert.equal(productSupportsInstallmentChoice(PROMO_STATIC), true);
    assert.equal(productSupportsInstallmentChoice(PROMO_SYNCED_BROKEN), true);
    assert.equal(
      productSupportsInstallmentChoice({ id: 'dp-100', name: 'OFFRE PROMO 12 MOIS' }),
      true
    );
    assert.equal(productSupportsInstallmentChoice({ id: 'offre-saison' }), true);
    assert.equal(
      productSupportsInstallmentChoice({ legacy_id: 'offre-saison', name: 'Autre' }),
      true
    );
  });

  it('est un produit style comptant (pas de prélèvement / badge auto)', () => {
    assert.equal(isComptantStyleProduct(PROMO_STATIC), true);
    assert.equal(isComptantStyleProduct(PROMO_SYNCED_BROKEN), true);
    assert.equal(productNeedsAutoBadge(PROMO_STATIC), false);
    assert.equal(productNeedsAutoBadge(PROMO_SYNCED_BROKEN), false);
    assert.equal(normalizeBillingPlan('rib', PROMO_SYNCED_BROKEN), null);
    assert.equal(requiresIbanForPlan(PROMO_SYNCED_BROKEN, 'rib'), false);
    assert.equal(requiresIbanForPlan(PROMO_STATIC, null), false);
  });

  it('normalise payment_plan once / 4x', () => {
    assert.equal(normalizePaymentPlan('once', PROMO_STATIC), 'once');
    assert.equal(normalizePaymentPlan('1x', PROMO_STATIC), 'once');
    assert.equal(normalizePaymentPlan('4x', PROMO_STATIC), '4x');
    assert.equal(normalizePaymentPlan('payplug_4x', PROMO_SYNCED_BROKEN), '4x');
    assert.match(paymentModeLabel(PROMO_STATIC, null, 'once'), /une fois/i);
    assert.match(paymentModeLabel(PROMO_STATIC, null, '4x'), /4× sans frais/i);
  });

  it('buildOrderPayload Scalapay — comptant Deciplus 259, sans IBAN, note 4× Scalapay', () => {
    const payload = buildOrderPayload(
      sampleInput({
        payment_plan: 'scalapay',
        payment_method: 'payplug',
        payplug_payment_id: 'pay_test_scalapay',
      }),
      PROMO_STATIC
    );
    assert.equal(payload.requires_iban, false);
    assert.equal(payload.payment_plan, 'scalapay');
    assert.equal(payload.paiement_comptant, true);
    assert.equal(payload.payment.method, 'payplug');
    assert.equal(payload.payment.iban, null);
    assert.equal(payload.payment.amount, 259);
    const order = normalizeOrder(payload);
    assert.equal(order.paiement_comptant, true);
    assert.deepEqual(validateOrder(order), []);

    const { buildProductConfig, pickBestCatalogTile } = require('../lib/catalog-sale');
    const cfg = buildProductConfig(order, {
      id: 100,
      title: '259€ EN 4X PRELEVEMENT',
      type: 'abo',
      categoryId: 'abo',
      price: 259,
    });
    assert.equal(cfg.paiement_comptant, true);
    assert.equal(cfg.requires_iban, false);
    assert.equal(cfg.deciplus_product_name, 'OFFRE PROMO 12 MOIS');
    assert.equal(cfg.deciplus_product_search, 'OFFRE PROMO 12');
    assert.equal(cfg.amount, 259);

    const { buildFourXInfoComptaNote, buildPaymentChannelInfoComptaNote } = require('../lib/info-compta-note');
    assert.equal(buildPaymentChannelInfoComptaNote(order), '3×/4× Scalapay');
    assert.equal(
      buildPaymentChannelInfoComptaNote({
        ...order,
        payment: { ...order.payment, scalapay_installments: 3 },
      }),
      '3× Scalapay'
    );
    assert.equal(
      buildFourXInfoComptaNote(order, {
        label: 'OFFRE PROMO 12 MOIS — 1× ou 4× sans frais',
        amount: 259,
      }),
      '',
      'Scalapay ne doit pas écrire un échéancier 4× club'
    );
    const pick = pickBestCatalogTile(
      [
        '259€ EN 4X PRELEVEMENT',
        'OFFRE PROMO 12 MOIS',
        'COMPTANT 12 MOIS — 400 €',
        '44,99€ / 4 semaines',
      ],
      cfg
    );
    assert.match(String(pick.text), /OFFRE PROMO 12 MOIS/i);
  });

  it('buildOrderPayload 1× — sans IBAN, paiement comptant, validation OK', () => {
    const payload = buildOrderPayload(sampleInput({ payment_plan: 'once' }), PROMO_STATIC);
    assert.equal(payload.requires_iban, false);
    assert.equal(payload.payment_plan, 'once');
    assert.equal(payload.paiement_comptant, true);
    assert.equal(payload.payment.iban, null);
    assert.equal(payload.payment.amount, 259);
    assert.equal(payload.payment.status, 'paid');
    const order = normalizeOrder(payload);
    assert.deepEqual(validateOrder(order), []);
  });

  it('buildOrderPayload 4× — sans IBAN, validation OK', () => {
    const payload = buildOrderPayload(
      sampleInput({ payment_plan: '4x', payment_method: 'payplug' }),
      PROMO_STATIC
    );
    assert.equal(payload.requires_iban, false);
    assert.equal(payload.payment_plan, '4x');
    assert.equal(payload.paiement_comptant, true);
    assert.equal(payload.payment.iban, null);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);
  });

  it('catalogue Deciplus « cassé » (requires_iban true) — dispatch sans IBAN', () => {
    const payload = buildOrderPayload(sampleInput({ payment_plan: 'once' }), PROMO_SYNCED_BROKEN);
    assert.equal(payload.requires_iban, false, 'ne doit plus exiger IBAN');
    assert.equal(payload.paiement_comptant, true);
    const errors = validateOrder(normalizeOrder(payload));
    assert.deepEqual(errors, [], `attendu [], got ${errors.join(', ')}`);
  });

  it('validateOrder laisse passer un 29 € déjà payé sans IBAN (1er mois CB)', () => {
    const order = normalizeOrder({
      order_id: 'BC-1786785336091-8377dd',
      product_id: 'dp-104',
      product_name: 'OFFRE A 29€',
      gym: 'st-cyprien',
      requires_iban: true,
      billing_plan: 'rib',
      payment: { status: 'paid', amount: 29.99, billing_plan: 'rib' },
      customer: {
        first_name: 'Marie-Dou',
        last_name: 'ETOGO',
        email: 'emn.mariedelphine@hotmail.fr',
        phone: '0663650275',
        birthdate: '1996-11-27',
      },
    });
    assert.deepEqual(validateOrder(order), []);
  });

  it('produit enrichi boutique — 259 €, comptant, legacy/id', () => {
    const p = findEnrichedProduct('offre-saison') || findEnrichedProduct('dp-100');
    assert.ok(p, 'offre-saison doit être résolue');
    assert.equal(p.price_cents, 25900, 'prix boutique 259 € (pas 295 Deciplus)');
    assert.equal(p.requires_iban, false);
    assert.equal(p.supports_installment_choice, true);
    assert.equal(p.subsection, 'comptant');
    assert.ok(
      p.id === 'offre-saison' || p.legacy_id === 'offre-saison' || /PROMO 12/i.test(p.name),
      'id ou legacy offre-saison'
    );

    const payload = buildOrderPayload(sampleInput({ payment_plan: 'once' }), p);
    assert.equal(payload.payment.amount, 259);
    assert.equal(payload.requires_iban, false);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);
  });
});
