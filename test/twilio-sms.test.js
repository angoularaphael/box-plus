'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendTransactionalSms, isConfigured } = require('../storefront/lib/twilio-sms');

test('Twilio SMS est coupé même si les variables d’environnement existent', async () => {
  const prevSid = process.env.TWILIO_ACCOUNT_SID;
  const prevToken = process.env.TWILIO_AUTH_TOKEN;
  const prevPhone = process.env.TWILIO_PHONE_NUMBER;
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  process.env.TWILIO_PHONE_NUMBER = '+33900000000';
  try {
    assert.equal(isConfigured(), false);
    const out = await sendTransactionalSms('+33612345678', 'hello', { source: 'test' });
    assert.equal(out.ok, false);
    assert.equal(out.skipped, true);
    assert.equal(out.reason, 'sms_disabled');
  } finally {
    if (prevSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = prevSid;
    if (prevToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prevToken;
    if (prevPhone === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = prevPhone;
  }
});
