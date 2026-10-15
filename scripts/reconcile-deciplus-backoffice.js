#!/usr/bin/env node
'use strict';
/**
 * Aligne le backoffice sur Deciplus : contrats déjà posés mais commande en erreur / non signée.
 *
 *   node scripts/reconcile-deciplus-backoffice.js --check
 *   node scripts/reconcile-deciplus-backoffice.js --apply
 *   node scripts/reconcile-deciplus-backoffice.js --apply --since=2026-09-01
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;
delete process.env.BOXPLUS_BOT_URL_SALES_2;

const APPLY = process.argv.includes('--apply');
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const SINCE = sinceArg ? `${sinceArg.split('=')[1]}T00:00:00.000Z` : '2026-09-01T00:00:00.000Z';
const OUT = path.join(__dirname, '..', 'data', `reconcile-deciplus-backoffice-${Date.now()}.json`);

const { getGymConfig } = require('../lib/normalize');
const { syncOrderFromBotProcessed } = require('../lib/bot-sync');
const {
  missingFicheRows,
  botErrorRows,
  enrichOrdersWithJobErrors,
  isNonBlockingBotWarning,
} = require('../storefront/lib/admin-stats');
const { getSupabase } = require('../storefront/lib/supabase');
const {
  listOrdersCreatedSinceAsync,
  loadOrderAsync,
  saveOrderAsync,
  applyBotSaleStatus,
  STEPS,
} = require('../storefront/lib/order-lifecycle');
const { findMemberByIdentity } = require('../bot/member');
const { findActiveContracts } = require('../bot/cancel-sale');
const { ficheRibCleared, openMemberCheck } = require('../bot/wallet');
const { enforceBadgeEcheance } = require('../bot/sale');

const TEST_NAME = /^(test\s|client test|studio rib)/i;

function orderIdentity(order = {}) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  return {
    first_name: short.first_name || full.first_name || '',
    last_name: short.last_name || full.last_name || '',
    email: short.email || full.email || '',
    phone: short.phone || full.phone || '',
    birthdate: short.birthdate || full.birthdate || '',
    gym: order.gym || full.gym || short.gym || '',
  };
}

function paidMs(order = {}) {
  const t = Date.parse(order.payment?.paid_at || order.created_at || '');
  return Number.isFinite(t) ? t : 0;
}

function pickSubscriptionContract(contracts = [], paidAtMs = 0) {
  const abos = (contracts || []).filter((c) => !c.isBadge && !/expir[eé]/i.test(String(c.label || '')));
  if (!abos.length) return null;
  const windowStart = paidAtMs - 21 * 24 * 60 * 60 * 1000;
  const windowEnd = paidAtMs + 45 * 24 * 60 * 60 * 1000;
  const scored = abos.map((c) => {
    const idc = Number(c.idc) || 0;
    const label = String(c.label || '');
    const dates = label.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    let near = 0;
    for (const d of dates) {
      const [dd, mm, yy] = d.split('/').map(Number);
      const ms = new Date(yy, mm - 1, dd).getTime();
      if (ms >= windowStart && ms <= windowEnd) near += 1;
    }
    return { c, idc, near };
  });
  scored.sort((a, b) => b.near - a.near || b.idc - a.idc);
  return scored[0]?.c || abos.sort((a, b) => Number(b.idc) - Number(a.idc))[0];
}

function hasBadgeContract(contracts = []) {
  return (contracts || []).some((c) => c.isBadge && !/expir[eé]/i.test(String(c.label || '')));
}

async function collectCandidates(allPaid = []) {
  const missing = missingFicheRows(allPaid);
  const botErr = botErrorRows(allPaid);
  const byId = new Map();
  for (const row of [...missing, ...botErr]) {
    if (!row.order_id || byId.has(row.order_id)) continue;
    const order = allPaid.find((o) => o.order_id === row.order_id);
    if (!order) continue;
    if (order.manual_migration || order.skip_bot) continue;
    const name = row.name || '';
    if (TEST_NAME.test(name)) continue;
    byId.set(row.order_id, { order, row });
  }
  return [...byId.values()];
}

function findDuplicateSuccess(order, allPaid = []) {
  const id = orderIdentity(order);
  const email = String(id.email || '').toLowerCase();
  const phone = String(id.phone || '').replace(/\D/g, '');
  if (!email && !phone) return null;
  return (
    allPaid.find((o) => {
      if (o.order_id === order.order_id) return false;
      if (String(o.bot_status || '').toLowerCase() !== 'success') return false;
      if (!o.deciplus_member_id && !o.deciplus_sale_id) return false;
      const other = orderIdentity(o);
      if (email && String(other.email || '').toLowerCase() === email) return true;
      const op = String(other.phone || '').replace(/\D/g, '');
      return phone && op && op.slice(-9) === phone.slice(-9);
    }) || null
  );
}

async function applyReconcilePatch(orderId, patch = {}) {
  if (!APPLY) return { order_id: orderId, would_apply: patch };
  const order = await loadOrderAsync(orderId);
  if (!order) return { order_id: orderId, error: 'order_not_found' };

  if (patch.deciplus_member_id) order.deciplus_member_id = String(patch.deciplus_member_id);
  if (patch.deciplus_sale_id) order.deciplus_sale_id = String(patch.deciplus_sale_id);
  if (patch.bot_status) order.bot_status = patch.bot_status;
  if (Object.prototype.hasOwnProperty.call(patch, 'bot_error')) {
    order.bot_error = patch.bot_error ? String(patch.bot_error).slice(0, 500) : null;
  }
  if (patch.signature_backfill && !order.signature?.signed_at) {
    order.signature = {
      method: 'deciplus_reconcile',
      signed_at: order.payment?.paid_at || new Date().toISOString(),
      consent_cgv: true,
      consent_medical: true,
      consent_reglement: true,
    };
    order.step = STEPS.CONFIRMED;
    order.ready_for_dispatch = true;
  }
  if (patch.mark_duplicate) {
    order.manual_migration = true;
    order.skip_bot = true;
    order.reconcile_note = String(patch.mark_duplicate).slice(0, 240);
  }
  if (patch.dispatch_result) {
    order.dispatch_result = { ...(order.dispatch_result || {}), ...patch.dispatch_result };
  }
  if (!order.dispatched_at && patch.deciplus_sale_id) {
    order.dispatched_at = order.dispatched_at || new Date().toISOString();
  }
  order.reconciled_at = new Date().toISOString();
  await saveOrderAsync(order);
  if (patch.bot_status === 'success') {
    await applyBotSaleStatus(orderId, {
      status: 'success',
      deciplus_member_id: order.deciplus_member_id,
      deciplus_sale_id: order.deciplus_sale_id,
      error: null,
      verified: true,
    });
  }
  return { order_id: orderId, applied: true };
}

async function inspectDeciplus(page, order) {
  const identity = orderIdentity(order);
  const gymConfig = getGymConfig(identity.gym || order.gym || 'minimes');
  const hit = await findMemberByIdentity(page, identity, {
    matchFields: ['last_name', 'first_name', 'birthdate', 'phone'],
  });
  if (!hit.found || !hit.member_id) {
    return { found: false, reason: hit.reason || 'not_found' };
  }
  const memberId = String(hit.member_id);
  await openMemberCheck(page, memberId, gymConfig);
  const contracts = await findActiveContracts(page, { includeInactive: true }).catch(() => []);
  const abo = pickSubscriptionContract(contracts, paidMs(order));
  const ribOk = await ficheRibCleared(page, memberId, gymConfig).catch(() => false);
  const badgeOk = hasBadgeContract(contracts);
  let badgeEcheance = null;
  if (badgeOk && /badge|reporter|échéance/i.test(String(order.bot_error || ''))) {
    badgeEcheance = await enforceBadgeEcheance(page, memberId, {
      badge_timing: 'deferred',
      prelevement_delay_days: 3,
      badge_validity_months: 13,
    }).catch((err) => ({ ok: false, reason: err.message }));
  }
  return {
    found: true,
    member_id: memberId,
    sale_id: abo ? String(abo.idc) : null,
    abo_label: abo?.label || null,
    rib_ok: ribOk,
    badge_ok: badgeOk,
    badge_echeance: badgeEcheance,
    contracts: contracts.map((c) => ({ idc: c.idc, badge: c.isBadge, label: String(c.label || '').slice(0, 100) })),
  };
}

function planFix(order, row, deciplus, duplicate) {
  const hasIds = Boolean(order.deciplus_member_id && order.deciplus_sale_id);
  const deciplusReady = Boolean(deciplus?.found && deciplus?.sale_id);

  if (duplicate && !order.signature?.signed_at && !hasIds) {
    return {
      action: 'mark_duplicate',
      mark_duplicate: `Doublon — fiche sur ${duplicate.order_id} (${duplicate.deciplus_member_id})`,
    };
  }

  if (deciplusReady && (!hasIds || !order.deciplus_sale_id)) {
    return {
      action: 'link_deciplus',
      deciplus_member_id: deciplus.member_id,
      deciplus_sale_id: deciplus.sale_id,
      signature_backfill: !order.signature?.signed_at,
      bot_status: 'success',
      bot_error: null,
      dispatch_result: { synced_from_bot: true, reason: 'deciplus_reconcile' },
    };
  }

  if (hasIds || (deciplus?.found && deciplus?.sale_id)) {
    const memberId = order.deciplus_member_id || deciplus?.member_id;
    const saleId = order.deciplus_sale_id || deciplus?.sale_id;
    const err = String(order.bot_error || '');
    const ribIssue = /iban|rib|mandat/i.test(err);
    const badgeIssue = /badge|reporter|échéance/i.test(err);

    if (deciplus?.rib_ok && ribIssue) {
      return {
        action: 'clear_stale_rib',
        deciplus_member_id: memberId,
        deciplus_sale_id: saleId,
        bot_status: 'success',
        bot_error: null,
      };
    }

    if (badgeIssue && (deciplus?.badge_echeance?.ok || deciplus?.badge_ok)) {
      return {
        action: 'clear_stale_badge',
        deciplus_member_id: memberId,
        deciplus_sale_id: saleId,
        bot_status: 'success',
        bot_error: null,
      };
    }

    if (
      saleId &&
      String(order.bot_status || '').toLowerCase() === 'manual_review' &&
      isNonBlockingBotWarning(err)
    ) {
      return {
        action: 'close_manual_review',
        deciplus_member_id: memberId,
        deciplus_sale_id: saleId,
        bot_status: 'success',
        bot_error: null,
      };
    }
  }

  return { action: 'no_change', deciplus };
}

(async () => {
  let orders = await listOrdersCreatedSinceAsync(SINCE);
  orders = await enrichOrdersWithJobErrors(orders, getSupabase());
  const paid = orders.filter((o) => o.payment?.status === 'paid' && !o.action);

  const report = {
    at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'check',
    since: SINCE,
    candidates: [],
    sync_pass: [],
    duplicates_marked: [],
  };

  for (const order of paid) {
    if (order.deciplus_sale_id && String(order.bot_status || '') === 'success' && order.bot_error) {
      if (isNonBlockingBotWarning(order.bot_error)) {
        const fix = {
          action: 'clear_stale_warning',
          order_id: order.order_id,
          bot_error: order.bot_error,
        };
        report.sync_pass.push(fix);
        if (APPLY) {
          await applyBotSaleStatus(order.order_id, {
            status: 'success',
            deciplus_member_id: order.deciplus_member_id,
            deciplus_sale_id: order.deciplus_sale_id,
            error: null,
            verified: true,
          });
        }
      }
    }
    if (!order.deciplus_member_id && !order.deciplus_sale_id && order.dispatched_at) {
      const synced = await syncOrderFromBotProcessed(order.order_id, { order });
      if (synced.synced) report.sync_pass.push({ action: 'sync_from_bot', ...synced });
    }
  }

  const candidates = await collectCandidates(paid);
  console.log(`Candidates admin (hors tests): ${candidates.length}`);

  for (const { order, row } of candidates) {
    const duplicate = findDuplicateSuccess(order, paid);
    if (!duplicate) continue;
    const plan = {
      action: 'mark_duplicate',
      mark_duplicate: `Doublon tunnel — fiche Deciplus sur ${duplicate.order_id} (${duplicate.deciplus_member_id})`,
      deciplus_member_id: duplicate.deciplus_member_id,
      deciplus_sale_id: duplicate.deciplus_sale_id || null,
    };
    report.duplicates_marked.push({ order_id: order.order_id, name: row.name, ...plan });
    if (APPLY) await applyReconcilePatch(order.order_id, plan);
  }

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { switchDeciplusSite } = require('../bot/deciplus-zone');

  const needBrowser = candidates.filter(({ order }) => !findDuplicateSuccess(order, paid));

  if (!APPLY) {
    for (const { order, row } of needBrowser) {
      report.candidates.push({
        order_id: order.order_id,
        name: row.name,
        admin_issue: row.issue || row.reason,
        action: 'would_inspect_deciplus',
      });
    }
  } else if (needBrowser.length) {
    try {
      await runWithSession('reconcile-deciplus-backoffice', async (page) => {
        let loggedSite = '';
        for (const { order, row } of needBrowser) {
          const entry = {
            order_id: order.order_id,
            name: row.name,
            gym: row.gym || order.gym,
            signed: Boolean(order.signature?.signed_at),
            admin_issue: row.issue || row.reason || null,
            bot_status: order.bot_status,
            bot_error: (order.bot_error || '').slice(0, 160),
          };
          try {
            const site = getGymConfig(order.gym)?.deciplus_label || 'Minimes';
            if (site !== loggedSite) {
              try {
                await login(page, { siteLabel: site });
              } catch (err) {
                await switchDeciplusSite(page, site).catch(() => {});
                await login(page, { siteLabel: site }).catch(() => {});
              }
              loggedSite = site;
            }
            const deciplus = await inspectDeciplus(page, order);
            entry.deciplus = deciplus;
            const plan = planFix(order, row, deciplus, null);
            entry.plan = plan;
            if (plan.action !== 'no_change') {
              entry.apply = await applyReconcilePatch(order.order_id, plan);
            }
          } catch (err) {
            entry.error = err.message;
          }
          report.candidates.push(entry);
          console.log(JSON.stringify(entry, null, 2));
        }
      });
    } catch (err) {
      report.browser_error = err.message;
    }
    await closeBrowser().catch(() => {});
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nWrote', OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
