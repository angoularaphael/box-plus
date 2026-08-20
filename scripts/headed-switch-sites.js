#!/usr/bin/env node
/**
 * Test Chrome — ouvrir le picker Deciplus puis Balma et Minimes.
 *   node scripts/headed-switch-sites.js
 */
require('dotenv').config();

delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const { chromium } = require('playwright');
const { login } = require('../bot/auth');
const { switchDeciplusSite, isChooseZoneScreen, isHomeWithoutPicker } = require('../bot/deciplus-zone');

const headless = String(process.env.DECIPLUS_HEADLESS || '').toLowerCase() === 'true';

async function launchChrome() {
  const opts = { headless, slowMo: headless ? 0 : 80 };
  try {
    return await chromium.launch({ channel: 'chrome', ...opts });
  } catch {
    return await chromium.launch(opts);
  }
}

(async () => {
  const browser = await launchChrome();
  const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await login(page);
    const balma = await switchDeciplusSite(page, 'Balma');
    const afterBalma = { ok: balma, url: page.url(), picker: await isChooseZoneScreen(page) };
    console.log(JSON.stringify({ step: 'balma', ...afterBalma }, null, 2));
    if (!balma) {
      throw new Error(`Balma impossible (url=${afterBalma.url})`);
    }
    if (isHomeWithoutPicker(afterBalma.url) && afterBalma.picker) {
      throw new Error('Toujours sur le picker après Balma');
    }

    const minimes = await switchDeciplusSite(page, 'Minimes');
    const afterMinimes = { ok: minimes, url: page.url(), picker: await isChooseZoneScreen(page) };
    console.log(JSON.stringify({ step: 'minimes', ...afterMinimes }, null, 2));
    if (!minimes) {
      throw new Error(`Minimes impossible (url=${afterMinimes.url})`);
    }
    console.log('OK switch Balma → Minimes');
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
