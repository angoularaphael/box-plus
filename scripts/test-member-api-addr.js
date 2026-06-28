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
  await page.goto(new URL('select.php', base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth') || '{}').token);

  // find member by email via search - use rib for known id from email search
  await page.goto(new URL('select.php', base).href);
  await page.fill('#i_email', 'test@teste.com');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  const url = page.url();
  const m = url.match(/idj=(\d+)/);
  const memberId = m?.[1];
  console.log('member search url', url, 'id', memberId);
  if (!memberId) {
    await browser.close();
    return;
  }

  const addr = { adr1: '18 rue des champs', postalCode: '31200', city: 'Toulouse', country: 'France' };
  for (const method of ['PUT', 'PATCH', 'POST']) {
    const res = await ctx.request.fetch(`https://api.deciplus.pro/staff/v1/member/${memberId}`, {
      method,
      headers: { 'x-access-token': token, 'Deciplus-Client-Type': 'manager', 'Content-Type': 'application/json' },
      data: addr,
    });
    console.log(method, res.status(), await res.text().then((t) => t.slice(0, 120)).catch(() => ''));
  }

  const get = await ctx.request.get(`https://api.deciplus.pro/staff/v1/member/${memberId}`, {
    headers: { 'x-access-token': token, 'Deciplus-Client-Type': 'manager' },
  });
  const member = await get.json();
  console.log('member addr', {
    adr1: member.response?.adr1,
    postalCode: member.response?.postalCode,
    city: member.response?.city,
    country: member.response?.country,
  });

  await page.goto(new URL(`rib.php?idj=${memberId}`, base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const blocker = await page.locator('text=/adresse postale est obligatoire/i').first().isVisible().catch(() => false);
  console.log('rib blocker visible', blocker);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
