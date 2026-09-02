#!/usr/bin/env node
'use strict';
/**
 * Audit / réparation : abonnements payés depuis le 28 août sans fiche/vente Deciplus.
 *
 *   node scripts/audit-paid-missing-deciplus.js --check
 *   node scripts/audit-paid-missing-deciplus.js --fix
 *   node scripts/audit-paid-missing-deciplus.js --fix --only=dupont
 *   node scripts/audit-paid-missing-deciplus.js --fix --limit=5
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
const { isAventureOrder } = require('../lib/aventure-policy');
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const {
  productRequiresDeciplusSale,
  deciplusSaleSettled,
} = require('../storefront/lib/deciplus-sale-reconcile');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { normalizeOrder } = require('../lib/normalize');

const CHECK = process.argv.includes('--check') || !process.argv.includes('--fix');
const FIX = process.argv.includes('--fix');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-28';
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const ONLY_LIST = ONLY.split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.join(__dirname, '..', 'data', `audit-paid-missing-deciplus-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  const c = p.customer || {};
  return `${cs.first_name || cf.first_name || c.first_name || ''} ${
    cs.last_name || cf.last_name || c.last_name || ''
  }`
    .replace(/\s+/g, ' ')
    .trim();
}

function isTestName(name, email) {
  const hay = `${name} ${email}`.toLowerCase();
  return /\btest\b|boxplus-test|@boxplus-test\.local/.test(hay);
}

function isEssaiProduct(row) {
  return /s[eé]ance d['’]?essai|seance-essai/i.test(
    `${row.product || ''} ${row.product_id || ''} ${row.payload?.product_snapshot?.name || ''}`
  );
}

function isMaterielOrder(p) {
  const id = String(p.order_id || '');
  if (/^MAT-/i.test(id)) return true;
  if (p.action === 'materiel') return true;
  const snap = p.product_snapshot || {};
  return snap.tab === 'materiel' || /materiel/i.test(String(snap.sale_type || ''));
}

function isActionOrder(p) {
  const id = String(p.order_id || '');
  if (/^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(id)) return true;
  const action = String(p.action || '').toLowerCase();
  return Boolean(action && !['sale', 'balma_switch'].includes(action));
}

function paidAt(p, createdAt) {
  return p.payment?.paid_at || p.payment?.date || createdAt || null;
}

function identityReady(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  const c = p.customer || {};
  const first = cs.first_name || cf.first_name || c.first_name;
  const last = cs.last_name || cf.last_name || c.last_name;
  const birth = cs.birthdate || cf.birthdate || c.birthdate;
  const gym = cf.gym || p.gym || c.gym;
  return Boolean(first && last && birth && gym);
}

function classifyGap(p) {
  if (deciplusSaleSettled(p)) return 'ok_sale_or_manual';
  if (p.deciplus_member_id && !p.deciplus_sale_id) return 'member_no_sale';
  if (!p.deciplus_member_id) return 'no_member';
  return 'unknown';
}

function whyMissing(p) {
  const reasons = [];
  if (!p.signature?.signed_at && !p.ready_for_dispatch && !isAventureOrder(p)) {
    reasons.push('unsigned');
  }
  if (isAventureOrder(p) && !identityReady(p)) reasons.push('aventure_dossier_incomplet');
  if (!identityReady(p)) reasons.push('identity_incomplete');
  if (p.dispatched_at && !p.deciplus_sale_id) reasons.push('dispatched_without_sale');
  if (p.bot_error) reasons.push(`bot_error:${String(p.bot_error).slice(0, 120)}`);
  if (p.bot_status) reasons.push(`bot_status:${p.bot_status}`);
  if (Number(p.sale_reconcile_attempts || 0) >= 12) reasons.push('retries_exhausted');
  if (!p.dispatched_at) reasons.push('never_dispatched');
  return reasons;
}

async function loadPaidSubscriptions() {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const createdSince = new Date(Date.parse(`${SINCE}T00:00:00.000Z`) - 60 * 24 * 3600 * 1000)
    .toISOString();
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', createdSince)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }

  const paid = [];
  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    p.created_at = p.created_at || r.created_at;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (isActionOrder(p) || isMaterielOrder(p)) continue;
    if (!productRequiresDeciplusSale(p)) continue;
    const name = rowName(p);
    const email = p.customer_short?.email || p.customer_full?.email || p.customer?.email || '';
    if (isTestName(name, email)) continue;
    const when = paidAt(p, r.created_at);
    if (when && Date.parse(when) < Date.parse(`${SINCE}T00:00:00.000Z`)) continue;
    paid.push({
      order_id: r.order_id,
      created_at: r.created_at,
      paid_at: when,
      name,
      email,
      phone: p.customer_short?.phone || p.customer_full?.phone || '',
      birthdate: p.customer_short?.birthdate || p.customer_full?.birthdate || '',
      gym: p.customer_full?.gym || p.gym || '',
      product_id: p.product_id || p.product_snapshot?.id || null,
      product: p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || '',
      sale_type: p.product_snapshot?.sale_type || p.sale_type || null,
      amount: p.payment?.amount || p.product_snapshot?.price_cents || null,
      method: p.payment?.method || null,
      plan: p.payment?.payment_plan || p.payment?.billing_plan || null,
      signed: p.signature?.signed_at || null,
      dispatched_at: p.dispatched_at || null,
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      bot_error: p.bot_error || null,
      sale_reconcile_attempts: Number(p.sale_reconcile_attempts || 0) || 0,
      aventure: isAventureOrder(p),
      source: p.source || null,
      identity_ready: identityReady(p),
      gap: classifyGap(p),
      why: whyMissing(p),
      payload: p,
    });
  }
  return paid;
}

function slimContracts(list) {
  return (list || []).map((c) => ({
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
}

function productForOrder(row) {
  return row.payload.product_snapshot || {
    id: row.product_id,
    name: row.product,
    sale_type: row.sale_type || 'abonnement',
  };
}

function logFallback(message, row) {
  console.warn(message, row.order_id, row.name);
}

async function repairOne(page, catalog, row) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  const { resolveProductConfig } = require('../bot/catalog');
  const { detectMemberGymConfig } = require('../bot/member');
  const { processSaleJob } = require('../bot/index');
  const { runBalmaSwitch } = require('../bot/aventure-clone');

  const hydrated = await hydrateOrderMedia(row.payload);
  const product = productForOrder(row);
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  if (row.member_id) payload.deciplus_member_id = String(row.member_id);
  if (/259|12\s*mois|promo 12/i.test(`${row.product} ${row.product_id}`)) {
    payload.deciplus_product_search = 'OFFRE PROMO 12MOIS';
    payload.paiement_comptant = true;
  }
  payload.force_requeue = true;
  payload.force_sale_retry = true;
  const order = normalizeOrder(payload);
  if (!order.customer.gender && /marie/i.test(String(order.customer.first_name || ''))) {
    order.customer.gender = 'F';
  }

  console.log('\n===', row.name, row.order_id, '===');
  console.log({
    gym: row.gym,
    product: row.product,
    member: row.member_id,
    sale: row.sale_id,
    bot: row.bot_status,
    why: row.why,
  });

  if (FIX) {
    let outcome;
    if (row.aventure && !row.member_id) {
      payload.action = 'balma_switch';
      payload.gym = payload.gym || 'minimes';
      const switchOrder = normalizeOrder(payload);
      outcome = await runBalmaSwitch(page, switchOrder);
      if (!outcome?.deciplus_sale_id) {
        logFallback('Aventure sans vente Minimes — vente boutique directe', row);
        const cs = row.payload.customer_short || {};
        const cf = row.payload.customer_full || {};
        order.customer = {
          ...order.customer,
          email: String(cs.email || cf.email || order.customer.email || '').trim(),
          phone: cs.phone || cf.phone || order.customer.phone,
        };
        order.gym = order.gym || 'minimes';
        outcome = await processSaleJob(page, order, {});
      }
    } else {
      outcome = await processSaleJob(page, order, {});
    }
    const saleId = outcome.deciplus_sale_id || null;
    const memberId = outcome.deciplus_member_id || row.member_id || null;
    await applyBotSaleStatus(row.order_id, {
      deciplus_member_id: memberId,
      deciplus_sale_id: saleId || undefined,
      status: saleId ? 'success' : outcome.status || 'manual_review',
      error: saleId ? null : outcome.error || 'vente Deciplus absente après rattrapage',
    });
    return {
      order_id: row.order_id,
      name: row.name,
      outcome: {
        status: outcome.status,
        member_id: memberId,
        sale_id: saleId,
        sale_action: outcome.sale_action || outcome.action || null,
        member_action: outcome.member_action || null,
        error: outcome.error || null,
      },
    };
  }

  // Check-only: inspect Deciplus if we already have a member id.
  if (!row.member_id) {
    return { order_id: row.order_id, name: row.name, skipped: 'no_member_id_check_only' };
  }
  let gymConfig = getGymConfig(row.gym || 'minimes');
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, String(row.member_id), gymConfig);
  const site = await detectMemberGymConfig(page, gymConfig).catch(() => null);
  if (site?.deciplus_label) gymConfig = site;
  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
  const classified = classifyMemberContracts(before, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
  });
  return {
    order_id: row.order_id,
    name: row.name,
    member_id: row.member_id,
    gym: gymConfig.key || row.gym,
    contracts: slimContracts(before),
    needsNewSale: classified.needsNewSale,
    matching: classified.matchingStarted.map((c) => String(c.label).slice(0, 90)),
  };
}

async function main() {
  const paid = await loadPaidSubscriptions();
  const missing = paid.filter((r) => r.gap !== 'ok_sale_or_manual');
  const filtered = missing.filter((r) => {
    if (isEssaiProduct(r)) return false;
    if (ONLY_LIST.length && !ONLY_LIST.some((n) => `${r.name} ${r.order_id} ${r.email}`.toLowerCase().includes(n))) {
      return false;
    }
    return true;
  });
  const targets = LIMIT > 0 ? filtered.slice(0, LIMIT) : filtered;

  const summary = {
    since: SINCE,
    paid_subscriptions: paid.length,
    with_sale: paid.filter((r) => r.sale_id).length,
    missing: missing.length,
    member_no_sale: missing.filter((r) => r.gap === 'member_no_sale').length,
    no_member: missing.filter((r) => r.gap === 'no_member').length,
    unsigned_missing: missing.filter((r) => r.why.includes('unsigned')).length,
    dispatched_without_sale: missing.filter((r) => r.why.includes('dispatched_without_sale')).length,
    by_product: {},
    by_error: {},
    missing_rows: missing.map((r) => ({
      order_id: r.order_id,
      paid_at: r.paid_at,
      name: r.name,
      gym: r.gym,
      product: r.product,
      member_id: r.member_id,
      sale_id: r.sale_id,
      signed: Boolean(r.signed),
      dispatched: Boolean(r.dispatched_at),
      identity_ready: r.identity_ready,
      bot_status: r.bot_status,
      bot_error: r.bot_error,
      why: r.why,
      gap: r.gap,
      aventure: r.aventure,
    })),
  };
  for (const r of missing) {
    const key = r.product || '(sans offre)';
    summary.by_product[key] = (summary.by_product[key] || 0) + 1;
    const err = r.bot_error ? String(r.bot_error).slice(0, 80) : r.bot_status || 'no_bot';
    summary.by_error[err] = (summary.by_error[err] || 0) + 1;
  }

  console.log(JSON.stringify({ ...summary, missing_rows: undefined }, null, 2));
  console.log('\nManquants:');
  for (const r of summary.missing_rows) {
    console.log(
      `- ${r.paid_at?.slice(0, 10)} ${r.name} | ${r.product} | ${r.gym} | ${r.gap} | ${r.why.join(', ')} | ${r.order_id}`
    );
  }

  if (!FIX && !process.argv.includes('--inspect')) {
    fs.writeFileSync(OUT, JSON.stringify({ ...summary, check: true }, null, 2));
    console.log('\nRapport:', OUT);
    return;
  }

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  const report = { at: new Date().toISOString(), check: CHECK && !FIX, fix: FIX, results: [], summary };
  await runWithSession('audit-paid-missing-deciplus', async (page) => {
    try {
      await login(page, { siteLabel: 'Minimes' });
      const catalog = await fetchDeciplusCatalog(page);
      for (const row of targets) {
        try {
          const result = await repairOne(page, catalog, row);
          report.results.push(result);
          console.log(JSON.stringify(result.outcome || result, null, 2));
        } catch (err) {
          const fail = { order_id: row.order_id, name: row.name, error: err.message };
          report.results.push(fail);
          console.error('FAIL', row.name, err.message);
          try {
            await applyBotSaleStatus(row.order_id, {
              deciplus_member_id: row.member_id || undefined,
              status: 'manual_review',
              error: err.message,
            });
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      await closeBrowser().catch(() => {});
    }
  });

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nRapport:', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
