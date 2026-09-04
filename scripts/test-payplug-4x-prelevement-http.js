#!/usr/bin/env node
'use strict';
/**
 * Test HTTP local du 4× PayPlug prélèvement (25 % CB + RIB).
 * Usage: node scripts/test-payplug-4x-prelevement-http.js
 */
require('dotenv').config();

const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PAYPLUG_ONEY_4X_ENABLED = '0';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-pp4x-http-${Date.now()}`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';

const { createApp } = require('../storefront/server');
const { markPaymentPaid } = require('../storefront/lib/order-lifecycle');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');

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
    body: opts.body,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function main() {
  const { server, base } = await listen(createApp());
  try {
    const payCfg = await json(base, '/api/payments/config?gym=minimes');
    assert.equal(payCfg.res.status, 200, JSON.stringify(payCfg.data));
    assert.equal(payCfg.data.ok, true);
    assert.equal(payCfg.data.payplug_4x_prelevement, true, 'flag payplug_4x_prelevement');
    assert.equal(payCfg.data.oney_4x, false);
    assert.equal(payCfg.data.oney_4x_message, null);
    console.log('OK /api/payments/config — payplug_4x_prelevement actif');

    const customer = uniqueTestCustomer('pp4x');
    const draft = await json(base, '/api/orders/draft', {
      method: 'POST',
      body: JSON.stringify({
        product_id: 'offre-saison',
        gym: 'minimes',
        gender: 'M',
        address: '1 rue du Test',
        postal_code: '31000',
        city: 'Toulouse',
        ...customer,
      }),
    });
    assert.equal(draft.res.status, 200, JSON.stringify(draft.data));
    const { order_id: orderId, access_token: token } = draft.data;
    assert.ok(orderId && token);
    console.log('OK draft offre-saison', orderId);

    const pay = await json(base, `/api/orders/${orderId}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        token,
        gym: 'minimes',
        payment_plan: '4x',
        billing_plan: 'rib',
        pay_method: 'payplug',
      }),
    });
    assert.notEqual(pay.res.status, 500, JSON.stringify(pay.data));
    assert.notEqual(pay.data.code, 'oney_4x_unavailable', 'ne doit plus bloquer Oney');
    assert.equal(pay.data.ok, true, JSON.stringify(pay.data));
    assert.equal(pay.data.mode, 'payplug_4x_prelevement', JSON.stringify(pay.data));
    assert.ok(String(pay.data.url || '').includes('payplug.com'), 'URL PayPlug manquante');
    console.log('OK pay 4× — mode payplug_4x_prelevement, URL PayPlug reçue');

    const order = await json(base, `/api/orders/${orderId}?token=${encodeURIComponent(token)}`);
    assert.equal(order.res.status, 200);
    assert.equal(order.data.order.payment?.payment_plan, '4x');
    assert.equal(order.data.order.payment?.billing_plan, 'rib');
    assert.equal(order.data.order.requires_iban, true);
    assert.equal(order.data.order.payment?.status, 'pending');
    console.log('OK commande — payment_plan=4x, billing_plan=rib, requires_iban=true');

    // Inscription 259 € : après paiement CB (25 %), l’étape RIB est obligatoire
    await markPaymentPaid(orderId, {
      method: 'payplug',
      payment_plan: '4x',
      billing_plan: 'rib',
      amount: 64.75,
    });
    const afterPay = await json(base, `/api/orders/${orderId}?token=${encodeURIComponent(token)}`);
    assert.equal(afterPay.res.status, 200);
    assert.equal(afterPay.data.order.payment?.status, 'paid');
    assert.equal(afterPay.data.order.step, 5, 'étape 5 RIB après paiement 4×');
    assert.equal(afterPay.data.order.requires_iban, true);
    assert.ok(!afterPay.data.order.payment?.iban, 'IBAN pas encore saisi');
    console.log('OK après paiement — étape 5 RIB requise');

    const ibanRes = await json(base, `/api/orders/${orderId}/iban`, {
      method: 'PATCH',
      body: JSON.stringify({ token, iban: VALID_TEST_IBAN }),
    });
    assert.equal(ibanRes.res.status, 200, JSON.stringify(ibanRes.data));
    assert.equal(ibanRes.data.ok, true);
    assert.equal(ibanRes.data.step, 6, 'passage au dossier après RIB');
    const afterIban = await json(base, `/api/orders/${orderId}?token=${encodeURIComponent(token)}`);
    assert.equal(afterIban.data.order.payment?.has_iban, true);
    assert.match(afterIban.data.order.payment?.iban_masked || '', /0185$/);
    assert.equal(afterIban.data.order.step, 6);
    console.log('OK RIB enregistré — étape 6 dossier');

    console.log('\nTous les tests HTTP 4× PayPlug prélèvement sont OK.');

    // Boxe éducative (enfants 295 €)
    const kid = uniqueTestCustomer('pp4x-edu');
    const kidDraft = await json(base, '/api/orders/draft', {
      method: 'POST',
      body: JSON.stringify({
        product_id: 'boxe-educative',
        gym: 'minimes',
        gender: 'F',
        address: '2 rue Enfant',
        postal_code: '31000',
        city: 'Toulouse',
        ...kid,
        birthdate: '2016-05-10',
      }),
    });
    assert.equal(kidDraft.res.status, 200, JSON.stringify(kidDraft.data));
    const kidPay = await json(base, `/api/orders/${kidDraft.data.order_id}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        token: kidDraft.data.access_token,
        gym: 'minimes',
        payment_plan: '4x',
        billing_plan: 'rib',
        pay_method: 'payplug',
      }),
    });
    assert.equal(kidPay.data.ok, true, JSON.stringify(kidPay.data));
    assert.equal(kidPay.data.mode, 'payplug_4x_prelevement');
    console.log('OK pay 4× Boxe éducative — 73,75 € (25 % de 295 €)');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('ÉCHEC test HTTP 4× PayPlug:', err.message);
  process.exit(1);
});
