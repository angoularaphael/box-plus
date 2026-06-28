#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');

async function goToVente(page, memberId, siteLabel) {
  await page.goto(
    `https://boxingcenter.deciplus.pro/nextgen/choose-zone?idj=${memberId}&category=abo&nextUrl=/vente&forced=true`,
    { waitUntil: 'networkidle', timeout: 60000 }
  ).catch(() => {});
  await page.waitForTimeout(2000);
  await page.locator('.ari-select').first().click();
  await page.waitForTimeout(800);
  await page.getByText(new RegExp(siteLabel, 'i')).first().click();
  await page.getByRole('button', { name: /Vendre sur ce site/i }).click({ force: true });
  await page.waitForURL(/vente/, { timeout: 20000 });
  await page.waitForTimeout(5000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    storageState: 'data/session/storage-state.json',
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await goToVente(page, '20901', 'Ramonville');

  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map((el) => ({
      placeholder: el.placeholder,
      type: el.type,
      className: el.className?.slice(0, 50),
    }))
  );
  console.log('inputs', inputs);

  const search = page.locator('input').filter({ hasNot: page.locator('[type=hidden]') }).first();
  for (const sel of [
    'input[placeholder*="Rechercher"]',
    'input[placeholder*="prestation"]',
    'input[placeholder*="produit"]',
    '.ari-input input',
    'input[type="text"]',
  ]) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      console.log('using search', sel);
      await loc.fill('OFFRE PROMO 34.99');
      await page.waitForTimeout(3000);
      break;
    }
  }

  const dumpHits = async (label) => {
    const hits = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && /OFFRE PROMO 34|ETUDIANT/i.test(el.textContent || ''))
        .map((el) => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 80), class: el.className?.slice?.(0, 40) }))
        .slice(0, 15)
    );
    console.log(label, hits);
  };

  await dumpHits('after search');

  const abo = page.getByText(/^Abonnements$/i).first();
  if ((await abo.count()) > 0) {
    await abo.click();
    await page.waitForTimeout(3000);
    await dumpHits('after abo click');
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
