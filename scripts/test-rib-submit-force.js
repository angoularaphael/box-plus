#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');

const IBAN = 'FR7630001007941234567890185';

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  const memberId = process.argv[2] || '20900';

  await page.goto(new URL(`rib.php?idj=${memberId}`, base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const before = await page.evaluate(() => {
    const get = (n) => document.querySelector(`input[name="${n}"]`)?.value || '';
    return {
      blocker: /adresse postale est obligatoire/i.test(document.body?.innerText || ''),
      iban: get('iban'),
      nom: get('nom'),
      adr_line1: get('adr_line1'),
      adr_town: get('adr_town'),
      adr_postcode: get('adr_postcode'),
      adr_country: get('adr_country'),
    };
  });
  console.log('before', before);

  await page.fill('input[name="iban"]', IBAN);
  await page.fill('input[name="nom"]', 'TESTER TESTERR');
  await page.fill('input[name="adr_line1"]', '18 rue des champs');
  await page.fill('input[name="adr_town"]', 'TOULOUSE');
  await page.fill('input[name="adr_postcode"]', '31200');
  await page.fill('input[name="adr_country"]', 'France');

  await page.evaluate(() => {
    const submit = document.querySelector('input[name="alde_submit"]');
    if (submit) submit.value = 'valider';
    const cb = document.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = true;
  });

  const blockerBeforeSubmit = await page.locator('text=/adresse postale est obligatoire/i').first().isVisible().catch(() => false);
  console.log('blocker before submit', blockerBeforeSubmit);

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
    page.locator('input[type="submit"][value="Valider"]').first().click({ timeout: 10000 }).catch(async () => {
      await page.evaluate(() => document.querySelector('form')?.submit());
    }),
  ]);
  await page.waitForTimeout(3000);

  const afterUrl = page.url();
  const after = await page.evaluate(() => {
    const get = (n) => document.querySelector(`input[name="${n}"]`)?.value || '';
    return {
      blocker: /adresse postale est obligatoire/i.test(document.body?.innerText || ''),
      iban: get('iban'),
      text: document.body?.innerText?.slice(0, 500),
    };
  });
  console.log('after url', afterUrl);
  console.log('after', after);

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
