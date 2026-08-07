#!/usr/bin/env node
require('dotenv').config();
process.env.DECIPLUS_HEADLESS = 'false';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;

const { chromium } = require('playwright');
const { STORAGE_FILE } = require('../bot/auth');

async function waitFrame(page, pred, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await pred(frame)) return frame;
      } catch { /* */ }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const ctx = await browser.newContext({ storageState: STORAGE_FILE, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  const id = process.argv[2] || '21015';

  await page.goto(new URL(`joueurs.php?idj=${id}`, base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const mf = await waitFrame(page, async (f) => (await f.locator('input[name="adr1"]').count()) > 0);
  const member = await mf.evaluate(() => {
    const g = (n) => document.querySelector(`input[name="${n}"], select[name="${n}"]`)?.value || '';
    return {
      adr1: g('adr1'), adr2: g('adr2'), codepostal: g('codepostal'), ville: g('ville'), pays: g('pays'),
      latitude: g('latitude'), longitude: g('longitude'),
      idz: document.querySelector('select[name="idz"]')?.value || '',
      idzLabel: document.querySelector('select[name="idz"] option:checked')?.textContent || '',
    };
  });
  console.log('MEMBER', member);

  await page.goto(new URL(`rib.php?idj=${id}`, base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  const rf = await waitFrame(page, async (f) => (await f.locator('input[name="iban"], text=/adresse postale/i').count()) > 0) || page;

  const rib = await rf.evaluate(() => {
    const text = document.body?.innerText || '';
    const inputs = [...document.querySelectorAll('input, select, textarea, button')].map((el) => ({
      tag: el.tagName,
      name: el.name || el.id,
      type: el.type,
      value: String(el.value || '').slice(0, 50),
      disabled: el.disabled,
      readOnly: el.readOnly,
      text: (el.innerText || '').slice(0, 60),
    }));
    return {
      url: location.href,
      blocker: /adresse postale est obligatoire/i.test(text),
      fullText: text.slice(0, 2500),
      inputs,
    };
  });
  console.log('RIB blocker', rib.blocker);
  console.log('RIB text excerpt:\n', rib.fullText.slice(0, 1200));
  console.log('RIB inputs with name:', rib.inputs.filter((i) => i.name).slice(0, 40));

  await page.waitForTimeout(3000);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
