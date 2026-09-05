'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPayplug4xPrelevement,
  isPayplug4xPrelevementOrder,
  requiresIbanForPlan,
  PAYPLUG_4X_DECIPLUS_LABEL,
  resolvePayplug4xPrelevementDeciplus,
} = require('../lib/billing-plan');
const { buildProductConfig, pickBestCatalogTile } = require('../lib/catalog-sale');
const { buildOrderPayload } = require('../storefront/lib/orders');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { buildFourXInfoComptaNote } = require('../lib/info-compta-note');

const PROMO = {
  id: 'offre-saison',
  name: 'OFFRE PROMO 12 MOIS',
  supports_installment_choice: true,
  requires_iban: false,
  requires_payment: true,
  price_cents: 25900,
  subsection: 'comptant',
};

describe('PayPlug 4× prélèvement (25 % CB + RIB)', () => {
  it('détecte le mode 4× + RIB', () => {
    assert.equal(isPayplug4xPrelevement('4x', 'rib'), true);
    assert.equal(isPayplug4xPrelevement('4x', 'paypal'), false);
    assert.equal(
      isPayplug4xPrelevementOrder({ payment: { payment_plan: '4x', billing_plan: 'rib' } }),
      true
    );
  });

  it('exige l’IBAN pour 4× PayPlug prélèvement', () => {
    assert.equal(requiresIbanForPlan(PROMO, 'rib', '4x'), true);
    assert.equal(requiresIbanForPlan(PROMO, null, 'once'), false);
  });

  it('buildOrderPayload — quart payé, IBAN requis, pas comptant', () => {
    const payload = buildOrderPayload(
      { payment_plan: '4x', billing_plan: 'rib', payment_method: 'payplug', ...sample() },
      PROMO
    );
    assert.equal(payload.requires_iban, true);
    assert.equal(payload.paiement_comptant, false);
    assert.equal(payload.payment_plan, '4x');
    assert.equal(payload.billing_plan, 'rib');
    assert.equal(payload.payment.amount, 64.75);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);
  });

  it('résout la tuile Deciplus selon le produit (259 €, enfants)', () => {
    assert.match(
      resolvePayplug4xPrelevementDeciplus({ id: 'offre-saison', price_cents: 25900 }).deciplus_product_name,
      /259.*4X PRELEVEMENT/i
    );
    assert.match(
      resolvePayplug4xPrelevementDeciplus({ id: 'boxe-educative', price_cents: 29500 }).deciplus_product_name,
      /ENFANTS 295.*4x SANS FRAIS/i
    );
    assert.match(
      resolvePayplug4xPrelevementDeciplus({ id: 'baby-boxe', price_cents: 25000 }).deciplus_product_name,
      /BABY BOXE 250.*4X SANS FRAIS/i
    );
  });

  it('catalogue Deciplus — tuile BABY BOXE 250€ 4X SANS FRAIS', () => {
    const grid = [
      'BABY BOXE 250,00€',
      'BABY BOXE 250€ 4X SANS FRAIS 250,00€',
      'ENFANTS 295€ 4x SANS FRAIS 295,00€',
    ];
    const pick = pickBestCatalogTile(grid, {
      payplug_4x_prelevement: true,
      deciplus_product_name: 'BABY BOXE 250€ 4X SANS FRAIS',
      amount: 250,
      paiement_comptant: false,
    });
    assert.match(String(pick.text), /BABY BOXE 250.*4X SANS FRAIS/i);
    assert.ok(!/BABY BOXE 250,00/i.test(String(pick.text)), 'pas la tuile comptant');
  });

  it('buildOrderPayload Baby Boxe 4× PayPlug — quart + IBAN', () => {
    const payload = buildOrderPayload(
      { payment_plan: '4x', billing_plan: 'rib', payment_method: 'payplug', ...sample() },
      {
        id: 'baby-boxe',
        name: 'BABY BOXE',
        supports_installment_choice: true,
        requires_iban: false,
        requires_payment: true,
        price_cents: 25000,
        subsection: 'enfants',
      }
    );
    assert.equal(payload.requires_iban, true);
    assert.equal(payload.paiement_comptant, false);
    assert.equal(payload.payment.amount, 62.5);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);
  });

  it('buildProductConfig Baby Boxe — tuile BABY BOXE 250€ 4X SANS FRAIS', () => {
    const cfg = buildProductConfig(
      {
        product_id: 'baby-boxe',
        product_name: 'BABY BOXE',
        payment: { payment_plan: '4x', billing_plan: 'rib', amount: 62.5, status: 'paid' },
        payment_plan: '4x',
        billing_plan: 'rib',
      },
      { id: 93, title: 'BABY BOXE', type: 'abo', categoryId: 'abo', price: 250 }
    );
    assert.equal(cfg.paiement_comptant, false);
    assert.equal(cfg.requires_iban, true);
    assert.match(cfg.deciplus_product_name, /BABY BOXE 250.*4X SANS FRAIS/i);
  });

  it('catalogue Deciplus — tuile ENFANTS 295€ 4x SANS FRAIS', () => {
    const grid = [
      'BOXE EDUCATIVE 295,00€',
      'ENFANTS 295€ 4x SANS FRAIS 295,00€',
      '259€ EN 4X PRELEVEMENT 259,00€',
    ];
    const pick = pickBestCatalogTile(grid, {
      payplug_4x_prelevement: true,
      deciplus_product_name: 'ENFANTS 295€ 4x SANS FRAIS',
      amount: 295,
      paiement_comptant: false,
    });
    assert.match(String(pick.text), /ENFANTS 295.*4x/i);
    assert.ok(!/BOXE EDUCATIVE 295,00/i.test(String(pick.text)), 'pas la tuile comptant');
  });

  it('catalogue Deciplus — tuile 259€ EN 4X PRELEVEMENT', () => {
    const grid = [
      'OFFRE PROMO 12MOIS 259,00€',
      '259€ EN 4X PRELEVEMENT 259,00€',
      'OFFRE PROMO 12MOIS 1 ACTIF, 3 EN ATTENTE 64,75€',
    ];
    const pick = pickBestCatalogTile(grid, {
      payplug_4x_prelevement: true,
      deciplus_product_name: PAYPLUG_4X_DECIPLUS_LABEL,
      amount: 259,
      paiement_comptant: false,
    });
    assert.match(String(pick.text), /4X PRELEVEMENT/i);
  });

  it('buildOrderPayload Boxe éducative 4× PayPlug — quart + IBAN', () => {
    const payload = buildOrderPayload(
      { payment_plan: '4x', billing_plan: 'rib', payment_method: 'payplug', ...sample() },
      {
        id: 'boxe-educative',
        name: 'BOXE EDUCATIVE',
        supports_installment_choice: true,
        requires_iban: false,
        requires_payment: true,
        price_cents: 29500,
        subsection: 'enfants',
      }
    );
    assert.equal(payload.requires_iban, true);
    assert.equal(payload.paiement_comptant, false);
    assert.equal(payload.payment.amount, 73.75);
    assert.deepEqual(validateOrder(normalizeOrder(payload)), []);
  });

  it('buildProductConfig Boxe éducative — tuile ENFANTS 295€ 4x', () => {
    const cfg = buildProductConfig(
      {
        product_id: 'boxe-educative',
        product_name: 'BOXE EDUCATIVE',
        payment: { payment_plan: '4x', billing_plan: 'rib', amount: 73.75, status: 'paid' },
        payment_plan: '4x',
        billing_plan: 'rib',
      },
      { id: 45, title: 'BOXE EDUCATIVE', type: 'abo', categoryId: 'abo', price: 295 }
    );
    assert.equal(cfg.paiement_comptant, false);
    assert.equal(cfg.requires_iban, true);
    assert.match(cfg.deciplus_product_name, /ENFANTS 295.*4x SANS FRAIS/i);
  });

  it('détecte 4× PayPlug même sans billing_plan rib (quart payé)', () => {
    assert.equal(
      isPayplug4xPrelevementOrder({
        payment: { payment_plan: '4x', method: 'payplug', amount: 64.75, status: 'paid' },
        product_snapshot: { price_cents: 25900 },
      }),
      true
    );
    assert.equal(
      isPayplug4xPrelevementOrder({
        payment: {
          payment_plan: 'once',
          method: 'payplug',
          amount: 64.75,
          metadata: { payplug_4x_prelevement: '1' },
        },
      }),
      true
    );
  });

  it('buildProductConfig — quart PayPlug sans billing_plan rib', () => {
    const cfg = buildProductConfig(
      {
        product_name: 'OFFRE PROMO 12 MOIS',
        payment: { payment_plan: '4x', method: 'payplug', amount: 64.75, status: 'paid' },
        product_snapshot: { price_cents: 25900 },
      },
      { id: 100, title: 'OFFRE PROMO 12 MOIS', type: 'abo', categoryId: 'abo', price: 259 }
    );
    assert.equal(cfg.paiement_comptant, false);
    assert.equal(cfg.payplug_4x_prelevement, true);
    assert.match(cfg.deciplus_product_name, /4X PRELEVEMENT/i);
  });

  it('buildProductConfig — vente abo + IBAN 259 €, pas comptant', () => {
    const cfg = buildProductConfig(
      {
        product_name: 'OFFRE PROMO 12 MOIS',
        payment: { payment_plan: '4x', billing_plan: 'rib', amount: 64.75, status: 'paid' },
        payment_plan: '4x',
        billing_plan: 'rib',
      },
      { id: 100, title: 'OFFRE PROMO 12 MOIS', type: 'abo', categoryId: 'abo', price: 259 }
    );
    assert.equal(cfg.paiement_comptant, false);
    assert.equal(cfg.requires_iban, true);
    assert.equal(cfg.payplug_4x_prelevement, true);
    assert.match(cfg.deciplus_product_name, /4X PRELEVEMENT/i);
  });

  it('note info_compta PayPlug 4× prélèvement', () => {
    const { buildPaymentChannelInfoComptaNote } = require('../lib/info-compta-note');
    const note = buildPaymentChannelInfoComptaNote({
      payment: { payment_plan: '4x', billing_plan: 'rib', method: 'payplug' },
    });
    assert.equal(note, '4× sans frais CB');
  });

  it('pas de note info_compta 4× comptant pour le prélèvement', () => {
    const note = buildFourXInfoComptaNote(
      { payment: { payment_plan: '4x', billing_plan: 'rib', amount: 64.75 } },
      { label: 'OFFRE PROMO 12 MOIS' }
    );
    assert.equal(note, '');
  });
});

function sample() {
  return {
    order_id: 'BC-TEST-PP4X',
    first_name: 'Test',
    last_name: 'PayPlug',
    email: 'pp4x@example.com',
    phone: '0612345678',
    birthdate: '1990-01-15',
    gender: 'M',
    gym: 'minimes',
    address: '1 rue Test',
    postal_code: '31000',
    city: 'Toulouse',
  };
}
