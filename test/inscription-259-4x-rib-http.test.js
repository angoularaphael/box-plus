'use strict';

/**
 * Tunnel inscription navigateur — offre 259 € en 4× PayPlug prélèvement (25 % CB + RIB).
 * STORE_DEMO_ENABLED + clé PayPlug test (overlay) pour l’UI ; paiement simulé côté API.
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
process.env.PAYPLUG_ONEY_4X_ENABLED = '0';
process.env.WHATSAPP_BOT_URL = 'http://127.0.0.1:9';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-rib-browser-${Date.now()}`);
process.env.BOXPLUS_MERCH_FILE = path.join(os.tmpdir(), `boxplus-merch-rib-${Date.now()}.json`);
process.env.BOXPLUS_MATERIEL_CATALOG_FILE = path.join(os.tmpdir(), `boxplus-catalog-rib-${Date.now()}.json`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';

process.env.BOXPLUS_TEST_ENV_FILE = path.join(__dirname, '..', 'env.test');
require('../storefront/lib/test-env').resetTestFileCache();

const { createApp } = require('../storefront/server');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');
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
  const headed = String(process.env.INSCRIPTION_BROWSER_HEADED || '').toLowerCase() === '1';
  for (const opts of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      return await chromium.launch({
        headless: !headed,
        slowMo: headed ? Number(process.env.INSCRIPTION_SLOW_MO || 80) : 0,
        ...opts,
      });
    } catch {
      /* next */
    }
  }
  return null;
}

async function draft259(base) {
  const customer = uniqueTestCustomer('browser-259');
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
  assert.equal(draft.data.ok, true, JSON.stringify(draft.data));
  return { ...draft.data, customer };
}

function inscriptionUrl(base, orderId, token, step) {
  const tok = encodeURIComponent(token);
  return `${base}/inscription?order=${encodeURIComponent(orderId)}&token=${tok}&bc_token=${tok}&step=${step}`;
}

test('tunnel inscription navigateur — 259 € 4× PayPlug affiche le RIB puis le dossier', async (t) => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    t.skip('playwright non installé');
    return;
  }

  const { server, base } = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const payCfg = await json(base, '/api/payments/config?gym=minimes');
  assert.equal(payCfg.data.payplug_4x_prelevement, true);

  const { order_id, access_token } = await draft259(base);
  const payUrl = inscriptionUrl(base, order_id, access_token, 4);

  const browser = await launchChromium(chromium);
  if (!browser) {
    t.skip('navigateur Chromium/Chrome indisponible');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();

  await page.goto(payUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('input[name="payment_plan"][value="4x"]', { timeout: 15000 });
  await page.check('input[name="payment_plan"][value="4x"]');
  await page.waitForSelector('input[name="pay_method_4x"]', { timeout: 10000 });
  const fourXMethods = await page.locator('input[name="pay_method_4x"]').evaluateAll((els) =>
    els.filter((el) => el.offsetParent !== null).map((el) => el.value)
  );
  assert.ok(fourXMethods.includes('payplug'), `PayPlug 4× manquant: ${fourXMethods.join(',')}`);
  assert.ok(fourXMethods.includes('paypal'), `PayPal 4× manquant: ${fourXMethods.join(',')}`);

  await page.check('input[name="pay_method_4x"][value="payplug"]');
  let payBtnText = await page.locator('#payBtn').innerText();
  assert.match(payBtnText, /64,75.*aujourd/i, 'bouton CB 1ʳᵉ échéance');
  assert.match(payBtnText, /RIB/i, 'bouton mentionne le RIB');
  const schedulePayplug = await page.locator('#fourXSchedule').innerText();
  assert.match(schedulePayplug, /Aujourd.hui.*64,75.*CB/i, 'calendrier CB aujourd’hui');
  assert.match(schedulePayplug, /RIB/i, 'calendrier mentionne le RIB');
  assert.match(schedulePayplug, /Prélèvement sur votre RIB/i, 'échéances RIB datées');

  await page.check('input[name="pay_method_4x"][value="paypal"]');
  payBtnText = await page.locator('#payBtn').innerText();
  assert.match(payBtnText, /259|PayPal.*4×/i, 'bouton PayPal montant total 4×');
  const schedulePaypal = await page.locator('#fourXSchedule').innerText();
  assert.match(schedulePaypal, /Pay Later|éligible/i, 'calendrier PayPal = 4× sans frais');

  await markPaymentPaid(order_id, {
    method: 'payplug',
    payment_plan: '4x',
    billing_plan: 'rib',
    amount: 64.75,
  });

  await page.goto(inscriptionUrl(base, order_id, access_token, 5), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForSelector('#ibanForm', { timeout: 15000 });
  assert.match(await page.locator('h1').innerText(), /coordonnées bancaires/i);
  assert.ok(!(await page.locator('#bladeSkip').isVisible().catch(() => false)), 'pas d’upsell Blade avant le RIB');

  await page.fill('#iban', VALID_TEST_IBAN);
  await page.click('#ibanForm button[type="submit"]');
  const bladeSkip = page.locator('#bladeSkip');
  const fullForm = page.locator('#fullForm');
  await Promise.race([
    fullForm.waitFor({ state: 'visible', timeout: 15000 }),
    bladeSkip.waitFor({ state: 'visible', timeout: 15000 }),
  ]);
  if (await bladeSkip.isVisible()) {
    await bladeSkip.click();
    await fullForm.waitFor({ state: 'visible', timeout: 15000 });
  }
  assert.match(await page.locator('h1').innerText(), /dossier/i);
});
