#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { handleChooseZone } = require('../bot/auth');

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  const memberId = process.argv[2] || '20901';
  const site = process.argv[3] || 'Ramonville';

  await page.goto(new URL(`check.php?idj=${memberId}`, base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByText(/Achat Abonnement/i).first().click();
  await page.waitForURL(/nextgen|choose-zone/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log('before zone', page.url());
  await handleChooseZone(page, site);
  await page.waitForTimeout(8000);
  console.log('after zone', page.url());

  const data = await page.evaluate(() => ({
    url: location.href,
    inputs: [...document.querySelectorAll('input')].map((el) => ({ placeholder: el.placeholder, type: el.type, className: el.className?.slice(0, 40) })),
    texts: (document.body?.innerText || '').split('\n').filter((l) => /OFFRE|34\.99|ETUDIANT|Recherch/i.test(l)).slice(0, 20),
    bodySample: (document.body?.innerText || '').slice(0, 1200),
  }));
  console.log(JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'vente-after-zone.json'), JSON.stringify(data, null, 2));

  const search = page.locator('input[placeholder*="Rechercher"], input[placeholder*="produit"], input[type="search"]').first();
  if ((await search.count()) > 0) {
    await search.fill('OFFRE PROMO 34.99');
    await page.waitForTimeout(2500);
    const tile = page.getByText(/OFFRE PROMO 34\.99.*ETUDIANT/i).first();
    console.log('tile', await tile.count(), await tile.isVisible().catch(() => false));
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
