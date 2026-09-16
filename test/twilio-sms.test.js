'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendTransactionalSms, isConfigured } = require('../storefront/lib/twilio-sms');

test('isConfigured suit TWILIO_*', () => {
  const prevSid = process.env.TWILIO_ACCOUNT_SID;
  const prevToken = process.env.TWILIO_AUTH_TOKEN;
  const prevPhone = process.env.TWILIO_PHONE_NUMBER;
  try {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    assert.equal(isConfigured(), false);
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_PHONE_NUMBER = '+33900000000';
    assert.equal(isConfigured(), true);
  } finally {
    if (prevSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = prevSid;
    if (prevToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prevToken;
    if (prevPhone === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = prevPhone;
  }
});

test('Twilio SMS est coupé — aucun messages.create', async () => {
  const out = await sendTransactionalSms('+33612345678', 'hello', { source: 'materiel-coach' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'sms_disabled');
  assert.equal(out.skipped, true);
});
