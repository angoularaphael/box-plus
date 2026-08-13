#!/usr/bin/env node
/**
 * E2E Deciplus : Achat Carte → séance d'essai / coaching.
 * Ces offres n’ont PAS droit au Badge : une seule vente (la prestation), visible sur la fiche.
 *
 *   node scripts/test-carte-prestation-deciplus.js
 *   node scripts/test-carte-prestation-deciplus.js --coaching
 *   node scripts/test-carte-prestation-deciplus.js 21018
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { findOrCreateMember } = require('../bot/member');
const { recordSale, isBadgeSale } = require('../bot/sale');
const { fetchDeciplusCatalog, resolveProductConfig } = require('../bot/catalog');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { getGymConfig } = require('../lib/normalize');
const { findActiveContracts } = require('../bot/cancel-sale');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { resolvePrestationHint, isCartePrestationConfig } = require('../lib/catalog-sale');

const OUT = path.join(__dirname, '..', 'data', 'carte-prestation-e2e.json');
const wantCoaching = process.argv.includes('--coaching');
const reuseMemberId = (process.argv.find((a) => /^\d+$/.test(a)) || '').trim() || null;

function makeOrder(kind, stamp) {
  const suffix = String(stamp).slice(-6);
  const phone = `06${String(stamp).slice(-8).padStart(8, '0')}`;
  const customer = {
    first_name: kind === 'coaching-1' ? 'Coach' : 'Essai',
    last_name: `Boxplus${suffix}`,
    email:
      kind === 'coaching-1'
        ? `coach.boxplus.${stamp}@example.com`
        : `essai.boxplus.${stamp}@example.com`,
    phone,
    birthdate: kind === 'coaching-1' ? '1992-03-20' : '1995-06-15',
    gender: 'M',
    address: '12 rue de Fenouillet',
    postal_code: '31200',
    city: 'Toulouse',
    country: 'FR',
  };
  if (kind === 'coaching-1') {
    return {
      order_id: `LOCAL-COACH1-${stamp}`,
      source: 'local-test',
      product_id: 'coaching-1',
      product_name: 'COACHING PRIVE 1 SEANCE',
      deciplus_product_search: 'COACHING PRIVE 1',
      sale_type: 'carte',
      gym: 'minimes',
      customer,
      payment: { status: 'paid', amount: 55, method: 'payplug' },
    };
  }
  return {
    order_id: `LOCAL-ESSAI-${stamp}`,
    source: 'local-test',
    product_id: 'seance-essai',
    product_name: "SEANCE D'ESSAI",
    deciplus_product_search: 'essai',
    sale_type: 'carte',
    gym: 'minimes',
    customer,
    payment: { status: 'paid', amount: 10, method: 'payplug' },
  };
}

function saleLooksRight(contracts, kind, { badgesBefore = 0, reused = false } = {}) {
  const labels = (contracts || []).map((c) => String(c.label || ''));
  const needle = kind === 'coaching-1' ? /coaching/i : /essai/i;
  const found = labels.some((l) => needle.test(l));
  const badges = (contracts || []).filter((c) => c.isBadge || (/\bbadge\b/i.test(String(c.label || '')) && !needle.test(String(c.label || ''))));
  const badgeAdded = badges.length > badgesBefore;
  const badgeOnly = labels.length > 0 && labels.every((l) => /\bbadge\b/i.test(l) && !needle.test(l));
  return {
    found,
    badgeOnly,
    badgeAdded,
    hasBadge: badges.length > 0,
    labels,
    unexpectedBadge: reused ? badgeAdded : badges.length > 0,
  };
}

async function runOne(page, order, gymConfig, catalog) {
  const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
  const hint = resolvePrestationHint(order);
  console.log('Config', {
    order_id: order.order_id,
    label: productConfig.label,
    search: productConfig.deciplus_product_search,
    sale_type: productConfig.sale_type,
    is_badge: isBadgeSale(productConfig),
    auto_badge: productConfig.auto_badge,
    is_prestation: isCartePrestationConfig(productConfig),
  });
  if (isBadgeSale(productConfig) || !isCartePrestationConfig(productConfig) || productConfig.auto_badge) {
    throw new Error(`Config incorrecte (Badge / auto_badge) pour ${hint?.id}`);
  }

  let memberId = reuseMemberId;
  let memberResult = memberId
    ? { member_id: memberId, action: 'reused' }
    : await findOrCreateMember(page, order, gymConfig);
  memberId = memberResult.member_id;
  if (!memberId) throw new Error('Pas de member_id');
  console.log('Membre', memberResult);

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId);
  await page.waitForTimeout(1500);
  const beforeContracts = await findActiveContracts(page).catch(() => []);
  const badgesBefore = beforeContracts.filter((c) => c.isBadge).length;
  console.log('Contrats avant', beforeContracts.map((c) => c.label));

  const saleResult = await recordSale(page, order, productConfig, memberId, gymConfig);
  console.log('Sale', saleResult);
  if (saleResult?.action === 'carte_badge_created' || saleResult?.badge_action) {
    throw new Error('La vente a pris le flux Badge — attendu Achat Carte prestation sans Badge');
  }

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId);
  await page.waitForTimeout(2500);
  const contracts = await findActiveContracts(page).catch(() => []);
  const check = saleLooksRight(contracts, order.product_id, {
    badgesBefore,
    reused: memberResult.action === 'reused',
  });
  console.log('Contrats fiche', check.labels);

  try {
    const shot = path.join(
      __dirname,
      '..',
      'data',
      'logs',
      `carte-e2e-ok-${order.product_id}-${memberId}.png`
    );
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: true });
    console.log('Screenshot fiche', shot);
    check.screenshot = shot;
  } catch {
    /* ignore */
  }

  if (!check.found) {
    throw new Error(
      `Vente ${order.product_id} introuvable sur la fiche ${memberId}. Contrats: ${check.labels.join(' | ') || '(aucun)'}`
    );
  }
  if (check.badgeOnly || check.unexpectedBadge) {
    throw new Error(
      `Badge présent sur la fiche ${memberId} pour ${order.product_id} — ces offres n’ont pas droit au Badge. Contrats: ${check.labels.join(' | ')}`
    );
  }

  return {
    member_id: memberId,
    member: memberResult,
    sale: saleResult,
    contracts: check.labels,
    screenshot: check.screenshot || null,
    visible: true,
    no_badge: true,
  };
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session manquante — npm run session:export');
    process.exit(1);
  }

  const stamp = Date.now();
  const kinds = ['seance-essai'];
  if (wantCoaching || !process.argv.includes('--essai-only')) kinds.push('coaching-1');

  const report = { ok: false, steps: {} };
  const headless = String(process.env.DECIPLUS_HEADLESS || 'true') !== 'false';
  console.log('\n=== E2E Deciplus Achat Carte (vente visible sur fiche) ===');
  console.log('Produits:', kinds.join(', '), headless ? 'headless' : 'headed');

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 50 });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await login(page, { siteLabel: 'Minimes' });
    console.log('Login OK');
    const catalog = await fetchDeciplusCatalog(page);
    const gymConfig = getGymConfig('minimes');

    for (const kind of kinds) {
      const order = makeOrder(kind, stamp);
      console.log(`\n--- ${kind} ---`);
      report.steps[kind] = await runOne(page, order, gymConfig, catalog);
    }

    report.ok = kinds.every((k) => report.steps[k]?.visible && report.steps[k]?.no_badge);
    if (!report.ok) throw new Error('Une vente n’est pas visible sur Deciplus, ou un Badge a été créé');
    console.log('\nOK — vente(s) visible(s) sur la fiche Deciplus, sans Badge');
    await context.storageState({ path: STORAGE_FILE });
  } catch (err) {
    console.error('\nECHEC:', err.message);
    report.error = err.message;
    report.url = page.url();
    try {
      const shot = path.join(__dirname, '..', 'data', 'logs', `carte-e2e-fail-${Date.now()}.png`);
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await page.screenshot({ path: shot, fullPage: true });
      report.screenshot = shot;
      console.log('Screenshot', shot);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Report →', OUT);
    await page.waitForTimeout(process.exitCode ? 4000 : 1000);
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
