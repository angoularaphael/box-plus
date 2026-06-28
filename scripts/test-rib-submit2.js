#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');

async function submitRib(page) {
  await page.evaluate(() => {
    const form = document.querySelector('form');
    const submit = form?.querySelector('input[name="alde_submit"]');
    if (submit) submit.value = 'valider';
    const cb = form?.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = true;
  });
  await page.click('input[type="submit"][value="Valider"]');
  await page.waitForTimeout(3000);
}

(async () => {
  const storage = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: storage, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  await page.goto(new URL('nextgen/home', base).href, { waitUntil: 'domcontentloaded' });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth') || '{}').token);
  const memberRes = await ctx.request.get(`https://api.deciplus.pro/staff/v1/member/20899`, {
    headers: { 'x-access-token': token, 'Deciplus-Client-Type': 'manager' },
  });
  console.log('member API status', memberRes.status());
  const member = await memberRes.json();
  console.log('member address', {
    adr1: member.response?.adr1,
    postalCode: member.response?.postalCode,
    city: member.response?.city,
    country: member.response?.country,
  });

  await page.goto(new URL('rib.php?idj=20899', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.fill('input[name="nom"]', 'JEREMY TESTER');
  await page.fill('input[name="adr_line1"]', '12 rue de Fenouillet');
  await page.fill('input[name="adr_town"]', 'TOULOUSE');
  await page.fill('input[name="adr_postcode"]', '31200');
  await page.fill('input[name="adr_country"]', 'FR');

  await submitRib(page);
  let err = await page.locator('text=/obligatoire|erreur/i').first().isVisible().catch(() => false);
  console.log('attempt1 error:', err, page.url());
  if (err) console.log(await page.locator('text=/obligatoire|erreur/i').first().innerText().catch(() => ''));

  if (err) {
    // Try inner=1 like modal
    await page.goto(new URL('rib.php?inner=1&idj=20899', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.fill('input[name="adr_line1"]', '12 rue de Fenouillet');
    await page.fill('input[name="adr_town"]', 'TOULOUSE');
    await page.fill('input[name="adr_postcode"]', '31200');
    await page.fill('input[name="adr_country"]', 'FR');
    await submitRib(page);
    err = await page.locator('text=/obligatoire|erreur/i').first().isVisible().catch(() => false);
    console.log('attempt2 inner error:', err, page.url());
    if (err) console.log(await page.locator('text=/obligatoire|erreur/i').first().innerText().catch(() => ''));
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
