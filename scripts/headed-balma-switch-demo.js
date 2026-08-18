#!/usr/bin/env node
/**
 * Demo headed : job balma_switch (save abo → résil → impayés → migrate → restore)
 * puis vente 29 € source=balma_retour (badge comptant).
 *
 *   node scripts/headed-balma-switch-demo.js
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '90';
process.env.BOT_DELAY_SCALE = process.env.BOT_DELAY_SCALE || '0.8';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { processJob, processSaleJob } = require('../bot/index');
const { openMemberCheck } = require('../bot/wallet');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { shouldGiftBadgeComptant } = require('../lib/balma');
const { VALID_TEST_IBAN } = require('../lib/test-fixtures');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 15000);
const OUT = path.join(__dirname, '..', 'data', `balma-switch-demo-${Date.now()}.json`);

function customer(stamp) {
  return {
    first_name: 'TestBalma',
    last_name: `Switch${String(stamp).slice(-5)}`,
    email: `testbalma.${stamp}@boxplus-test.local`,
    phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate: '1991-08-10',
    gender: 'M',
    address: '12 rue de Fenouillet',
    postal_code: '31200',
    city: 'Toulouse',
    country: 'FR',
  };
}

async function main() {
  const recap = { steps: [], at: new Date().toISOString() };
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const stamp = Date.now();
  const c = customer(stamp);
  console.log('\n=== Demo headed Balma switch ===');
  console.log('Chromium s’ouvre au premier plan. Tu vois save abo → résil → impayés → Minimes → restore.\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: Number(process.env.DECIPLUS_SLOW_MO || 90),
  });
  const page = await login(browser);
  recap.steps.push('login');

  const switchOrder = normalizeOrder({
    order_id: `DEMO-BALMA-SWITCH-${stamp}`,
    action: 'balma_switch',
    gym: 'minimes',
    customer: c,
    source: 'balma_retour',
  });
  const switchErrors = validateOrder(switchOrder);
  recap.switch_validation = switchErrors;
  console.log('1/2 — balma_switch', switchOrder.order_id);
  try {
    recap.switch_result = await processJob(page, switchOrder);
  } catch (err) {
    recap.switch_result = { error: err.message };
    console.warn('balma_switch:', err.message);
  }

  await openMemberCheck(page, recap.switch_result?.deciplus_member_id || '').catch(() => {});
  console.log(`Pause ${PAUSE_MS / 1000}s — fiche ouverte`);
  await page.waitForTimeout(PAUSE_MS);

  const saleOrder = normalizeOrder({
    order_id: `DEMO-BALMA-29-${stamp}`,
    product_id: 'offre-duo',
    product_name: 'OFFRE A 29€',
    deciplus_product_search: 'OFFRE A 29',
    gym: 'minimes',
    customer: c,
    payment: {
      status: 'paid',
      amount: 29,
      method: 'card',
      iban: VALID_TEST_IBAN,
      billing_plan: 'rib',
      badge_timing: 'immediate',
      badge_method: 'comptant',
    },
    source: 'balma_retour',
    badge_timing: 'immediate',
    badge_method: 'comptant',
  });
  recap.gift_badge = shouldGiftBadgeComptant(saleOrder, { id: 'offre-duo' });
  console.log('2/2 — vente 29 source=balma_retour — badge comptant =', recap.gift_badge);
  try {
    recap.sale_result = await processSaleJob(page, saleOrder, {});
  } catch (err) {
    recap.sale_result = { error: err.message };
    console.warn('vente 29:', err.message);
  }

  recap.steps.push('done');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
  console.log('\nRecap', OUT);
  await page.waitForTimeout(4000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
