'use strict';

/**
 * Tunnel upsell Blade : après paiement abo/essai, passer ou 2e paiement.
 * STORE_DEMO_ENABLED + PSP vides = paiement démo, sans WhatsApp Remus.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.STORE_DEMO_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.WHATSAPP_BOT_URL = 'http://127.0.0.1:9';
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
process.env.STRIPE_SECRET_KEY = '';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-upsell-${Date.now()}`);
process.env.BOXPLUS_MERCH_FILE = path.join(os.tmpdir(), `boxplus-merch-${Date.now()}.json`);
process.env.BOXPLUS_MATERIEL_CATALOG_FILE = path.join(os.tmpdir(), `boxplus-catalog-${Date.now()}.json`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';
const emptyTestEnv = path.join(os.tmpdir(), `boxplus-upsell-env-${Date.now()}`);
fs.writeFileSync(emptyTestEnv, '');
process.env.BOXPLUS_TEST_ENV_FILE = emptyTestEnv;
require('../storefront/lib/test-env').resetTestFileCache();

const { createApp } = require('../storefront/server');
const { uniqueTestCustomer } = require('../lib/test-fixtures');
const { markPaymentPaid } = require('../storefront/lib/order-lifecycle');

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

async function launchChromium(chromium) {
  for (const opts of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch {
      /* next */
    }
  }
  return null;
}

async function paidAdultOrder(base, productId = 'seance-essai') {
  const c = uniqueTestCustomer(`upsell-${productId}`);
  const draft = await json(base, '/api/orders/draft', {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      gym: 'minimes',
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      birthdate: c.birthdate,
    }),
  });
  assert.equal(draft.data.ok, true, JSON.stringify(draft.data));
  const { order_id, access_token } = draft.data;
  await markPaymentPaid(order_id, { method: 'demo', status: 'paid', payment_plan: 'once' });
  const got = await json(base, `/api/orders/${order_id}?token=${access_token}`);
  return { order_id, access_token, order: got.data.order };
}

test('upsell Blade après essai 10 € — afficher, passer, puis 2e paiement démo', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const first = await paidAdultOrder(base, 'seance-essai');
  assert.equal(first.order.payment.status, 'paid');
  assert.equal(first.order.upsell.show, true, 'l’upsell doit apparaître après paiement essai');
  assert.equal(first.order.upsell.product.price_cents, 1790);

  const skipped = await json(base, `/api/orders/${first.order_id}/upsell/skip`, {
    method: 'POST',
    body: JSON.stringify({ token: first.access_token }),
  });
  assert.equal(skipped.data.ok, true, JSON.stringify(skipped.data));
  assert.equal(skipped.data.upsell.show, false);

  const afterSkip = await json(base, `/api/orders/${first.order_id}?token=${first.access_token}`);
  assert.equal(afterSkip.data.order.addons.blade.status, 'skipped');
  assert.equal(afterSkip.data.order.upsell.show, false);

  const second = await paidAdultOrder(base, 'seance-essai');
  assert.equal(second.order.upsell.show, true);
  const buy = await json(base, `/api/orders/${second.order_id}/upsell/checkout`, {
    method: 'POST',
    body: JSON.stringify({ token: second.access_token, pay_method: 'card' }),
  });
  assert.equal(buy.data.ok, true, JSON.stringify(buy.data));
  assert.equal(buy.data.mode, 'demo');
  assert.equal(buy.data.upsell.show, false);
  const afterBuy = await json(base, `/api/orders/${second.order_id}?token=${second.access_token}`);
  assert.equal(afterBuy.data.order.addons.blade.status, 'paid');
  assert.equal(afterBuy.data.order.addons.blade.price_cents, 1790);

  const third = await paidAdultOrder(base, 'seance-essai');
  const buyPaypal = await json(base, `/api/orders/${third.order_id}/upsell/checkout`, {
    method: 'POST',
    body: JSON.stringify({ token: third.access_token, pay_method: 'paypal' }),
  });
  assert.equal(buyPaypal.data.ok, true, JSON.stringify(buyPaypal.data));
  assert.equal(buyPaypal.data.mode, 'demo');
  const afterPaypal = await json(base, `/api/orders/${third.order_id}?token=${third.access_token}`);
  assert.equal(afterPaypal.data.order.addons.blade.status, 'paid');
});

test('upsell Blade après abo comptant, pas après baby boxe', async (t) => {
  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const adult = await paidAdultOrder(base, 'comptant-3-mois');
  assert.equal(adult.order.product_snapshot.tab, 'abonnements');
  assert.equal(adult.order.upsell.show, true);

  const kid = await paidAdultOrder(base, 'baby-boxe');
  assert.equal(kid.order.upsell.show, false, 'pas d’upsell sur les cours enfants');
});

test('tunnel inscription : écran Blade, Passer, puis dossier', async (t) => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    t.skip('playwright non installé');
    return;
  }

  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const paid = await paidAdultOrder(base, 'seance-essai');
  const url = `${base}/inscription?order=${encodeURIComponent(paid.order_id)}&token=${encodeURIComponent(paid.access_token)}&bc_token=${encodeURIComponent(paid.access_token)}&step=6`;

  const browser = await launchChromium(chromium);
  if (!browser) {
    t.skip('navigateur Chromium/Chrome indisponible');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  await page.waitForSelector('#bladeSkip', { timeout: 15000 });
  const heading = await page.locator('h1').innerText();
  assert.match(heading, /gants blade/i);
  assert.ok(await page.locator('#bladePayCard').isVisible());
  assert.ok(await page.locator('#bladePayPaypal').isVisible());
  assert.ok(await page.locator('#bladeColor').isVisible());
  assert.ok(await page.locator('#bladeSize').isVisible());
  assert.match(await page.locator('#bladePayCard').innerText(), /17,90/);

  await page.click('#bladeSkip');
  await page.waitForSelector('#fullForm', { timeout: 15000 });
  assert.match(await page.locator('h1').innerText(), /dossier/i);
});

test('tunnel inscription : payer par carte (démo) puis dossier', async (t) => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    t.skip('playwright non installé');
    return;
  }

  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const paid = await paidAdultOrder(base, 'comptant-3-mois');
  const url = `${base}/inscription?order=${encodeURIComponent(paid.order_id)}&token=${encodeURIComponent(paid.access_token)}&bc_token=${encodeURIComponent(paid.access_token)}&step=6`;

  const browser = await launchChromium(chromium);
  if (!browser) {
    t.skip('navigateur Chromium/Chrome indisponible');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#bladePayCard', { timeout: 15000 });
  await page.click('#bladePayCard');
  await page.waitForSelector('#fullForm', { timeout: 15000 });
  assert.match(await page.locator('h1').innerText(), /dossier/i);
});

