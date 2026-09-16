'use strict';

/**
 * Smoke HTTP — Scalapay réservé aux 4 offres, RIB 4× retiré, config frais/email.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.STORE_DEMO_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.PAYPLUG_SCALAPAY_ENABLED = '1';
process.env.WHATSAPP_BOT_URL = 'http://127.0.0.1:9';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-scalapay-smoke-${Date.now()}`);
process.env.BOXPLUS_MERCH_FILE = path.join(os.tmpdir(), `boxplus-merch-sc-${Date.now()}.json`);
process.env.BOXPLUS_MATERIEL_CATALOG_FILE = path.join(os.tmpdir(), `boxplus-cat-sc-${Date.now()}.json`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';
process.env.BOXPLUS_TEST_ENV_FILE = path.join(__dirname, '..', 'env.test');
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

async function draft(base, productId) {
  const customer = uniqueTestCustomer(`sc-${productId}`);
  const draft = await json(base, '/api/orders/draft', {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      gym: 'minimes',
      gender: 'M',
      address: '1 rue du Test',
      postal_code: '31000',
      city: 'Toulouse',
      ...customer,
    }),
  });
  assert.equal(draft.data.ok, true, JSON.stringify(draft.data));
  return draft.data;
}

test('boutique matériel — Scalapay refusé (carte uniquement)', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { res, data } = await json(base, '/api/cart/checkout', {
    method: 'POST',
    body: JSON.stringify({
      payment_method: 'scalapay',
      lines: [],
      customer: {
        first_name: 'Test',
        last_name: 'Materiel',
        email: 'mat-sc@example.com',
        phone: '0612345678',
        pickup_gym: 'Toulouse St-Cyprien',
      },
    }),
  });
  assert.equal(data.ok, false);
  assert.equal(data.code, 'scalapay_materiel_forbidden');
  assert.ok(res.status >= 400);
});

test('config paiements — Scalapay ON, 4× RIB OFF, textes frais/email', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { data } = await json(base, '/api/payments/config?gym=minimes');
  assert.equal(data.ok, true);
  assert.equal(data.payplug_4x_prelevement, false);
  assert.equal(data.oney_4x, false);
  assert.equal(data.scalapay, true);
  assert.match(String(data.scalapay_fees_hint || ''), /1,?5\s*%|3×/i);
  assert.match(String(data.scalapay_refusal_help || ''), /boxingcenter31@gmail\.com/);
});

test('pay Scalapay — offre 259 éligible (ou erreur API PayPlug, pas ineligible)', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { order_id, access_token } = await draft(base, 'offre-saison');
  const { res, data } = await json(base, `/api/orders/${order_id}/pay`, {
    method: 'POST',
    body: JSON.stringify({
      token: access_token,
      pay_method: 'scalapay',
      payment_plan: 'scalapay',
      gender: 'M',
      address: '1 rue du Test',
      postal_code: '31000',
      city: 'Toulouse',
    }),
  });
  if (data.ok) {
    assert.equal(data.mode, 'payplug_scalapay');
    assert.ok(data.url);
  } else {
    assert.notEqual(data.code, 'scalapay_offer_ineligible');
    assert.notEqual(data.error, 'forbidden');
    assert.ok(
      ['scalapay_create_failed', 'scalapay_unavailable', 'payplug_not_configured'].includes(data.code) ||
        /scalapay|payplug/i.test(String(data.error || '')),
      JSON.stringify(data)
    );
  }
});

test('pay Scalapay — Portet refusé', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const customer = uniqueTestCustomer('sc-portet');
  const draft = await json(base, '/api/orders/draft', {
    method: 'POST',
    body: JSON.stringify({
      product_id: 'offre-saison',
      gym: 'portet',
      gender: 'M',
      address: '1 rue du Test',
      postal_code: '31120',
      city: 'Portet-sur-Garonne',
      ...customer,
      gym: 'portet',
    }),
  });
  assert.equal(draft.data.ok, true, JSON.stringify(draft.data));
  const { order_id, access_token } = draft.data;
  const { data } = await json(base, `/api/orders/${order_id}/pay`, {
    method: 'POST',
    body: JSON.stringify({
      token: access_token,
      pay_method: 'scalapay',
      payment_plan: 'scalapay',
      gym: 'portet',
      gender: 'M',
      address: '1 rue du Test',
      postal_code: '31120',
      city: 'Portet-sur-Garonne',
    }),
  });
  assert.equal(data.ok, false);
  assert.equal(data.code, 'scalapay_gym_ineligible');
});

test('pay Scalapay — offre non éligible refusée', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { order_id, access_token } = await draft(base, 'comptant-3-mois');
  const { data } = await json(base, `/api/orders/${order_id}/pay`, {
    method: 'POST',
    body: JSON.stringify({
      token: access_token,
      pay_method: 'scalapay',
      payment_plan: 'scalapay',
      gender: 'M',
      address: '1 rue du Test',
      postal_code: '31000',
      city: 'Toulouse',
    }),
  });
  assert.equal(data.ok, false);
  assert.equal(data.code, 'scalapay_offer_ineligible');
});

test('pay 4× RIB — rejeté', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { order_id, access_token } = await draft(base, 'offre-saison');
  const { data } = await json(base, `/api/orders/${order_id}/pay`, {
    method: 'POST',
    body: JSON.stringify({
      token: access_token,
      pay_method: 'payplug',
      payment_plan: '4x',
      billing_plan: 'rib',
    }),
  });
  assert.equal(data.ok, false);
  assert.match(String(data.error || ''), /RIB|Scalapay|retir|plusieurs fois/i);
});
