#!/usr/bin/env node
require('dotenv').config();
process.env.DECIPLUS_HEADLESS = 'false';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;

const { chromium } = require('playwright');
const { STORAGE_FILE } = require('../bot/auth');

async function memberFrame(page) {
  // Attendre l'iframe joueurs
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const url = frame.url();
      if (/joueurs\.php/i.test(url) && /idj=\d+/i.test(url)) {
        const has = await frame.locator('form[name="db1_form"], input[name="adr1"]').count();
        if (has > 0) return frame;
      }
    }
    await page.waitForTimeout(400);
  }
  // fallback
  for (const frame of page.frames()) {
    if ((await frame.locator('input[name="adr1"]').count()) > 0) return frame;
  }
  return null;
}

async function ribFrame(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if ((await page.locator('input[name="iban"]').count()) > 0) return page;
    for (const frame of page.frames()) {
      if ((await frame.locator('input[name="iban"]').count()) > 0) return frame;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const ctx = await browser.newContext({ storageState: STORAGE_FILE, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  const id = process.argv[2] || '21015';

  await page.goto(new URL(`joueurs.php?idj=${id}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  console.log('page url', page.url());
  console.log('frames', page.frames().map((f) => f.url()));

  const frame = await memberFrame(page);
  if (!frame) throw new Error('iframe membre introuvable');
  console.log('member frame', frame.url());

  const before = {
    adr1: await frame.locator('input[name="adr1"]').inputValue().catch(() => ''),
    cp: await frame.locator('input[name="codepostal"]').inputValue().catch(() => ''),
    ville: await frame.locator('input[name="ville"]').inputValue().catch(() => ''),
  };
  console.log('BEFORE', before);

  await frame.fill('input[name="adr1"]', '12 rue de Fenouillet');
  await frame.fill('input[name="codepostal"]', '31200');
  await frame.fill('input[name="ville"]', 'Toulouse');
  await frame.fill('input[name="pays"]', 'France');
  await frame.evaluate(() => {
    const f = document.querySelector('form[name="db1_form"]');
    const s = f?.querySelector('input[name="alde_submit"]');
    if (s) s.value = 'valider';
    const m = f?.querySelector('input[name="demande_maj"]');
    if (m) m.value = '1';
  });

  const clicked = await frame
    .locator('input[type="submit"][value="Mettre à jour"], input[type="submit"][value="Valider"]')
    .first()
    .click({ force: true })
    .then(() => true)
    .catch(() => false);
  console.log('clicked submit', clicked);
  if (!clicked) {
    await frame.evaluate(() => document.querySelector('form[name="db1_form"]')?.submit());
  }
  await page.waitForTimeout(3500);

  // reload
  await page.goto(new URL(`joueurs.php?idj=${id}`, base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const frame2 = await memberFrame(page);
  const after = {
    adr1: await frame2.locator('input[name="adr1"]').inputValue().catch(() => ''),
    cp: await frame2.locator('input[name="codepostal"]').inputValue().catch(() => ''),
    ville: await frame2.locator('input[name="ville"]').inputValue().catch(() => ''),
  };
  console.log('AFTER RELOAD', after);

  await page.goto(new URL(`rib.php?idj=${id}`, base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  console.log('rib page', page.url());
  console.log('rib frames', page.frames().map((f) => f.url()));

  const rf = await ribFrame(page);
  if (!rf) throw new Error('RIB form introuvable');
  const ribInfo = await rf.evaluate(() => {
    const text = document.body?.innerText || '';
    const get = (n) => document.querySelector(`input[name="${n}"]`)?.value || '';
    return {
      blocker: /adresse postale est obligatoire/i.test(text),
      iban: get('iban'),
      adr_line1: get('adr_line1'),
      adr_town: get('adr_town'),
      adr_postcode: get('adr_postcode'),
      snippet: (text.match(/adresse postale[\s\S]{0,180}/i) || [])[0] || null,
    };
  });
  console.log('RIB INFO', ribInfo);

  if (!ribInfo.blocker) {
    await rf.fill('input[name="iban"]', 'FR7630001007941234567890185');
    await rf.fill('input[name="nom"]', 'TEST Local');
    await rf.fill('input[name="adr_line1"]', '12 rue de Fenouillet');
    await rf.fill('input[name="adr_town"]', 'TOULOUSE');
    await rf.fill('input[name="adr_postcode"]', '31200');
    await rf.fill('input[name="adr_country"]', 'France');
    await rf.evaluate(() => {
      const form = document.querySelector('form');
      const s = form?.querySelector('input[name="alde_submit"]');
      if (s) s.value = 'valider';
      const cb = form?.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = true;
    });
    await rf.locator('input[type="submit"][value="Valider"]').first().click({ force: true }).catch(async () => {
      await rf.evaluate(() => document.querySelector('form')?.submit());
    });
    await page.waitForTimeout(3000);
    console.log('RIB submit done, url', page.url());

    await page.goto(new URL(`rib.php?idj=${id}`, base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const rf2 = await ribFrame(page);
    const saved = await rf2.evaluate(() => document.querySelector('input[name="iban"]')?.value || '');
    console.log('IBAN saved?', saved);
  } else {
    console.log('BLOCKER still present — need more address fix');
  }

  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
