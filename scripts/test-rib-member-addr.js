#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';

  await page.goto(new URL('joueurs.php?idj=20899', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.fill('input[name="adr1"]', '12 rue de Fenouillet');
  await page.fill('input[name="codepostal"]', '31200');
  await page.fill('input[name="ville"]', 'Toulouse');
  await page.fill('input[name="pays"]', 'France');
  await page.click('input[type="submit"][value="Valider"]').catch(async () => {
    await page.locator('input[type="submit"].albut, input.albut[value="Valider"]').first().click();
  });
  await page.waitForTimeout(3000);
  console.log('member saved url:', page.url());

  await page.goto(new URL('rib.php?idj=20899', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const vals = await page.evaluate(() => ({
    adr_line1: document.querySelector('input[name="adr_line1"]')?.value,
    adr_town: document.querySelector('input[name="adr_town"]')?.value,
    adr_postcode: document.querySelector('input[name="adr_postcode"]')?.value,
  }));
  console.log('rib prefilled:', vals);
  await page.click('input[type="submit"][value="Valider"]');
  await page.waitForTimeout(3000);
  const errVisible = await page.locator('text=/obligatoire|erreur/i').first().isVisible().catch(() => false);
  console.log('rib url:', page.url(), 'error:', errVisible);
  if (errVisible) {
    console.log(await page.locator('text=/obligatoire|erreur/i').first().innerText().catch(() => ''));
  } else {
    console.log('RIB OK');
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
