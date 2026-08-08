#!/usr/bin/env node
/**
 * Ouvre le portail PayPlug, se connecte, récupère la clé sk_test_
 * et l'écrit dans BOXPLUS/.env (PAYPLUG_SECRET_KEY).
 *
 * Usage:
 *   set PAYPLUG_PORTAL_EMAIL=...
 *   set PAYPLUG_PORTAL_PASSWORD=...
 *   node scripts/fetch-payplug-test-key.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const EMAIL = process.env.PAYPLUG_PORTAL_EMAIL || process.env.PAYPLUG_EMAIL;
const PASSWORD = process.env.PAYPLUG_PORTAL_PASSWORD || process.env.PAYPLUG_PASSWORD;
const ENV_PATH = path.join(__dirname, '..', '.env');

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('PAYPLUG_PORTAL_EMAIL et PAYPLUG_PORTAL_PASSWORD requis');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const page = await browser.newPage();
  await page.goto('https://portal.payplug.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.locator('input[type="email"], input[name="email"], input[name="username"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")').first().click();
  await page.waitForTimeout(4000);

  // Aller aux clés API
  const candidates = [
    'https://portal.payplug.com/settings/api',
    'https://portal.payplug.com/portal/settings/api',
    'https://portal.payplug.com/#/settings/api',
  ];
  let key = null;
  for (const url of candidates) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    key = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const m = text.match(/sk_test_[A-Za-z0-9]+/);
      return m ? m[0] : null;
    });
    if (key) break;
  }

  if (!key) {
    // Navigation manuelle assistée
    console.log('Clé non trouvée automatiquement — ouvre Paramètres → Clés API dans le navigateur.');
    console.log('Le script attend 90s que la clé sk_test_ apparaisse sur la page…');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !key) {
      await page.waitForTimeout(2000);
      key = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const m = text.match(/sk_test_[A-Za-z0-9]+/);
        return m ? m[0] : null;
      });
    }
  }

  if (!key) {
    console.error('Impossible de récupérer sk_test_. Copie-la manuellement dans PAYPLUG_SECRET_KEY.');
    await browser.close();
    process.exit(1);
  }

  let env = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^PAYPLUG_SECRET_KEY=/m.test(env)) {
    env = env.replace(/^PAYPLUG_SECRET_KEY=.*$/m, `PAYPLUG_SECRET_KEY=${key}`);
  } else {
    env += `\nPAYPLUG_SECRET_KEY=${key}\n`;
  }
  fs.writeFileSync(ENV_PATH, env);
  console.log('OK — PAYPLUG_SECRET_KEY (sk_test_) enregistrée dans .env');
  console.log(`Préfixe: ${key.slice(0, 12)}…`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
