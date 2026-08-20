#!/usr/bin/env node
/**
 * Test Chrome visible — nouveau parcours Aventure :
 * 1) créer une fiche sur Balma
 * 2) chercher par nom / prénom / naissance
 * 3) recopier les infos, créer un doublon Minimes (clic doublon)
 * 4) pas de vente 29 (ce test = fiche seulement)
 *    → pas de migration, pas de résiliation Balma
 *
 *   node scripts/headed-aventure-duplicate.js
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '140';
process.env.BOT_DELAY_SCALE = process.env.BOT_DELAY_SCALE || '1';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { findOrCreateMember, openMemberEditForm } = require('../bot/member');
const { runBalmaSwitch, readMemberProfile } = require('../bot/aventure-clone');
const { appendBalmaToFirstName } = require('../lib/aventure-duplicate-address');
const { normalizeOrder, validateOrder, getGymConfig } = require('../lib/normalize');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 8000);
const END_MS = Number(process.env.DEMO_END_MS || 45000);
const OUT = path.join(__dirname, '..', 'data', `aventure-duplicate-${Date.now()}.json`);

function customer(stamp) {
  const tail = String(stamp).slice(-5);
  return {
    first_name: 'Aventure',
    last_name: `Dup${tail}`,
    email: `dup${tail}.balma@boxingcenter-test.fr`,
    phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate: '1992-03-15',
    gender: 'M',
    address: '8 rue Theron de Montauge',
    postal_code: '31130',
    city: 'Balma',
    country: 'FR',
  };
}

async function launchChrome() {
  const slowMo = Number(process.env.DECIPLUS_SLOW_MO || 140);
  try {
    return await chromium.launch({ channel: 'chrome', headless: false, slowMo });
  } catch {
    console.warn('Chrome système introuvable — Playwright Chromium');
    return await chromium.launch({ headless: false, slowMo });
  }
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const stamp = Date.now();
  const c = customer(stamp);
  const recap = {
    at: new Date().toISOString(),
    customer: c,
    steps: [],
  };

  console.log('\n=== Chrome : Aventure Balma → doublon Minimes ===');
  console.log(`${c.first_name} ${c.last_name}  ${c.birthdate}`);
  console.log('1) Fiche Balma  2) Recherche + doublon Minimes (sans vente)\n');

  const browser = await launchChrome();
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await login(page, { siteLabel: 'Balma' });
  recap.steps.push('login_balma');
  console.log('Login Balma OK\n');

  const balmaConfig = getGymConfig('balma');
  balmaConfig.key = 'balma';
  const createOrder = normalizeOrder({
    order_id: `DEMO-AV-CREATE-${stamp}`,
    gym: 'balma',
    customer: c,
    product_id: 'none',
    product_name: 'Fiche Aventure test',
    sale_type: 'none',
    requires_payment: false,
    requires_iban: false,
  });
  console.log('1/2 — création fiche Balma');
  try {
    recap.create_result = await findOrCreateMember(page, createOrder, balmaConfig);
  } catch (err) {
    recap.create_result = { error: err.message };
    console.error('création Balma:', err.message);
  }
  const balmaId = recap.create_result?.member_id || '';
  recap.balma_member_id = balmaId;
  recap.steps.push('create_balma');

  if (balmaId) {
    await openMemberCheck(page, balmaId, balmaConfig).catch(() => {});
    console.log(`Fiche Balma ${balmaId} — pause ${PAUSE_MS / 1000}s (tu peux regarder)`);
    await page.waitForTimeout(PAUSE_MS);
  } else {
    recap.steps.push('create_failed');
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
    console.error('\nCréation Balma échouée. Recap', OUT);
    await page.waitForTimeout(12000);
    await browser.close();
    process.exit(1);
  }

  const switchOrder = normalizeOrder({
    order_id: `DEMO-AV-SWITCH-${stamp}`,
    action: 'balma_switch',
    gym: 'minimes',
    source: 'balma_retour',
    aventure: true,
    offer: '29',
    product_id: 'offre-duo',
    product_name: 'OFFRE DUO 29€',
    deciplus_product_search: 'OFFRE DUO 29',
    customer: c,
    payment: {
      status: 'unpaid',
      amount: 0,
      method: 'none',
    },
  });
  recap.switch_validation = validateOrder(switchOrder);
  console.log('\n2/2 — balma_switch (recherche Balma → doublon Minimes, sans résil)');
  try {
    recap.switch_result = await runBalmaSwitch(page, switchOrder);
  } catch (err) {
    recap.switch_result = { error: err.message };
    console.error('balma_switch:', err.message);
  }

  const minimesId = recap.switch_result?.deciplus_member_id || '';
  recap.minimes_member_id = minimesId;
  recap.cancelled = recap.switch_result?.cancelled;
  recap.migrated = recap.switch_result?.migrated;
  recap.duplicate = recap.switch_result?.duplicate;
  recap.expected_minimes_first_name = appendBalmaToFirstName(c.first_name);
  recap.steps.push('switch');

  if (minimesId) {
    await openMemberEditForm(page, minimesId).catch(() => {});
    recap.minimes_profile = await readMemberProfile(page).catch((err) => ({ error: err.message }));
  }

  recap.ok =
    Boolean(balmaId) &&
    Boolean(minimesId) &&
    recap.cancelled === false &&
    recap.migrated === false &&
    recap.duplicate === true &&
    String(recap.minimes_profile?.first_name || '').trim() === recap.expected_minimes_first_name &&
    !String(recap.minimes_profile?.email || '').trim() &&
    !String(recap.minimes_profile?.phone || '').trim();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
  console.log('\nRecap', OUT);
  console.log({
    balma: balmaId,
    minimes: minimesId,
    cancelled: recap.cancelled,
    migrated: recap.migrated,
    duplicate: recap.duplicate,
    first_name: recap.minimes_profile?.first_name || null,
    email: recap.minimes_profile?.email || '',
    phone: recap.minimes_profile?.phone || '',
    expected_first_name: recap.expected_minimes_first_name,
    status: recap.switch_result?.status,
    ok: recap.ok,
  });
  console.log(`Chrome reste ouvert ${END_MS / 1000}s — compare les deux fiches`);
  await page.waitForTimeout(END_MS);
  await browser.close();
  if (!recap.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
