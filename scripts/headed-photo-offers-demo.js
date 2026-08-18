#!/usr/bin/env node
/**
 * Demo headed : offre 29 € → essai gratuit → essai 10 €.
 * Ouvre Chromium visible, crée la fiche Deciplus + photo.
 *
 *   node scripts/headed-photo-offers-demo.js
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '90';
process.env.BOT_DELAY_SCALE = process.env.BOT_DELAY_SCALE || '0.8';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { processSaleJob } = require('../bot/index');
const { openMemberCheck } = require('../bot/wallet');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { defaultSeancePhotoPath } = require('../bot/member');
const { VALID_TEST_IBAN } = require('../lib/test-fixtures');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 14000);

function officialJpegDataUrl() {
  const file = defaultSeancePhotoPath();
  if (!file) throw new Error('assets/seance-essai-photo.jpg manquant');
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
}

function customer(stamp, first, lastPrefix) {
  return {
    first_name: first,
    last_name: `${lastPrefix}${String(stamp).slice(-5)}`,
    email: `${lastPrefix.toLowerCase()}.${stamp}@boxplus-test.local`,
    phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate: '1991-08-10',
    gender: 'M',
    address: '18 rue des Lilas',
    postal_code: '31000',
    city: 'Toulouse',
    country: 'FR',
  };
}

function scenarios(stamp, photo29, photoFree, photo10) {
  const c29 = customer(stamp, 'TestOffre29', 'Photo');
  const cFree = customer(stamp + 1, 'TestGratuit', 'Photo');
  const c10 = customer(stamp + 2, 'TestEssai10', 'Photo');
  return [
    {
      title: '1/3 — OFFRE 29 €',
      order: {
        order_id: `DEMO-29-${stamp}`,
        product_id: 'dp-104',
        product_name: 'OFFRE A 29€',
        deciplus_product_search: 'OFFRE A 29',
        gym: 'minimes',
        customer: c29,
        photo_base64: photo29,
        payment: {
          status: 'paid',
          amount: 29,
          method: 'card',
          iban: VALID_TEST_IBAN,
          billing_plan: 'rib',
        },
        source: 'headed-demo-29',
      },
    },
    {
      title: '2/3 — ESSAI GRATUIT (séance offerte web)',
      order: {
        order_id: `DEMO-GRATUIT-${stamp}`,
        product_id: 'seance-essai-offerte',
        product_name: 'SEANCE D ESSAI GRATUITE WEB',
        sale_type: 'none',
        gym: 'minimes',
        customer: cFree,
        photo_base64: photoFree,
        info_compta: 'SEANCE D ESSAI GRATUITE WEB',
        payment: { status: 'paid', amount: 0, method: 'none' },
        source: 'seance-offerte-web',
      },
    },
    {
      title: '3/3 — ESSAI 10 €',
      order: {
        order_id: `DEMO-10-${stamp}`,
        product_id: 'seance-essai',
        product_name: "SEANCE D'ESSAI",
        deciplus_product_search: 'essai',
        sale_type: 'carte',
        gym: 'minimes',
        customer: c10,
        photo_base64: photo10,
        payment: { status: 'paid', amount: 10, method: 'payplug' },
        source: 'headed-demo-10',
      },
    },
  ];
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const stamp = Date.now();
  console.log('\n=== Demo headed photo : 29 € → gratuit → 10 € ===');
  console.log('Chromium va s’ouvrir. Laisse la fenêtre au premier plan.\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: Number(process.env.DECIPLUS_SLOW_MO || 90),
  });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const official = officialJpegDataUrl();
  const runs = scenarios(stamp, official, official, official);
  const results = [];

  try {
    await login(page, { siteLabel: 'Minimes' });
    console.log('Login Deciplus OK — Minimes\n');

    for (const run of runs) {
      const order = normalizeOrder(run.order);
      const errors = validateOrder(order);
      if (errors.length) throw new Error(`${run.title}: ${errors.join(', ')}`);

      console.log('────────────────────────────────────────');
      console.log(run.title);
      console.log(`Cherche: ${order.customer.first_name} ${order.customer.last_name}`);
      console.log(`Salle: Minimes · order ${order.order_id}`);
      console.log('Étapes: fiche membre → photo JPEG 600×600 → vente si besoin');
      console.log('────────────────────────────────────────');

      const result = await processSaleJob(page, order, {});
      const memberId = result.deciplus_member_id || null;
      console.log('Résultat:', {
        status: result.status,
        member: memberId,
        photo: result.photo_uploaded,
        error: result.error || null,
        sale: result.deciplus_sale_id || result.sale_action || null,
      });

      if (memberId) {
        await openMemberCheck(page, memberId).catch(() => {});
        await page.waitForTimeout(PAUSE_MS);
      }

      results.push({
        title: run.title,
        name: `${order.customer.first_name} ${order.customer.last_name}`,
        member: memberId,
        status: result.status,
        photo: Boolean(result.photo_uploaded),
        error: result.error || null,
      });
    }

    await context.storageState({ path: STORAGE_FILE });
  } finally {
    const out = path.join(__dirname, '..', 'data', 'headed-photo-offers-demo.json');
    fs.writeFileSync(out, JSON.stringify({ stamp, results }, null, 2));
    console.log('\n=== Récap (Minimes) ===');
    for (const r of results) {
      console.log(`- ${r.title}: ${r.name} · fiche ${r.member || '—'} · photo=${r.photo} · ${r.status}`);
    }
    console.log('\nFenêtre ouverte encore 20 s pour que tu confirmes, puis je ferme.');
    await page.waitForTimeout(20000).catch(() => {});
    await browser.close().catch(() => {});
  }

  const failed = results.filter((r) => r.status !== 'success' && r.status !== 'manual_review');
  if (failed.length || results.some((r) => !r.photo && r.status === 'success')) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
