'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  paypalAccountForGym,
  resolvePaypalAccount,
  credentialsForAccount,
  isPaypalEnabled,
  publicClientId,
} = require('../storefront/lib/paypal');

test('paypalAccountForGym sépare Portet et Minimes', () => {
  assert.equal(paypalAccountForGym('portet'), 'portet');
  assert.equal(paypalAccountForGym('Portet'), 'portet');
  assert.equal(paypalAccountForGym('minimes'), 'minimes');
  assert.equal(paypalAccountForGym('ramonville'), 'minimes');
  assert.equal(paypalAccountForGym(''), 'minimes');
});

test('resolvePaypalAccount privilégie le compte stocké', () => {
  assert.equal(resolvePaypalAccount({ gym: 'minimes', account: 'portet' }), 'portet');
  assert.equal(resolvePaypalAccount({ gym: 'portet' }), 'portet');
  assert.equal(resolvePaypalAccount({}), 'minimes');
});

test('credentialsForAccount : Portet a ses clés, sinon repli Minimes', () => {
  const prev = {
    id: process.env.PAYPAL_CLIENT_ID,
    secret: process.env.PAYPAL_CLIENT_SECRET,
    portetId: process.env.PAYPAL_PORTET_CLIENT_ID,
    portetSecret: process.env.PAYPAL_PORTET_CLIENT_SECRET,
  };
  process.env.PAYPAL_CLIENT_ID = 'minimes-id';
  process.env.PAYPAL_CLIENT_SECRET = 'minimes-secret';
  delete process.env.PAYPAL_PORTET_CLIENT_ID;
  delete process.env.PAYPAL_PORTET_CLIENT_SECRET;

  try {
    assert.equal(credentialsForAccount('minimes').clientId, 'minimes-id');
    assert.equal(credentialsForAccount('portet').clientId, 'minimes-id');
    assert.equal(isPaypalEnabled('portet'), true);
    assert.equal(publicClientId('minimes'), 'minimes-id');

    process.env.PAYPAL_PORTET_CLIENT_ID = 'portet-id';
    process.env.PAYPAL_PORTET_CLIENT_SECRET = 'portet-secret';
    assert.equal(credentialsForAccount('portet').clientId, 'portet-id');
    assert.equal(credentialsForAccount('minimes').clientId, 'minimes-id');
    assert.equal(publicClientId('portet'), 'portet-id');
    assert.equal(isPaypalEnabled('portet'), true);
    assert.equal(isPaypalEnabled('minimes'), true);
  } finally {
    if (prev.id == null) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = prev.id;
    if (prev.secret == null) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = prev.secret;
    if (prev.portetId == null) delete process.env.PAYPAL_PORTET_CLIENT_ID;
    else process.env.PAYPAL_PORTET_CLIENT_ID = prev.portetId;
    if (prev.portetSecret == null) delete process.env.PAYPAL_PORTET_CLIENT_SECRET;
    else process.env.PAYPAL_PORTET_CLIENT_SECRET = prev.portetSecret;
  }
});
