#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  await page.goto(new URL('nextgen/choose-zone?nextUrl=/vente&forced=true', base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const options = await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (!sel) return { select: false, buttons: [...document.querySelectorAll('button')].map((b) => b.innerText?.trim()) };
    return {
      select: true,
      options: [...sel.options].map((o) => ({ value: o.value, label: o.text, selected: o.selected })),
      buttons: [...document.querySelectorAll('button')].map((b) => b.innerText?.trim()),
    };
  });
  console.log(JSON.stringify(options, null, 2));

  const sel = page.locator('select').first();
  if ((await sel.count()) > 0) {
    for (const label of ['Ramonville', 'BOXING CENTER Ramonville', /Ramonville/i]) {
      try {
        await sel.selectOption(typeof label === 'string' ? { label } : { label });
        console.log('selected', label);
        break;
      } catch (e) {
        console.log('fail select', label, e.message.slice(0, 80));
      }
    }
    await page.waitForTimeout(1000);
    const btn = page.getByRole('button', { name: /Vendre sur ce site/i }).first();
    console.log('btn', await btn.count(), await btn.isVisible().catch(() => false));
    if ((await btn.count()) > 0) await btn.click({ force: true });
    await page.waitForTimeout(8000);
    console.log('final url', page.url());
    const texts = await page.evaluate(() => (document.body?.innerText || '').split('\n').filter((l) => /OFFRE|Recherch|34\.99/i.test(l)).slice(0, 15));
    console.log('texts', texts);
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
