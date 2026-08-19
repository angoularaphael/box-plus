#!/usr/bin/env node
/**
 * Test headed : membre Balma SANS abonnement + formulaire « pas d’offre active ».
 * Le bot vérifie nom / prénom / date de naissance puis migre vers Minimes, sans restore.
 *
 *   npm run headed:balma-noabo
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
const { processJob } = require('../bot/index');
const { findOrCreateMember } = require('../bot/member');
const { openMemberCheck } = require('../bot/wallet');
const { normalizeOrder, validateOrder, getGymConfig } = require('../lib/normalize');
const { validateBalmaSwitchPayload, buildBalmaSwitchOrder } = require('../lib/balma');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 10000);
const OUT = path.join(__dirname, '..', 'data', `balma-no-abo-${Date.now()}.json`);

function customer(stamp) {
  const tail = String(stamp).slice(-5);
  return {
    first_name: 'TestSansAbo',
    last_name: `Balma${tail}`,
    email: `testsansabo.balma${tail}@boxplus-test.local`,
    phone: `07${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate: '1992-04-18',
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

  const stamp = Date.now();
  const c = customer(stamp);
  console.log('\n=== Test headed : Balma sans abo → formulaire none → Minimes ===');
  console.log(`${c.first_name} ${c.last_name}  naissance ${c.birthdate}`);
  console.log('1) Création fiche Balma SANS vente / SANS abonnement');
  console.log('2) Payload formulaire Aventure (offre = none)');
  console.log('3) balma_switch : vérif identité + migration sans restore\n');

  const formParsed = validateBalmaSwitchPayload({
    first_name: c.first_name,
    last_name: c.last_name,
    birthdate: c.birthdate,
    offer: 'none',
  });
  recap.form = formParsed;
  if (formParsed.errors.length) {
    console.error('Formulaire invalide', formParsed.errors);
    process.exit(1);
  }
  console.log('Formulaire OK — offre none, skip_restore =', formParsed.skip_restore);

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
  await login(page, { siteLabel: 'Balma' });
  recap.steps.push('login_balma');
  console.log('Login Deciplus OK — salle Balma\n');

  const gymConfig = getGymConfig('balma');
  const createOrder = normalizeOrder({
    order_id: `DEMO-BALMA-NOABO-CREATE-${stamp}`,
    gym: 'balma',
    customer: c,
    payment: { status: 'pending', amount: 0 },
  });
  recap.create_validation = validateOrder(createOrder);

  console.log('1/2 — création membre Balma sans abonnement');
  try {
    recap.create_result = await findOrCreateMember(page, createOrder, gymConfig);
  } catch (err) {
    recap.create_result = { error: err.message };
    console.error('création:', err.message);
  }
  const memberId = recap.create_result?.member_id || '';
  recap.member_id = memberId;

  if (!memberId) {
    recap.steps.push('create_failed');
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
    console.error('\nCréation Balma échouée — pas de migration. Recap', OUT);
    await page.waitForTimeout(8000);
    await browser.close();
    process.exit(1);
  }

  await openMemberCheck(page, memberId).catch(() => {});
  console.log(`Fiche créée (${memberId}) SANS abo — pause ${PAUSE_MS / 1000}s`);
  recap.steps.push('created_no_abo');
  await page.waitForTimeout(PAUSE_MS);

  const switchOrder = normalizeOrder({
    ...buildBalmaSwitchOrder(formParsed),
    deciplus_member_id: undefined,
  });
  recap.switch_payload = {
    order_id: switchOrder.order_id,
    action: switchOrder.action,
    offer: switchOrder.offer,
    skip_restore: switchOrder.skip_restore,
    identity: switchOrder.customer,
  };
  recap.switch_validation = validateOrder(switchOrder);
  console.log('2/2 — balma_switch sans offre (identité seule, comme le formulaire)', switchOrder.order_id);
  try {
    recap.switch_result = await processJob(page, switchOrder);
  } catch (err) {
    recap.switch_result = { error: err.message };
    console.error('balma_switch:', err.message);
  }

  const afterId = recap.switch_result?.deciplus_member_id || memberId;
  await openMemberCheck(page, afterId).catch(() => {});
  recap.steps.push('done');
  recap.ok =
    recap.switch_result?.status === 'success' &&
    Number(recap.switch_result?.restore?.restored || 0) === 0 &&
    Boolean(recap.switch_result?.restore?.skipped);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
  console.log('\nRecap', OUT);
  console.log('restore skipped =', recap.switch_result?.restore);
  console.log('Fiche après migration — Chrome reste ouvert 20s');
  await page.waitForTimeout(20000);
  await browser.close();
  process.exit(recap.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
