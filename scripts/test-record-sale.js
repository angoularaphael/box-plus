#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const { login } = require('../bot/auth');
const { fetchDeciplusCatalog, resolveProductConfig } = require('../bot/catalog');
const { recordSale } = require('../bot/sale');
const { getGymConfig } = require('../lib/normalize');

(async () => {
  const memberId = process.argv[2] || '20901';
  const order = {
    order_id: 'TEST-SALE',
    product_name: 'OFFRE PROMO 34.99€ ETUDIANTS',
    product_reference: 'dp-103',
    offer: 'dp-103',
    gym: 'ramonville',
    payment: { amount: 34.99, method: 'stripe', status: 'paid' },
    customer: { first_name: 'tester', last_name: 'testerr' },
    utm: { source: null, medium: null, campaign: 'test' },
  };

  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await login(page);
  const catalog = await fetchDeciplusCatalog(page);
  const productConfig = resolveProductConfig(order, catalog);
  const gymConfig = getGymConfig(order.gym);
  console.log('product', productConfig.label, productConfig.deciplus_product_id);

  const result = await recordSale(page, order, productConfig, memberId, gymConfig);
  console.log('result', result);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
