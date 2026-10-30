'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const tokenMod = require('../lib/app-checkout-token');
const shop = require('../lib/app-bridge-shop');

describe('app-checkout-token', () => {
  it('signe et verifie le jeton checkout', () => {
    const secret = 'test-secret';
    const exp = 1_900_000_000;
    const sig = tokenMod.signCheckoutToken(secret, 'sess-1', 'prof-1', exp);
    assert.equal(tokenMod.verifyCheckoutToken(secret, 'sess-1', 'prof-1', exp, sig), true);
    assert.equal(tokenMod.verifyCheckoutToken(secret, 'sess-1', 'prof-1', exp, 'deadbeef'), false);
  });
});

describe('app-bridge-shop', () => {
  let fetchCalls;
  let originalFetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), body: opts?.body, headers: opts?.headers || {} });
      return { ok: true, status: 200 };
    };
    process.env.APP_BRIDGE_PUBLIC_URL = 'https://api.example.test';
    process.env.SHOP_BRIDGE_SECRET = 'shop-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.APP_BRIDGE_PUBLIC_URL;
    delete process.env.SHOP_BRIDGE_SECRET;
  });

  it('envoie order.paid signe pour une commande app', async () => {
    const order = {
      order_id: 'BC-1',
      gym: 'minimes',
      app_checkout: { checkout_session_id: 'cs-1', profile_id: 'p-1', club: 'minimes' },
      payment: { amount: 49 },
      product_snapshot: { price_cents: 4900, name: 'Adulte' },
    };
    const result = await shop.notifyOrderPaid(order);
    assert.equal(result.delivered, true);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/internal\/shop-event$/);
    const payload = JSON.parse(fetchCalls[0].body);
    assert.equal(payload.type, 'order.paid');
    assert.equal(payload.checkout_session_id, 'cs-1');
    const ts = fetchCalls[0].headers?.['x-bc-timestamp'];
    assert.ok(ts);
  });

  it('ignore les commandes sans app_checkout', async () => {
    const result = await shop.notifyOrderPaid({ order_id: 'BC-2' });
    assert.equal(result.skipped, true);
    assert.equal(fetchCalls.length, 0);
  });
});
