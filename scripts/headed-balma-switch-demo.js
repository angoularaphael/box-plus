#!/usr/bin/env node
/**
 * Test headed demandé : créer un client Balma (abo 29 + badge),
 * puis job balma_switch vers Minimes (save abo → résil → impayés → migrate → restore).
 *
 *   node scripts/headed-balma-switch-demo.js
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '80';
process.env.BOT_DELAY_SCALE = process.env.BOT_DELAY_SCALE || '0.8';
process.env.BALMA_AUTOMIGRATE_ON_SALE = '0';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { processJob, processSaleJob } = require('../bot/index');
const { openMemberCheck } = require('../bot/wallet');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { VALID_TEST_IBAN } = require('../lib/test-fixtures');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 12000);
const OUT = path.join(__dirname, '..', 'data', `balma-create-then-switch-${Date.now()}.json`);

function customer(stamp) {
  const tail = String(stamp).slice(-5);
  return {
    first_name: 'TestBalma',
    last_name: `Mig${tail}`,
    email: `testbalma.mig${tail}@boxplus-test.local`,
    phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate: '1991-08-10',
    gender: 'M',
    address: '8 rue Theron de Montauge',
    postal_code: '31130',
    city: 'Balma',
    country: 'FR',
  };
}

async function main() {
  const recap = { steps: [], at: new Date().toISOString() };
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const resumeId = String(process.env.RESUME_MEMBER_ID || '').trim();
  const stamp = Date.now();
  const c = resumeId
    ? {
        first_name: process.env.RESUME_FIRST_NAME || 'TestBalma',
        last_name: process.env.RESUME_LAST_NAME || 'Mig93037',
        email: 'testbalma.mig93037@boxplus-test.local',
        phone: '0618913037',
        birthdate: '1991-08-10',
      }
    : customer(stamp);
  console.log('\n=== Test headed : client Balma → switch Minimes ===');
  console.log(`${c.first_name} ${c.last_name}`);
  if (resumeId) console.log(`Reprise fiche ${resumeId} (migration + restore abo 29)`);
  else console.log('1) Création salle Balma + abo 29 + badge\n2) balma_switch vers Minimes\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: Number(process.env.DECIPLUS_SLOW_MO || 80),
  });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await login(page, { siteLabel: resumeId ? 'Minimes' : 'Balma' });
  recap.steps.push('login');
  console.log(`Login Deciplus OK — salle ${resumeId ? 'Minimes' : 'Balma'}\n`);

  const saleOrder = normalizeOrder({
    order_id: `DEMO-BALMA-CREATE-${stamp}`,
    product_id: 'offre-duo',
    product_name: 'OFFRE A 29€',
    deciplus_product_search: 'OFFRE A 29',
    gym: 'balma',
    customer: c,
    payment: {
      status: 'paid',
      amount: 29,
      method: 'card',
      iban: VALID_TEST_IBAN,
      billing_plan: 'rib',
    },
  });
  recap.sale_validation = validateOrder(saleOrder);
  let memberId = resumeId;
  if (!resumeId) {
    console.log('1/2 — vente Balma 29 + badge', saleOrder.order_id);
    try {
      recap.sale_result = await processSaleJob(page, saleOrder, {});
    } catch (err) {
      recap.sale_result = { error: err.message };
      console.error('vente Balma:', err.message);
    }
    memberId = recap.sale_result?.deciplus_member_id || '';
  }
  recap.member_id = memberId;
  if (memberId) {
    await openMemberCheck(page, memberId).catch(() => {});
    console.log(`Fiche ouverte (${memberId}) — pause ${PAUSE_MS / 1000}s`);
    await page.waitForTimeout(PAUSE_MS);
  }

  if (!memberId || (!resumeId && recap.sale_result?.error && !recap.sale_result?.deciplus_member_id)) {
    recap.steps.push('sale_failed_skip_switch');
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
    console.error('\nCréation Balma échouée — pas de migration. Recap', OUT);
    await page.waitForTimeout(8000);
    await browser.close();
    process.exit(1);
  }

  const switchOrder = normalizeOrder({
    order_id: `DEMO-BALMA-SWITCH-${stamp}`,
    action: 'balma_switch',
    gym: 'minimes',
    customer: { ...c, deciplus_member_id: memberId },
    deciplus_member_id: memberId,
    source: 'balma_retour',
    skip_cancel: Boolean(resumeId),
    skip_migrate: Boolean(resumeId),
    payment: {
      status: 'paid',
      amount: 29,
      method: 'card',
      iban: VALID_TEST_IBAN,
      billing_plan: 'rib',
    },
    snapshots: resumeId
      ? [{ search: 'OFFRE DUO 29', start: '18/08/2026', end: '15/09/2026' }]
      : undefined,
  });
  console.log('2/2 — balma_switch → Minimes', switchOrder.order_id);
  try {
    recap.switch_result = await processJob(page, switchOrder);
  } catch (err) {
    recap.switch_result = { error: err.message };
    console.error('balma_switch:', err.message);
  }

  await openMemberCheck(page, recap.switch_result?.deciplus_member_id || memberId).catch(() => {});
  recap.steps.push('done');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
  console.log('\nRecap', OUT);
  console.log('Fiche après migration — Chrome reste ouvert 20s');
  await page.waitForTimeout(20000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
