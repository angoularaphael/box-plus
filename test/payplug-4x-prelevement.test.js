'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPayplug4xPrelevement,
  isPayplug4xPrelevementOrder,
  requiresIbanForPlan,
  PAYPLUG_4X_DECIPLUS_LABEL,
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

  it('buildProductConfig — vente abo + IBAN, pas comptant', () => {
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
