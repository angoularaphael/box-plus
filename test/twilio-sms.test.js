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

test('dry-run n’appelle pas Twilio', async () => {
  const prev = process.env.BOXPLUS_SMS_DRY_RUN;
  process.env.BOXPLUS_SMS_DRY_RUN = '1';
  try {
    const out = await sendTransactionalSms('+33612345678', 'hello', { source: 'materiel-coach' });
    assert.equal(out.ok, true);
    assert.equal(out.dry, true);
    assert.equal(out.source, 'materiel-coach');
  } finally {
    if (prev === undefined) delete process.env.BOXPLUS_SMS_DRY_RUN;
    else process.env.BOXPLUS_SMS_DRY_RUN = prev;
  }
});
