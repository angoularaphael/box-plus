'use strict';

/**
 * SMS transactionnels via Twilio (même compte que le bot téléphonique).
 * Relances essai / campagnes : ne pas appeler ce module.
 */

const twilio = require('twilio');
const { toWhatsAppPhone } = require('./whatsapp-bot');

function toE164(raw) {
  const digits = toWhatsAppPhone(raw);
  if (!digits) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function toGsmSafe(text) {
  return String(text || '')
    .replace(/€/g, 'euros')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ê/g, 'e')
    .replace(/Ê/g, 'E')
    .replace(/î/g, 'i')
    .replace(/Î/g, 'I')
    .replace(/ô/g, 'o')
    .replace(/Ô/g, 'O')
    .replace(/â/g, 'a')
    .replace(/Â/g, 'A')
    .replace(/\*/g, '')
    .replace(/~/g, '-')
    .replace(/[🚀🔥💥⏳🥊🚨]/g, '')
    .replace(/ +/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

let _client = null;

function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !auth) return null;
  _client = twilio(sid, auth);
  return _client;
}

function isConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
  );
}

/**
 * @returns {{ ok: boolean, sid?: string, error?: string, skipped?: boolean, reason?: string }}
 */
async function sendTransactionalSms(phone, message, { source = 'boutique' } = {}) {
  const to = toE164(phone);
  const body = toGsmSafe(message);
  if (!to) return { ok: false, error: 'invalid_phone' };
  if (!body) return { ok: false, error: 'empty_message' };

  return { ok: false, error: 'sms_disabled', skipped: true, to, source };
}

module.exports = { sendTransactionalSms, isConfigured };
