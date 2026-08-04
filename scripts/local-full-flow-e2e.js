#!/usr/bin/env node
/**
 * Test local headed : membre → RIB → abonnement (échéances) → badge.
 * Usage:
 *   node scripts/local-full-flow-e2e.js
 *   node scripts/local-full-flow-e2e.js 21019
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { findOrCreateMember } = require('../bot/member');
const { setMemberIban, openRibForm, closeGreyboxIfOpen, openMemberCheck } = require('../bot/wallet');
const { recordSale } = require('../bot/sale');
const { fetchDeciplusCatalog, resolveProductConfig, resolveBadgeProductConfig } = require('../bot/catalog');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { getGymConfig } = require('../lib/normalize');

const OUT = path.join(__dirname, '..', 'data', 'local-full-flow-e2e.json');
const IBAN = 'FR7630001007941234567890185';
const reuseMemberId = process.argv[2] || null;

async function readPageSignals(page) {
  let text = '';
  for (const frame of page.frames()) {
    try {
      text += ` ${(await frame.locator('body').innerText().catch(() => '')) || ''}`;
    } catch {
      /* ignore */
    }
  }
  text = text.replace(/\s+/g, ' ');
  return {
    url: page.url(),
    hasEcheance: /[eé]ch[eé]ance/i.test(text),
    hasPrelevement: /pr[eé]l[eè]vement/i.test(text),
    hasBadge: /\bbadge\b/i.test(text),
    echeancesCount: (text.match(/[eé]ch[eé]ances?\s+pr[eé]vues?\s*[:\s]*(\d+)/i) || [])[1] || null,
    snippet: text.slice(0, 700),
  };
}

async function verifyRib(page, memberId) {
  await closeGreyboxIfOpen(page);
  const ribCtx = await openRibForm(page, memberId, { forceFresh: true });
  const meta = await ribCtx.evaluate(() => ({
    iban: document.querySelector('input[name="iban"]')?.value || '',
    rum: document.querySelector('input[name="rum"]')?.value || '',
    date_mandat: document.querySelector('input[name="date_mandat"]')?.value || '',
  }));
  await closeGreyboxIfOpen(page);
  return meta;
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session manquante — npm run session:export');
    process.exit(1);
  }

  const stamp = Date.now();
  const customer = {
    first_name: 'TestFlow',
    last_name: `E2e${String(stamp).slice(-6)}`,
    email: `test-full-flow-${stamp}@boxplus-test.local`,
    phone: '0612345678',
    birthdate: '1990-01-15',
    gender: 'M',
    address: '12 rue de Fenouillet',
    postal_code: '31200',
    city: 'Toulouse',
    country: 'FR',
  };
  const order = {
    order_id: `LOCAL-FLOW-${stamp}`,
    source: 'local-test',
    product_name: '44,99€/4 semaines Sans Engagement',
    gym: 'minimes',
    utm: { source: 'local', medium: 'e2e', campaign: 'full-flow' },
    customer,
    payment: {
      status: 'paid',
      amount: 44.99,
      method: 'card',
      iban: IBAN,
      billing_plan: 'rib',
    },
  };

  const report = { order_id: order.order_id, steps: {}, ok: false };
  console.log('\n=== E2E local headed : RIB + abo échéances + badge ===');
  console.log(order.order_id, reuseMemberId ? `reuse ${reuseMemberId}` : customer.email);

  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await login(page, { siteLabel: 'Minimes' });
    console.log('1) Login OK');

    const catalog = await fetchDeciplusCatalog(page);
    const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
    const badgeProductConfig = productConfig.auto_badge ? resolveBadgeProductConfig(catalog) : null;
    const gymConfig = getGymConfig(order.gym);
    console.log('Produit:', productConfig.label, {
      auto_badge: productConfig.auto_badge,
      paiement_comptant: productConfig.paiement_comptant,
      badge_delay: badgeProductConfig?.prelevement_delay_days,
    });

    let memberId = reuseMemberId;
    if (!memberId) {
      const memberResult = await findOrCreateMember(page, order, gymConfig);
      memberId = memberResult.member_id;
      if (!memberId) throw new Error('Pas de member_id');
      console.log('2) Membre OK', memberResult);
      report.steps.member = memberResult;
      await setMemberIban(page, memberId, IBAN, customer, gymConfig);
    } else {
      console.log('2) Réutilise membre', memberId);
      report.steps.member = { member_id: memberId, action: 'reused' };
      const existing = await verifyRib(page, memberId);
      if (!existing.rum) await setMemberIban(page, memberId, IBAN, customer, gymConfig);
    }

    const rib = await verifyRib(page, memberId);
    console.log('3) RIB', rib);
    report.steps.rib = rib;
    if (!rib.rum) throw new Error('RIB sans RUM');

    console.log('4) recordSale (abo + badge)...');
    const saleResult = await recordSale(page, order, productConfig, memberId, gymConfig, {
      badgeProductConfig,
    });
    console.log('4) Sale result', saleResult);
    report.steps.sale = saleResult;

    await closeGreyboxIfOpen(page);
    await openMemberCheck(page, memberId);
    await page.waitForTimeout(3500);
    const checkSignals = await readPageSignals(page);
    console.log('5) check.php', {
      hasEcheance: checkSignals.hasEcheance,
      hasPrelevement: checkSignals.hasPrelevement,
      hasBadge: checkSignals.hasBadge,
      echeancesCount: checkSignals.echeancesCount,
    });
    report.steps.check = checkSignals;

    const ribOk = Boolean(rib.rum);
    const aboOk = saleResult?.action === 'abonnement_created';
    const badgeOk = saleResult?.badge_action === 'carte_badge_created';
    const echeancesOk =
      checkSignals.hasEcheance ||
      checkSignals.hasPrelevement ||
      (aboOk && productConfig.paiement_comptant === false);

    report.checks = { ribOk, aboOk, badgeOk, echeancesOk };
    report.member_id = memberId;
    report.ok = ribOk && aboOk && badgeOk && echeancesOk;

    if (!report.ok) {
      throw new Error(
        `E2E incomplet: rib=${ribOk} abo=${aboOk} badge=${badgeOk} echeances=${echeancesOk} badge_action=${saleResult?.badge_action} err=${saleResult?.badge_error || ''}`
      );
    }

    console.log('\n✅ E2E OK — RIB + abonnement (échéances) + badge — membre', memberId);
    await context.storageState({ path: STORAGE_FILE });
  } catch (err) {
    console.error('\n❌ E2E ÉCHEC:', err.message);
    report.error = err.message;
    report.url = page.url();
    try {
      const shot = path.join(__dirname, '..', 'data', 'logs', `e2e-fail-${Date.now()}.png`);
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await page.screenshot({ path: shot, fullPage: true });
      report.screenshot = shot;
      console.log('Screenshot', shot);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Report →', OUT);
    await page.waitForTimeout(process.exitCode ? 6000 : 2000);
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
