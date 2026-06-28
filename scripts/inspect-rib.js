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
  await page.goto(new URL('rib.php?idj=20899', base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const postaleIdx = text.indexOf('postale');
    const inputs = [...document.querySelectorAll('input, select, textarea, label')].map((el) => ({
      tag: el.tagName,
      name: el.name || el.htmlFor || el.id,
      type: el.type,
      value: el.value?.slice?.(0, 60),
      text: el.innerText?.slice?.(0, 80),
      checked: el.checked,
      readonly: el.readOnly,
    }));
    return { url: location.href, postaleSnippet: text.slice(Math.max(0, postaleIdx - 100), postaleIdx + 200), inputs };
  });

  fs.writeFileSync(path.join(__dirname, '..', 'data', 'rib-inspect.json'), JSON.stringify(info, null, 2));
  console.log('saved data/rib-inspect.json', info.inputs.length, 'elements');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
