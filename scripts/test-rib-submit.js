#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  await page.goto(new URL('rib.php?idj=20899', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[name="nom"]', 'JEREMY TESTER');
  await page.fill('input[name="adr_line1"]', '12 rue de Fenouillet');
  await page.fill('input[name="adr_line2"]', '');
  await page.fill('input[name="adr_town"]', 'TOULOUSE');
  await page.fill('input[name="adr_postcode"]', '31200');
  await page.fill('input[name="adr_country"]', 'France');
  const vals = await page.evaluate(() => {
    const g = (n) => document.querySelector(`input[name="${n}"]`)?.value;
    return { nom: g('nom'), adr_line1: g('adr_line1'), adr_town: g('adr_town'), adr_postcode: g('adr_postcode'), adr_country: g('adr_country'), iban: g('iban') };
  });
  console.log('values before submit:', vals);
  await page.click('input[type="submit"][value="Valider"]');
  await page.waitForTimeout(3000);
  const errVisible = await page.locator('text=/obligatoire|erreur/i').first().isVisible().catch(() => false);
  console.log('url:', page.url());
  console.log('error visible:', errVisible);
  if (errVisible) {
    console.log('error:', await page.locator('text=/obligatoire|erreur/i').first().innerText().catch(() => ''));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
