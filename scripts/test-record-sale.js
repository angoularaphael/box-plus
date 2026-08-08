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
  const productKey = process.argv[3] || 'default';
  const products = {
    badge: {
      product_name: 'Badge',
      product_reference: null,
      offer: null,
      amount: 34.99,
      gym: 'minimes',
      billing_plan: 'prelevement',
    },
    'comptant-12': {
      product_name: 'COMPTANT 12 MOIS',
      product_reference: '000022',
      offer: 'dp-22',
      amount: 400,
      gym: 'minimes',
      billing_plan: 'comptant',
    },
    'comptant-6': {
      product_name: 'COMPTANT 6 MOIS',
      product_reference: null,
      offer: 'dp-91',
      amount: 250,
      gym: 'minimes',
      billing_plan: 'comptant',
    },
    'comptant-3': {
      product_name: 'COMPTANT 3 MOIS',
      product_reference: null,
      offer: 'dp-92',
      amount: 150,
      gym: 'minimes',
      billing_plan: 'comptant',
    },
  };
  const selected = products[productKey] || {
    product_name: 'OFFRE PROMO 34.99€ ETUDIANTS',
    product_reference: 'dp-103',
    offer: 'dp-103',
    amount: 34.99,
    gym: 'ramonville',
    billing_plan: 'prelevement',
  };
  const order = {
    order_id: 'TEST-SALE',
    product_name: selected.product_name,
    product_reference: selected.product_reference,
    offer: selected.offer,
    gym: selected.gym,
    payment: {
      amount: selected.amount,
      method: 'stripe',
      status: 'paid',
      billing_plan: selected.billing_plan,
    },
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
