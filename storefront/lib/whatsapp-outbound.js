'use strict';

/** Après un flag spam WhatsApp : plus d’ouvertures de chats promo jusqu’à cette heure (Paris). */
const DEFAULT_RESTRICTED_UNTIL = '2026-08-30T08:00:00+02:00';
const BATCH_SIZE = 10;

function truthyFlag(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function falsyFlag(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

function restrictedUntilMs(env = process.env) {
  if (env.WHATSAPP_RESTRICTED_UNTIL) {
    const t = Date.parse(env.WHATSAPP_RESTRICTED_UNTIL);
    return Number.isFinite(t) ? t : 0;
  }
  if (String(env.NODE_ENV || '').toLowerCase() === 'test') return 0;
  const t = Date.parse(DEFAULT_RESTRICTED_UNTIL);
  return Number.isFinite(t) ? t : 0;
}

function isAllWhatsAppPaused(env = process.env) {
  return truthyFlag(env.WHATSAPP_OUTBOUND_PAUSED) || truthyFlag(env.SMS_OUTBOUND_PAUSED);
}

function isPromoWhatsAppPaused(env = process.env) {
  if (isAllWhatsAppPaused(env)) return true;
  return truthyFlag(env.WHATSAPP_PROMO_PAUSED) || truthyFlag(env.SMS_OUTBOUND_PAUSED);
}

function promoPauseReason(env = process.env, now = Date.now()) {
  if (isAllWhatsAppPaused(env)) return 'outbound_paused';
  if (!isPromoWhatsAppPaused(env, now)) return null;
  if (truthyFlag(env.WHATSAPP_PROMO_PAUSED)) return 'promo_paused';
  return 'restricted';
}

module.exports = {
  DEFAULT_RESTRICTED_UNTIL,
  BATCH_SIZE,
  restrictedUntilMs,
  isAllWhatsAppPaused,
  isPromoWhatsAppPaused,
  promoPauseReason,
};
