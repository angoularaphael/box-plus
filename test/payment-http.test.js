'use strict';

/**
 * Smoke HTTP des routes paiement après les correctifs sécurité.
 * Pas d’appel PSP réel : clés vidées, on vérifie les réponses (pas de 500).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.STORE_DEMO_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.PAYPLUG_SECRET_KEY = '';
process.env.PAYPLUG_TEST_SECRET_KEY = '';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.PAYPAL_PORTET_CLIENT_ID = '';
process.env.PAYPAL_PORTET_CLIENT_SECRET = '';
process.env.PAYPAL_TEST_CLIENT_ID = '';
process.env.PAYPAL_TEST_CLIENT_SECRET = '';
process.env.CAWL_MERCHANT_ID = '';
process.env.CAWL_API_KEY_ID = '';
process.env.CAWL_API_SECRET = '';
process.env.CAWL_TEST_MERCHANT_ID = '';
process.env.CAWL_TEST_API_KEY_ID = '';
process.env.CAWL_TEST_API_SECRET = '';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = '';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-pay-http-${Date.now()}`);
process.env.BOXPLUS_MATERIEL_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-mat-http-${Date.now()}`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';
const emptyTestEnv = path.join(os.tmpdir(), `boxplus-empty-test-env-${Date.now()}`);
fs.writeFileSync(emptyTestEnv, '');
process.env.BOXPLUS_TEST_ENV_FILE = emptyTestEnv;
require('../storefront/lib/test-env').resetTestFileCache();

const { createApp } = require('../storefront/server');
const { uniqueTestCustomer } = require('../lib/test-fixtures');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function json(base, url, opts = {}) {
  const res = await fetch(`${base}${url}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

test('smoke HTTP paiement — routes checkout / confirm / facture', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const customer = uniqueTestCustomer('pay-http');

  const config = await json(base, '/api/config');
  assert.equal(config.res.status, 200);
  assert.equal(config.data.demo_checkout_enabled, false);

  const payCfg = await json(base, '/api/payments/config?gym=minimes');
  assert.equal(payCfg.res.status, 200);
  assert.equal(payCfg.data.ok, true);
  assert.equal(payCfg.data.payplug, false);
  assert.equal(payCfg.data.paypal, false);

  const products = await json(base, '/api/products');
  assert.equal(products.res.status, 200);
  assert.ok((products.data.products || products.data).length > 0);

  const demo = await json(base, '/api/checkout/demo', {
    method: 'POST',
    body: JSON.stringify({ product_id: 'seance-essai', ...customer }),
  });
  assert.equal(demo.res.status, 403);
  assert.equal(demo.data.error, 'demo_disabled');

  const cartEmpty = await json(base, '/api/cart/checkout', {
    method: 'POST',
    body: JSON.stringify({ lines: [], customer }),
  });
  assert.equal(cartEmpty.res.status, 400);

  const facture = await json(base, '/api/facture/materiel/MAT-999999-deadbeef');
  assert.ok([403, 404].includes(facture.res.status));

  const draft = await json(base, '/api/orders/draft', {
    method: 'POST',
    body: JSON.stringify({
      product_id: 'seance-essai',
      gym: 'minimes',
      ...customer,
    }),
  });
  assert.equal(draft.res.status, 200, JSON.stringify(draft.data));
  assert.equal(draft.data.ok, true);
  assert.ok(draft.data.order_id);
  assert.ok(draft.data.access_token);

  const { order_id: orderId, access_token: token } = draft.data;

  const noToken = await json(base, `/api/orders/${orderId}`);
  assert.equal(noToken.res.status, 403);

  const withToken = await json(base, `/api/orders/${orderId}?token=${token}`);
  assert.equal(withToken.res.status, 200);
  assert.equal(withToken.data.order.access_token, undefined);
  assert.equal(withToken.data.order.payment?.iban, undefined);

  const confirmPp = await json(base, '/api/checkout/confirm-payplug', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, token, payment_id: 'pay_not_a_real_payment' }),
  });
  assert.notEqual(confirmPp.res.status, 500);
  assert.ok([400, 403, 409, 502, 503].includes(confirmPp.res.status), `payplug confirm ${confirmPp.res.status}`);

  const confirmPaypal = await json(base, '/api/checkout/confirm-paypal', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, token, paypal_order_id: 'PAYPAL-FAKE-ID99' }),
  });
  assert.notEqual(confirmPaypal.res.status, 500);
  assert.ok(
    [400, 403, 409, 502, 503].includes(confirmPaypal.res.status),
    `paypal confirm ${confirmPaypal.res.status}`
  );

  const pay = await json(base, `/api/orders/${orderId}/pay`, {
    method: 'POST',
    body: JSON.stringify({
      token,
      gym: 'minimes',
      billing_plan: 'card',
      payment_plan: 'once',
      pay_method: 'card',
    }),
  });
  assert.notEqual(pay.res.status, 500, JSON.stringify(pay.data));
  assert.ok(
    pay.res.status === 503 || pay.data.ok === true,
    `pay status ${pay.res.status} ${pay.data.error || pay.data.mode}`
  );
  if (pay.res.status === 503) {
    assert.match(String(pay.data.error || ''), /payplug_not_configured|paypal_not_configured/);
  }
});
