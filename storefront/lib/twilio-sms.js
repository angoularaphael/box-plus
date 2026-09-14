'use strict';

/**
 * SMS Twilio désactivé — plus aucun envoi (facturation).
 * L’API est conservée pour ne pas casser les scripts existants.
 */

function isConfigured() {
  return false;
}

/**
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, error?: string, source?: string }}
 */
async function sendTransactionalSms(_phone, _message, { source = 'boutique' } = {}) {
  return {
    ok: false,
    skipped: true,
    reason: 'sms_disabled',
    error: 'sms_disabled',
    source,
  };
}

module.exports = { sendTransactionalSms, isConfigured };
