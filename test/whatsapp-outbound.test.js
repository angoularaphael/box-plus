'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BATCH_SIZE,
  isPromoWhatsAppPaused,
  isAllWhatsAppPaused,
  isOfferPlacesSmsPaused,
  promoPauseReason,
} = require('../storefront/lib/whatsapp-outbound');

test('file WhatsApp boutique : 10 messages par page', () => {
  assert.equal(BATCH_SIZE, 10);
});

test('plus de pause implicite : le canal est SMS', () => {
  const env = { WHATSAPP_RESTRICTED_UNTIL: '2026-08-30T08:00:00+02:00' };
  const during = Date.parse('2026-08-29T18:00:00+02:00');
  assert.equal(isPromoWhatsAppPaused(env, during), false);
  assert.equal(promoPauseReason(env, during), null);
});

test('WHATSAPP_PROMO_PAUSED=1 coupe encore les envois', () => {
  const env = { WHATSAPP_PROMO_PAUSED: '1' };
  assert.equal(isPromoWhatsAppPaused(env), true);
  assert.equal(promoPauseReason(env), 'promo_paused');
});

test('OFFER_PLACES_SMS_PAUSED coupe les SMS offre places sans bloquer tout le promo', () => {
  assert.equal(isOfferPlacesSmsPaused({ OFFER_PLACES_SMS_PAUSED: '1' }), true);
  assert.equal(isPromoWhatsAppPaused({ OFFER_PLACES_SMS_PAUSED: '1' }), false);
});

test('coupe totale si WA_OUTBOUND_PAUSED ou SMS_OUTBOUND_PAUSED', () => {
  assert.equal(isAllWhatsAppPaused({ WHATSAPP_OUTBOUND_PAUSED: '1' }), true);
  assert.equal(isAllWhatsAppPaused({ SMS_OUTBOUND_PAUSED: '1' }), true);
  assert.equal(isPromoWhatsAppPaused({ WHATSAPP_OUTBOUND_PAUSED: '1' }), true);
});

test('en test, pas de restriction implicite', () => {
  assert.equal(isPromoWhatsAppPaused({ NODE_ENV: 'test' }, Date.now()), false);
});
