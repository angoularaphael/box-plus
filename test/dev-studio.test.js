'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isInternalUnlockPhrase } = require('../storefront/lib/counselor-ai');
const { resolveDisplay, DEFAULTS } = require('../storefront/lib/payment-display');
const { runPaymentContext, paymentVar } = require('../storefront/lib/test-env');
const { credentialsForAccount, paypalMode } = require('../storefront/lib/paypal');

test('phrase interne : mode développement (accents / variantes)', () => {
  assert.equal(isInternalUnlockPhrase('mode developpement'), true);
  assert.equal(isInternalUnlockPhrase('Mode Développement'), true);
  assert.equal(isInternalUnlockPhrase('mode developpeur'), true);
  assert.equal(isInternalUnlockPhrase('mode dev'), true);
  assert.equal(isInternalUnlockPhrase('c’est quoi le mode développement'), false);
  assert.equal(isInternalUnlockPhrase('bonjour'), false);
});

test('preview affiche carte + paypal même à Portet', () => {
  const vis = resolveDisplay({
    stored: { payplug: false, paypal: true },
    preview: true,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
  });
  assert.equal(vis.preview, true);
  assert.equal(vis.show_payplug, true);
  assert.equal(vis.show_paypal, true);
  assert.equal(vis.portetPaypalOnly, false);
});

test('prod : cases respectées, Portet reste PayPal-only si PayPal est coché', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: true },
    preview: false,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
  });
  assert.equal(vis.show_payplug, false);
  assert.equal(vis.show_paypal, true);
  assert.equal(vis.portetPaypalOnly, true);
});

test('prod : PayPal décoché masque PayPal ailleurs', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: false },
    preview: false,
    gym: 'minimes',
    payplugReady: true,
    paypalReady: true,
  });
  assert.equal(vis.show_payplug, true);
  assert.equal(vis.show_paypal, false);
});

test('defaults : les deux moyens visibles', () => {
  assert.equal(DEFAULTS.payplug, true);
  assert.equal(DEFAULTS.paypal, true);
});

test('mode studio lit env.test (sandbox), pas les clés Live', () => {
  runPaymentContext({ test: true }, () => {
    assert.equal(paypalMode(), 'sandbox');
    assert.equal(paymentVar('PAYPAL_MODE'), 'sandbox');
    const minimes = credentialsForAccount('minimes');
    const portet = credentialsForAccount('portet');
    assert.ok(minimes.clientId.startsWith('A'), 'client sandbox Minimes');
    assert.ok(portet.clientId.startsWith('A'), 'client sandbox Portet');
    assert.notEqual(minimes.clientId, portet.clientId);
  });
});

test('hors studio : paymentVar laisse process.env', () => {
  const prev = process.env.PAYPAL_MODE;
  process.env.PAYPAL_MODE = 'live';
  try {
    assert.equal(paymentVar('PAYPAL_MODE'), 'live');
    assert.equal(paypalMode(), 'live');
  } finally {
    if (prev == null) delete process.env.PAYPAL_MODE;
    else process.env.PAYPAL_MODE = prev;
  }
});
