'use strict';

/**
 * Tunnel inscription navigateur — offre 259 € avec Scalapay + 4× CB puis RIB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.STORE_DEMO_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.PAYPLUG_ONEY_4X_ENABLED = '0';
process.env.PAYPLUG_SCALAPAY_ENABLED = '1';
process.env.WHATSAPP_BOT_URL = 'http://127.0.0.1:9';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-scalapay-browser-${Date.now()}`);
process.env.BOXPLUS_MERCH_FILE = path.join(os.tmpdir(), `boxplus-merch-scalapay-${Date.now()}.json`);
process.env.BOXPLUS_MATERIEL_CATALOG_FILE = path.join(
  os.tmpdir(),
  `boxplus-catalog-scalapay-${Date.now()}.json`
);
process.env.BOXPLUS_ORDERS_REMOTE = '0';

process.env.BOXPLUS_TEST_ENV_FILE = path.join(__dirname, '..', 'env.test');
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

test('tunnel inscription navigateur — 259 € Scalapay et option 4× CB puis RIB', async (t) => {
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
  assert.equal(payCfg.data.payplug_4x_prelevement, Boolean(payCfg.data.payplug));
  assert.equal(payCfg.data.scalapay, true);
  assert.match(String(payCfg.data.scalapay_fees_hint || ''), /1,?5\s*%|3×/i);
  assert.match(String(payCfg.data.scalapay_refusal_help || ''), /boxingcenter31@gmail\.com/i);

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
  await page.waitForSelector('input[name="payment_plan"][value="scalapay"]', { timeout: 15000 });
  if (payCfg.data.payplug_4x_prelevement) {
    await page.waitForSelector('input[name="payment_plan"][value="4x-rib"]', { timeout: 5000 });
  }
  await page.check('input[name="payment_plan"][value="scalapay"]');

  const helpText = await page.locator('#scalapayHelpBox').innerText();
  assert.match(helpText, /1,?5\s*%|sans frais/i, 'frais Scalapay affichés');
  assert.match(helpText, /boxingcenter31@gmail\.com/i, 'email d’aide affiché');

  const addrVisible = await page.locator('#scalapayAddress').isVisible();
  assert.equal(addrVisible, true, 'adresse Scalapay visible');

  const payBtnText = await page.locator('#payBtn').innerText();
  assert.match(payBtnText, /paiement CB|CB/i);

  const pageText = await page.locator('body').innerText();
  assert.match(pageText, /CB en plusieurs fois/i);
  if (payCfg.data.payplug_4x_prelevement) {
    assert.match(pageText, /4× sans frais CB puis RIB|3 prochains paiements sur votre RIB/i);
  }

  await markPaymentPaid(order_id, {
    method: 'payplug',
    payment_plan: 'scalapay',
    amount: 259,
  });

  await page.goto(inscriptionUrl(base, order_id, access_token, 6), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  const bladeSkip = page.locator('#bladeSkip');
  const fullForm = page.locator('#fullForm');
  await Promise.race([
    fullForm.waitFor({ state: 'visible', timeout: 15000 }),
    bladeSkip.waitFor({ state: 'visible', timeout: 15000 }),
  ]);
  if (await bladeSkip.isVisible().catch(() => false)) {
    await bladeSkip.click();
    await fullForm.waitFor({ state: 'visible', timeout: 15000 });
  }
  assert.match(await page.locator('h1').innerText(), /dossier/i);
  assert.ok(!(await page.locator('#ibanForm').isVisible().catch(() => false)), 'pas d’étape RIB après Scalapay');
});
