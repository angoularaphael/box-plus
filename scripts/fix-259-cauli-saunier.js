#!/usr/bin/env node
'use strict';
/**
 * Rattrape les 259 € payés sans contrat Deciplus :
 * - Sacha Cauli (St-Cyprien, fiche 21506)
 * - Mateo Saunier (Ramonville, fiche 14440)
 * - Benjamin Anton (États-Unis, fiche 18705)
 *
 *   node scripts/fix-259-cauli-saunier.js
 *   node scripts/fix-259-cauli-saunier.js --check
 *   node scripts/fix-259-cauli-saunier.js --only=anton
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');

const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `fix-259-cauli-saunier-${Date.now()}.json`);

const TARGETS = [
  {
    match: /cauli/i,
    order_id: 'BC-1788087966656-d08c2a',
    member_id: '21506',
    gym: 'st-cyprien',
  },
  {
    match: /saunier/i,
    order_id: 'BC-1788104202421-f5a3c4',
    member_id: '14440',
    gym: 'ramonville',
  },
  {
    match: /anton/i,
    order_id: 'BC-1788172989669-9e0963',
    member_id: '18705',
    gym: 'etats-unis',
  },
];

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.replace(/\s+/g, ' ').trim();
}

function slimContracts(list) {
  return (list || []).map((c) => ({
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
}

async function loadTargets() {
  const sb = getSupabase();
  const found = [];
  for (const spec of TARGETS) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .eq('order_id', spec.order_id)
      .limit(1);
    if (error) throw error;
    const r = (data || [])[0];
    const p = r?.payload || {};
    const name = rowName(p) || spec.match.toString();
    if (ONLY && !`${name} ${r?.order_id || ''} ${spec.order_id}`.toLowerCase().includes(ONLY)) {
      continue;
    }
    found.push({
      ...spec,
      created_at: r?.created_at || null,
      name,
      email: p.customer_short?.email || p.customer_full?.email || '',
      phone: p.customer_short?.phone || p.customer_full?.phone || '',
      birthdate: p.customer_short?.birthdate || p.customer_full?.birthdate || '',
      gym: p.customer_full?.gym || p.gym || spec.gym,
      member_id: p.deciplus_member_id || spec.member_id,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      bot_error: p.bot_error || null,
      pay: p.payment?.status || null,
      method: p.payment?.method || null,
      plan: p.payment?.payment_plan || p.payment?.billing_plan || null,
      signed: p.signature?.signed_at || null,
      payload: p,
    });
  }
  return found;
}

function productOrder(target) {
  const p = target.payload || {};
  return {
    order_id: target.order_id,
    product_id: 'dp-100',
    product_name: 'OFFRE PROMO 12 MOIS',
    deciplus_product_search: p.deciplus_product_search || 'OFFRE PROMO 12',
    gym: target.gym,
    paiement_comptant: true,
    requires_iban: false,
    auto_badge: false,
    payment: {
      status: 'paid',
      amount: 259,
      method: p.payment?.method || 'payplug',
      payment_plan: p.payment?.payment_plan || 'once',
    },
    customer: {
      first_name: p.customer_short?.first_name || p.customer_full?.first_name,
      last_name: p.customer_short?.last_name || p.customer_full?.last_name,
      email: target.email,
      phone: target.phone,
      birthdate: target.birthdate,
    },
    source: 'fix-259-cauli-saunier',
  };
}

async function repairOne(page, catalog, target) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  const { recordSale } = require('../bot/sale');
  const { resolveProductConfig } = require('../bot/catalog');
  const { detectMemberGymConfig } = require('../bot/member');

  const memberId = String(target.member_id || '');
  if (!memberId) throw new Error(`${target.name} : pas de member_id`);
  let gymConfig = getGymConfig(target.gym || 'minimes');

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  const site = await detectMemberGymConfig(page, gymConfig).catch(() => null);
  if (site?.deciplus_label) gymConfig = site;

  const saleOrder = productOrder(target);
  const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(saleOrder, catalog), saleOrder);
  productConfig.auto_badge = false;
  productConfig.paiement_comptant = true;
  productConfig.requires_iban = false;
  productConfig.skip_rib_prompt = true;

  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const classified = classifyMemberContracts(before, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
    skipCancel: false,
  });

  const summary = {
    name: target.name,
    order_id: target.order_id,
    member_id: memberId,
    gym: gymConfig.key || target.gym,
    bot_status: target.bot_status,
    bot_error: target.bot_error,
    before: slimContracts(before),
    needsNewSale: classified.needsNewSale,
    matching: classified.matchingStarted.map((c) => String(c.label).slice(0, 90)),
    pending: classified.matchingPending.map((c) => String(c.label).slice(0, 90)),
    other: classified.otherActive.map((c) => String(c.label).slice(0, 90)),
  };
  console.log('\n===', target.name, '===');
  console.log(JSON.stringify(summary, null, 2));

  if (!classified.needsNewSale && classified.matchingStarted[0]) {
    const idc = String(classified.matchingStarted[0].idc);
    if (!CHECK) {
      await applyBotSaleStatus(target.order_id, {
        deciplus_member_id: memberId,
        deciplus_sale_id: idc,
        status: 'success',
        error: null,
      });
    }
    return { ...summary, skipped: 'already_on_file', sale_id: idc };
  }

  if (CHECK) return { ...summary, skipped: 'check_only' };

  const result = await recordSale(page, saleOrder, productConfig, memberId, gymConfig, {
    badgeProductConfig: null,
    forceNewSale: classified.matchingStarted.length === 0,
  });
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const check = classifyMemberContracts(after, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
  });

  const saleId = result.sale_id || check.matchingStarted[0]?.idc || null;
  await applyBotSaleStatus(target.order_id, {
    deciplus_member_id: memberId,
    deciplus_sale_id: saleId || undefined,
    status: saleId ? 'success' : 'manual_review',
    error: saleId ? null : result.error || 'contrat 12 mois toujours absent',
  });

  return {
    ...summary,
    sale: { action: result.action, sale_id: saleId, error: result.error || null },
    after: slimContracts(after),
    needsNewSaleAfter: check.needsNewSale,
  };
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const targets = await loadTargets();
  console.log(
    'Cibles',
    targets.map((t) => ({
      name: t.name,
      order: t.order_id,
      gym: t.gym,
      member: t.member_id,
      pay: t.pay,
      plan: t.plan,
      bot: t.bot_status,
      sale: t.sale_id,
    }))
  );

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  const report = { at: new Date().toISOString(), check: CHECK, results: [] };
  await runWithSession('fix-259-cauli-saunier', async (page) => {
    try {
      await login(page, { siteLabel: 'Minimes' });
    } catch (err) {
      console.warn('Login retry after zone picker', err.message);
      await login(page, { siteLabel: 'Minimes' });
    }
    const catalog = await fetchDeciplusCatalog(page);
    for (const target of targets) {
      try {
        const out = await repairOne(page, catalog, target);
        report.results.push(out);
        console.log('OK', target.name, out.sale || out.skipped);
      } catch (err) {
        console.error('FAIL', target.name, err.message);
        report.results.push({ name: target.name, order_id: target.order_id, error: err.message });
      }
    }
  });
  await closeBrowser().catch(() => {});
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nRapport', OUT);
  const failed = report.results.filter((r) => r.error || r.needsNewSaleAfter);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
