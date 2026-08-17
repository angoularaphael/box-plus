'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isSeanceOfferteOrder,
  buildSeanceOfferteInfoComptaNote,
  applySeanceOfferteCustomerDefaults,
} = require('../lib/info-compta-note');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { isTrialOrder, buildProductConfig } = require('../lib/catalog-sale');

describe('séance offerte — info_compta + défauts ami', () => {
  it('écrit SEANCE D ESSAI GRATUITE WEB', () => {
    const order = normalizeOrder({
      order_id: 'SO-1',
      product_id: 'seance-essai-offerte',
      product_name: 'SEANCE D ESSAI GRATUITE WEB',
      source: 'seance-offerte-web',
      gym: 'minimes',
      customer: { first_name: 'Camille', last_name: 'Durand', email: 'c@example.com', phone: '0612345678' },
      payment: { amount: 0, status: 'paid' },
    });
    assert.equal(isSeanceOfferteOrder(order), true);
    assert.equal(buildSeanceOfferteInfoComptaNote(order), 'SEANCE D ESSAI GRATUITE WEB');
  });

  it('applique les défauts ami seulement pour le parrainé', () => {
    const friend = applySeanceOfferteCustomerDefaults(
      { first_name: 'Alex', last_name: 'Martin' },
      { is_friend_referral: true }
    );
    assert.equal(friend.birthdate, '2000-01-01');
    assert.equal(friend.address, '10 Avenue du Grand Ramier');
    assert.equal(friend.postal_code, '31400');

    const principal = applySeanceOfferteCustomerDefaults(
      { first_name: 'Camille', last_name: 'Durand', birthdate: '1994-05-12' },
      { is_friend_referral: false }
    );
    assert.equal(principal.birthdate, '1994-05-12');
    assert.equal(principal.address, undefined);
  });

  it('ne crée pas de vente (trial amount 0)', () => {
    const order = normalizeOrder({
      order_id: 'SO-2',
      product_name: 'SEANCE D ESSAI GRATUITE WEB',
      sale_type: 'none',
      gym: 'portet',
      customer: { first_name: 'Camille', last_name: 'Durand', email: 'c@example.com', phone: '0612345678' },
      payment: { amount: 0, status: 'paid' },
    });
    assert.equal(isTrialOrder(order), true);
    const cfg = buildProductConfig(order, null);
    assert.equal(cfg.sale_type, 'none');
    assert.equal(cfg.create_sale, false);
    assert.deepEqual(validateOrder(order), []);
  });

  it('valide un job check_sale', () => {
    const order = normalizeOrder({
      order_id: 'SO-2#check-sale',
      action: 'check_sale',
      gym: 'minimes',
      deciplus_member_id: '123',
      customer: { first_name: 'Camille', last_name: 'Durand' },
    });
    assert.equal(order.action, 'check_sale');
    assert.deepEqual(validateOrder(order), []);
  });
});
