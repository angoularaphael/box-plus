#!/usr/bin/env node
'use strict';
/**
 * Démo navigateur visible — tunnel inscription 259 €, étape 4× (PayPal + PayPlug).
 * Usage: node scripts/headed-inscription-4x-demo.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const assert = require('assert');

process.env.STORE_DEMO_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.PAYPLUG_ONEY_4X_ENABLED = '0';
process.env.WHATSAPP_BOT_URL = 'http://127.0.0.1:9';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-headed-4x-${Date.now()}`);
process.env.BOXPLUS_MERCH_FILE = path.join(os.tmpdir(), `boxplus-merch-headed-4x-${Date.now()}.json`);
process.env.BOXPLUS_MATERIEL_CATALOG_FILE = path.join(os.tmpdir(), `boxplus-catalog-headed-4x-${Date.now()}.json`);
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

async function launchBrowser(chromium) {
  for (const opts of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      return await chromium.launch({
        headless: false,
        slowMo: Number(process.env.INSCRIPTION_SLOW_MO || 120),
        ...opts,
      });
    } catch {
      /* next */
    }
  }
  return null;
}

async function main() {
  const { chromium } = require('playwright');
  const { server, base } = await listen(createApp());

  const payCfg = await json(base, '/api/payments/config?gym=minimes');
  if (!payCfg.data.payplug_4x_prelevement) {
    throw new Error('payplug_4x_prelevement inactif — vérifiez env.test');
  }

  const customer = uniqueTestCustomer('headed-4x');
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
  if (!draft.data.ok) throw new Error(JSON.stringify(draft.data));

  const { order_id, access_token } = draft.data;
  const tok = encodeURIComponent(access_token);
  const url = `${base}/inscription?order=${encodeURIComponent(order_id)}&token=${tok}&bc_token=${tok}&step=4`;

  console.log('\n=== Inscription 4× — navigateur visible ===');
  console.log('URL locale:', url);
  console.log('Attendu : PayPal 4× sans frais (259 €) · PayPlug 4× : 64,75 € + RIB\n');

  const browser = await launchBrowser(chromium);
  if (!browser) throw new Error('Chrome / Edge / Chromium introuvable');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.check('input[name="payment_plan"][value="4x"]');
    await page.waitForSelector('input[name="pay_method_4x"]', { timeout: 15000 });

    const methods = await page.locator('input[name="pay_method_4x"]').evaluateAll((els) =>
      els.map((el) => ({ value: el.value, visible: el.offsetParent !== null }))
    );
    const values = methods.filter((m) => m.visible).map((m) => m.value);
    console.log('Moyens 4× visibles:', values.join(', ') || '(aucun)');

    if (!values.includes('payplug')) console.warn('⚠ PayPlug 4× non visible');
    if (!values.includes('paypal')) console.warn('⚠ PayPal 4× non visible');
    if (values.includes('payplug') && values.includes('paypal')) {
      console.log('OK — PayPal 4× et PayPlug 4× affichés');
    }

    await page.check('input[name="pay_method_4x"][value="payplug"]');
    const payplugBtn = await page.locator('#payBtn').innerText();
    console.log('Bouton PayPlug 4×:', payplugBtn.trim());
    assert.match(payplugBtn, /64,75|25\s*%/i, 'PayPlug = 25 %');

    await page.check('input[name="pay_method_4x"][value="paypal"]');
    const paypalBtn = await page.locator('#payBtn').innerText();
    console.log('Bouton PayPal 4×:', paypalBtn.trim());
    assert.match(paypalBtn, /259|PayPal.*4×/i, 'PayPal = montant total 4×');

    const waitMs = Number(process.env.INSCRIPTION_HEADED_WAIT_MS || 180000);
    console.log(`\nFenêtre ouverte ${Math.round(waitMs / 1000)} s — testez les deux options puis fermez le navigateur.\n`);
    await page.waitForTimeout(waitMs);
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('Échec démo inscription 4×:', err.message);
  process.exit(1);
});
