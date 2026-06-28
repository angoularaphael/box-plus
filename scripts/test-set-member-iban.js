#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const { setMemberIban } = require('../bot/wallet');

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const memberId = process.argv[2] || '20900';
  const iban = process.argv[3] || 'FR7616598000014000116728121';
  const customer = {
    first_name: 'tester',
    last_name: 'testerr',
    address: '18 rue des champs',
    postal_code: '31200',
    city: 'Toulouse',
    country: 'FR',
  };
  const gymConfig = { label: 'Ramonville', address: '12 rue de Fenouillet, 31200 Toulouse' };

  await setMemberIban(page, memberId, iban, customer, gymConfig);
  console.log('OK setMemberIban', memberId);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
