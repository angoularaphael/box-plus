'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBookingDetails,
  isCoachingOrder,
  isCoachingPackProduct,
  labelsForBooking,
  applyBookingFieldsToOrder,
  toIsoDate,
  minBookingDate,
} = require('../storefront/lib/coaching-booking');

describe('coaching-booking', () => {
  it('detecte les produits coaching', () => {
    assert.equal(isCoachingPackProduct({ tab: 'coachings' }), true);
    assert.equal(isCoachingPackProduct({ subsection: 'coaching' }), true);
    assert.equal(isCoachingPackProduct({ tab: 'abonnements' }), false);
  });

  it('detecte les commandes coaching pack', () => {
    assert.equal(
      isCoachingOrder({ product_snapshot: { tab: 'coachings', subsection: 'coaching' } }),
      true
    );
    assert.equal(isCoachingOrder({ action: 'coaching_booking' }), true);
    assert.equal(isCoachingOrder({ order_id: 'COACH-123' }), true);
  });

  it('valide salle activité date créneau J+4', () => {
    const min = toIsoDate(minBookingDate());
    const ok = validateBookingDetails({
      gym: 'minimes',
      activity: 'boxing-fitness',
      slot: '10-11',
      date: min,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.gym, 'minimes');

    const bad = validateBookingDetails({
      gym: 'minimes',
      activity: 'boxing-fitness',
      slot: '10-11',
      date: '2000-01-01',
    });
    assert.equal(bad.ok, false);
  });

  it('applique les champs sur la commande', () => {
    const order = { customer_full: {} };
    applyBookingFieldsToOrder(order, {
      gym: 'portet',
      activity: 'mma-sols',
      slot: '14-15',
      date: '2026-12-01',
    });
    assert.equal(order.gym, 'portet');
    assert.equal(order.activity_label, 'MMA / Sols');
    assert.equal(order.slot_label, '14:00 – 15:00');
    assert.equal(order.booking_date, '2026-12-01');
    const labels = labelsForBooking(order);
    assert.match(labels.dateLabel, /décembre 2026/i);
  });
});
