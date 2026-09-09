'use strict';

/**
 * SMS transactionnels via Twilio (même compte que le bot téléphonique).
 */

const twilio = require('twilio');
const { toE164, toGsmSafe } = require('./whatsapp-bot');

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

  if (process.env.BOXPLUS_SMS_DRY_RUN === '1') {
    return { ok: true, sid: 'dry-run', dry: true, to, source };
  }

  if (!isConfigured()) {
    return { ok: false, error: 'twilio_not_configured' };
  }

  try {
    const msg = await getClient().messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body,
    });
    return { ok: true, sid: msg.sid, to, via: 'twilio', source };
  } catch (err) {
    return { ok: false, error: err.message || 'twilio_error', to, source };
  }
}

module.exports = { sendTransactionalSms, isConfigured };
