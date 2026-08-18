#!/usr/bin/env node
require('dotenv').config();
process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '80';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { processSaleJob } = require('../bot/index');
const { defaultSeancePhotoPath } = require('../bot/member');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { openMemberCheck } = require('../bot/wallet');

async function main() {
  const jpg = defaultSeancePhotoPath();
  if (!jpg) throw new Error('JPEG défaut manquant');
  const photo_base64 = `data:image/jpeg;base64,${fs.readFileSync(jpg).toString('base64')}`;
  const stamp = Date.now();
  const order = normalizeOrder({
    order_id: `DEMO-259-${stamp}`,
    product_id: 'dp-100',
    product_name: 'OFFRE PROMO 12 MOIS',
    deciplus_product_search: '12 MOIS',
    gym: 'minimes',
    customer: {
      first_name: 'TestOffre259',
      last_name: `Photo${String(stamp).slice(-5)}`,
      email: `offre259.${stamp}@boxplus-test.local`,
      phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
      birthdate: '1991-08-10',
      gender: 'M',
      address: '18 rue des Lilas',
      postal_code: '31000',
      city: 'Toulouse',
      country: 'FR',
    },
    photo_base64,
    photo_url: 'https://seance-offerte.boxingcenter.fr/seance-essai-photo.jpg',
    payment: { status: 'paid', amount: 259, method: 'card', payment_plan: 'once' },
    source: 'headed-demo-259',
  });
  const errors = validateOrder(order);
  if (errors.length) throw new Error(errors.join(', '));

  console.log('=== Demo headed 259 € ===');
  console.log('Cherche:', order.customer.first_name, order.customer.last_name);

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  try {
    await login(page, { siteLabel: 'Minimes' });
    const result = await processSaleJob(page, order, {});
    console.log('Résultat', {
      status: result.status,
      member: result.deciplus_member_id,
      photo: result.photo_uploaded,
      sale: result.deciplus_sale_id,
      error: result.error || null,
    });
    if (result.deciplus_member_id) {
      await openMemberCheck(page, result.deciplus_member_id).catch(() => {});
      await page.waitForTimeout(16000);
    }
    await context.storageState({ path: STORAGE_FILE });
  } finally {
    await page.waitForTimeout(8000).catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
