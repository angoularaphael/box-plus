#!/usr/bin/env node
/**
 * Test Chrome visible — Aventure Balma → fiche Minimes + ventes 29 € puis 259 €.
 *
 * Pour chaque offre :
 * 1) créer une fiche Balma (photo + RIB)
 * 2) recopier les infos, créer une fiche Minimes (prénom + Balma, sans mail/tel)
 * 3) vendre l’offre choisie (29 prélèvement + badge, 259 comptant)
 *
 *   node scripts/headed-aventure-offers.js
 *   node scripts/headed-aventure-offers.js --only=29
 *   node scripts/headed-aventure-offers.js --only=259
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '120';
process.env.BOT_DELAY_SCALE = process.env.BOT_DELAY_SCALE || '1';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { findOrCreateMember, openMemberEditForm, uploadMemberPhoto, defaultSeancePhotoPath } = require('../bot/member');
const { openMemberCheck, setMemberIban } = require('../bot/wallet');
const { runBalmaSwitch, readMemberProfile, shouldCreateChosenOfferSale } = require('../bot/aventure-clone');
const { appendBalmaToFirstName } = require('../lib/aventure-duplicate-address');
const { normalizeOrder, validateOrder, getGymConfig } = require('../lib/normalize');
const { VALID_TEST_IBAN } = require('../lib/test-fixtures');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 6000);
const END_MS = Number(process.env.DEMO_END_MS || 18000);
const OUT = path.join(__dirname, '..', 'data', `aventure-offers-${Date.now()}.json`);

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? new Set(
      onlyArg
        .slice(7)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null;

function photoDataUrl() {
  const file = defaultSeancePhotoPath();
  if (!file) throw new Error('assets/seance-essai-photo.jpg manquant');
  return {
    path: file,
    dataUrl: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`,
  };
}

function customer(stamp, first, lastPrefix) {
  const tail = String(stamp).slice(-5);
  return {
    first_name: first,
    last_name: `${lastPrefix}${tail}`,
    email: `${lastPrefix.toLowerCase()}.${tail}@boxplus-test.local`,
    phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate: '1992-03-15',
    gender: 'M',
    address: '8 rue Theron de Montauge',
    postal_code: '31130',
    city: 'Balma',
    country: 'FR',
  };
}

const OFFERS = [
  {
    key: '29',
    title: 'OFFRE DUO 29 €',
    first_name: 'Aventure29',
    last_prefix: 'Duo',
    offer: '29',
    product_id: 'offre-duo',
    product_name: 'OFFRE DUO 29€',
    deciplus_product_search: 'OFFRE DUO 29',
    payment: {
      status: 'paid',
      amount: 29,
      method: 'card',
      iban: VALID_TEST_IBAN,
      billing_plan: 'rib',
    },
    expect_badge: true,
  },
  {
    key: '259',
    title: 'OFFRE SAISON 259 €',
    first_name: 'Aventure259',
    last_prefix: 'Sai',
    offer: '259',
    product_id: 'offre-saison',
    product_name: 'OFFRE PROMO 12 MOIS',
    deciplus_product_search: '12 MOIS',
    payment: {
      status: 'paid',
      amount: 259,
      method: 'card',
      payment_plan: 'once',
    },
    expect_badge: false,
  },
];

async function launchChrome() {
  const slowMo = Number(process.env.DECIPLUS_SLOW_MO || 120);
  try {
    return await chromium.launch({ channel: 'chrome', headless: false, slowMo });
  } catch {
    console.warn('Chrome système introuvable — Playwright Chromium');
    return await chromium.launch({ headless: false, slowMo });
  }
}

async function seedBalma(page, c, photo, stamp, key) {
  const balmaConfig = getGymConfig('balma');
  balmaConfig.key = 'balma';
  const createOrder = normalizeOrder({
    order_id: `DEMO-AV-${key}-CREATE-${stamp}`,
    gym: 'balma',
    customer: c,
    product_id: 'none',
    product_name: `Fiche Aventure ${key}`,
    sale_type: 'none',
    requires_payment: false,
    requires_iban: false,
    photo_path: photo.path,
    photo_base64: photo.dataUrl,
  });
  const created = await findOrCreateMember(page, createOrder, balmaConfig);
  const memberId = created?.member_id || '';
  const extras = { photo: null, iban: null };
  if (!memberId) return { created, memberId, extras };

  extras.photo = await uploadMemberPhoto(page, photo.path, photo.dataUrl, memberId).catch((err) => ({
    ok: false,
    error: err.message,
  }));
  extras.iban = await setMemberIban(page, memberId, VALID_TEST_IBAN, c, balmaConfig)
    .then(() => ({ ok: true }))
    .catch((err) => ({ ok: false, error: err.message }));
  return { created, memberId, extras };
}

async function runOffer(page, spec, photo, stamp) {
  const c = customer(stamp, spec.first_name, spec.last_prefix);
  const recap = {
    key: spec.key,
    title: spec.title,
    customer: c,
    steps: [],
  };

  console.log(`\n=== ${spec.title} — ${c.first_name} ${c.last_name} ===`);
  await login(page, { siteLabel: 'Balma' });
  recap.steps.push('login_balma');

  console.log(`1/3 — fiche Balma (photo + RIB)`);
  try {
    const seeded = await seedBalma(page, c, photo, stamp, spec.key);
    recap.create_result = seeded.created;
    recap.balma_seed_extras = seeded.extras;
    recap.balma_member_id = seeded.memberId;
  } catch (err) {
    recap.create_result = { error: err.message };
    recap.balma_member_id = '';
    console.error('création Balma:', err.message);
  }
  recap.steps.push('create_balma');

  if (!recap.balma_member_id) {
    recap.ok = false;
    recap.error = 'Création Balma échouée';
    return recap;
  }

  await openMemberCheck(page, recap.balma_member_id, getGymConfig('balma')).catch(() => {});
  console.log(`Fiche Balma ${recap.balma_member_id} — pause ${PAUSE_MS / 1000}s`);
  await page.waitForTimeout(PAUSE_MS);

  const switchOrder = normalizeOrder({
    order_id: `DEMO-AV-${spec.key}-SWITCH-${stamp}`,
    action: 'balma_switch',
    gym: 'minimes',
    source: 'balma_retour',
    aventure: true,
    offer: spec.offer,
    product_id: spec.product_id,
    product_name: spec.product_name,
    deciplus_product_search: spec.deciplus_product_search,
    customer: c,
    payment: spec.payment,
  });
  recap.switch_validation = validateOrder(switchOrder);
  recap.will_create_sale = shouldCreateChosenOfferSale(switchOrder);
  console.log(`2/3 — création Minimes + vente ${spec.title}`);
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
  recap.sale = recap.switch_result?.sale || null;
  recap.extras = recap.switch_result?.extras || null;
  recap.expected_minimes_first_name = appendBalmaToFirstName(c.first_name);
  recap.steps.push('switch');

  if (minimesId) {
    await openMemberEditForm(page, minimesId).catch(() => {});
    recap.minimes_profile = await readMemberProfile(page).catch((err) => ({ error: err.message }));
    await openMemberCheck(page, minimesId, getGymConfig('minimes')).catch(() => {});
  }

  const saleId = recap.sale?.sale_id || recap.sale?.deciplus_sale_id || null;
  recap.ok =
    Boolean(recap.balma_member_id) &&
    Boolean(minimesId) &&
    recap.cancelled === false &&
    recap.migrated === false &&
    recap.duplicate === true &&
    recap.will_create_sale === true &&
    Boolean(saleId) &&
    !recap.sale?.error &&
    String(recap.minimes_profile?.first_name || '').trim() === recap.expected_minimes_first_name &&
    !String(recap.minimes_profile?.email || '').trim() &&
    !String(recap.minimes_profile?.phone || '').trim();
  if (spec.expect_badge) {
    recap.ok =
      recap.ok &&
      recap.sale?.badge_action !== 'badge_failed' &&
      Boolean(recap.sale?.badge_sale_id);
  }

  console.log('3/3 — recap', {
    balma: recap.balma_member_id,
    minimes: minimesId,
    first_name: recap.minimes_profile?.first_name || null,
    email: recap.minimes_profile?.email || '',
    phone: recap.minimes_profile?.phone || '',
    photo: recap.extras?.photo?.ok ?? null,
    iban: recap.extras?.iban?.ok ?? null,
    sale_id: saleId,
    badge: recap.sale?.badge_sale_id || recap.sale?.badge_action || null,
    ok: recap.ok,
  });
  console.log(`Chrome reste ouvert ${END_MS / 1000}s — vérifie la vente ${spec.title}`);
  await page.waitForTimeout(END_MS);
  return recap;
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const photo = photoDataUrl();
  const offers = OFFERS.filter((o) => !only || only.has(o.key));
  if (!offers.length) {
    console.error('Aucune offre à tester. Utilise --only=29 et/ou --only=259');
    process.exit(1);
  }

  const recap = {
    at: new Date().toISOString(),
    offers: [],
  };

  console.log('\n=== Chrome : Aventure Balma → Minimes + ventes ===');
  console.log(offers.map((o) => o.title).join('  puis  '));

  const browser = await launchChrome();
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  for (const spec of offers) {
    const stamp = Date.now();
    recap.offers.push(await runOffer(page, spec, photo, stamp));
  }

  recap.ok = recap.offers.every((o) => o.ok);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
  console.log('\nRecap', OUT);
  console.log(
    recap.offers.map((o) => ({
      offer: o.key,
      balma: o.balma_member_id,
      minimes: o.minimes_member_id,
      sale: o.sale?.sale_id || o.sale?.error || null,
      ok: o.ok,
    }))
  );
  await browser.close();
  if (!recap.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
