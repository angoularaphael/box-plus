#!/usr/bin/env node
/**
 * Termine le test Aventure en cours :
 * 1) badge comptant sur la fiche Minimes
 * 2) résiliation badge + abonnement
 *
 *   node scripts/headed-aventure-finish.js 21307
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '120';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { openMemberCheck } = require('../bot/wallet');
const { buyCarteBadge } = require('../bot/sale');
const { fetchDeciplusCatalog, resolveBadgeProductConfig } = require('../bot/catalog');
const { cancelSale, findActiveContracts } = require('../bot/cancel-sale');
const { getGymConfig } = require('../lib/normalize');

const memberId = String(process.argv[2] || '').trim();
if (!memberId) {
  console.error('Usage: node scripts/headed-aventure-finish.js <member_id>');
  process.exit(1);
}

async function launchChrome() {
  const slowMo = Number(process.env.DECIPLUS_SLOW_MO || 120);
  try {
    return await chromium.launch({ channel: 'chrome', headless: false, slowMo });
  } catch {
    return await chromium.launch({ headless: false, slowMo });
  }
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const gymConfig = getGymConfig('minimes');
  gymConfig.key = 'minimes';
  const recap = { member_id: memberId, steps: [] };

  const browser = await launchChrome();
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await login(page, { siteLabel: 'Minimes' });
  await openMemberCheck(page, memberId, gymConfig);

  const before = await findActiveContracts(page).catch(() => []);
  recap.before = before.map((c) => ({ idc: c.idc, label: c.label, isBadge: c.isBadge }));
  console.log('Contrats avant', recap.before);

    const alreadyBadge = before.some((c) => c.isBadge);
  if (alreadyBadge) {
    console.log('Badge déjà présent — on passe à la résiliation');
    recap.badge = { skipped: true };
    recap.badge_ok = true;
  } else {
    const catalog = await fetchDeciplusCatalog(page);
    const badgeProductConfig = resolveBadgeProductConfig(catalog, {
      badge_timing: 'immediate',
      badge_method: 'comptant',
      paiement_comptant: true,
      prelevement_delay_days: 0,
    });
    console.log('1/2 — badge comptant', badgeProductConfig.label || 'Badge');
    recap.badge = await buyCarteBadge(page, badgeProductConfig, gymConfig, memberId);
    await openMemberCheck(page, memberId, gymConfig).catch(() => {});
    const afterBadge = await findActiveContracts(page).catch(() => []);
    recap.after_badge = afterBadge.map((c) => ({ idc: c.idc, label: c.label, isBadge: c.isBadge }));
    recap.badge_ok =
      recap.badge?.action === 'carte_badge_created' || afterBadge.some((c) => c.isBadge);
    console.log('Badge', recap.badge, recap.after_badge);
    if (!recap.badge_ok) {
      recap.ok = false;
      recap.error = 'Badge non créé';
      console.error(recap);
      await page.waitForTimeout(8000);
      await browser.close();
      process.exit(1);
    }
  }
  recap.steps.push('badge');

  console.log('2/2 — résiliation badge + abonnement');
  recap.cancel = await cancelSale(page, memberId);
  recap.steps.push('cancel');
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const leftover = await findActiveContracts(page).catch(() => []);
  recap.after_cancel = leftover.map((c) => ({ idc: c.idc, label: c.label, isBadge: c.isBadge }));
  recap.ok = recap.cancel?.cancelled_count > 0 && leftover.length === 0;
  console.log('Résiliation', {
    cancelled_count: recap.cancel?.cancelled_count,
    leftover: recap.after_cancel,
    ok: recap.ok,
  });

  await page.waitForTimeout(6000);
  await browser.close();
  if (!recap.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
