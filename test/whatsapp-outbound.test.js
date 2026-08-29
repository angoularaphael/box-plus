'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BATCH_SIZE,
  isPromoWhatsAppPaused,
  isAllWhatsAppPaused,
  promoPauseReason,
} = require('../storefront/lib/whatsapp-outbound');

test('file WhatsApp boutique : 10 messages par page', () => {
  assert.equal(BATCH_SIZE, 10);
});

test('promo coupée tant que le compte est restreint', () => {
  const env = { WHATSAPP_RESTRICTED_UNTIL: '2026-08-30T08:00:00+02:00' };
  const during = Date.parse('2026-08-29T18:00:00+02:00');
  const after = Date.parse('2026-08-30T09:00:00+02:00');
  assert.equal(isPromoWhatsAppPaused(env, during), true);
  assert.equal(promoPauseReason(env, during), 'restricted');
  assert.equal(isPromoWhatsAppPaused(env, after), false);
});

test('WHATSAPP_PROMO_PAUSED=0 force la reprise même pendant la restriction', () => {
  const env = {
    WHATSAPP_RESTRICTED_UNTIL: '2026-08-30T08:00:00+02:00',
    WHATSAPP_PROMO_PAUSED: '0',
  };
  assert.equal(isPromoWhatsAppPaused(env, Date.parse('2026-08-29T18:00:00+02:00')), false);
});

test('coupe totale si WA_OUTBOUND_PAUSED', () => {
  const env = { WHATSAPP_OUTBOUND_PAUSED: '1' };
  assert.equal(isAllWhatsAppPaused(env), true);
  assert.equal(isPromoWhatsAppPaused(env), true);
});

test('en test, pas de restriction implicite', () => {
  assert.equal(isPromoWhatsAppPaused({ NODE_ENV: 'test' }, Date.now()), false);
});
