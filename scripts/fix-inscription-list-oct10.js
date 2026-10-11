#!/usr/bin/env node
'use strict';
/**
 * Corrige les cas de la liste admin du 10/10/2026 + sync IDs.
 *
 *   node scripts/fix-inscription-list-oct10.js --check
 *   node scripts/fix-inscription-list-oct10.js --apply
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.BOT_ID = process.env.BOT_ID || 'local-repair-oct10';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;
delete process.env.BOXPLUS_BOT_URL_SALES_2;

const APPLY = process.argv.includes('--apply');
const OUT = path.join(__dirname, '..', 'data', `fix-inscription-list-oct10-${Date.now()}.json`);

const DEFAULT_ORDER_IDS = [
  'BC-1791618098659-a618fe', // Galen
  'BC-1791575904026-054431', // Alicia
  'BC-1791564969483-c06924', // Gaetan
  'BC-1791438974284-2c6f20', // Angelique
  'BC-1790963109925-9e6dd1', // Amine
];
const ORDER_IDS = process.argv.filter((a) => /^BC-/.test(a)).length
  ? process.argv.filter((a) => /^BC-/.test(a))
  : DEFAULT_ORDER_IDS;

const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig, normalizeOrder } = require('../lib/normalize');
const { isValidFrenchIban } = require('../lib/iban');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { resolveProductConfig, fetchDeciplusCatalog } = require('../bot/catalog');
const { syncOrderFromBotProcessed } = require('../lib/bot-sync');
const idempotency = require('../lib/persistent-idempotency');

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

async function loadRows() {
  const sb = getSupabase();
  const rows = [];
  for (const id of ORDER_IDS) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, payload')
      .eq('order_id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      rows.push({ order_id: id, missing: true });
      continue;
    }
    const p = { ...(data.payload || {}), order_id: data.order_id };
    const { data: job } = await sb
      .from('boxplus_job_actions')
      .select('status, lifecycle_state, error_message, member_id, sale_id')
      .eq('order_id', id)
      .eq('action', 'sale')
      .maybeSingle();
    rows.push({
      order_id: data.order_id,
      name: rowName(p),
      gym: p.customer_full?.gym || p.gym,
      email: p.customer_short?.email || p.customer_full?.email,
      phone: p.customer_short?.phone || p.customer_full?.phone,
      product: p.product_snapshot?.name || p.product_name,
      product_id: p.product_id,
      member_id: p.deciplus_member_id || job?.member_id || null,
      sale_id: p.deciplus_sale_id || job?.sale_id || null,
      bot_status: p.bot_status || job?.status || null,
      bot_error: p.bot_error || job?.error_message || null,
      signed: Boolean(p.signature?.signed_at),
      paid: String(p.payment?.status || '').toLowerCase() === 'paid',
      payload: p,
    });
  }
  return rows;
}

async function stealLease(orderId, { memberId = null } = {}) {
  try {
    const sb = getSupabase();
    const owner = process.env.BOT_ID || 'local-repair-oct10';
    await sb
      .from('boxplus_job_actions')
      .update({
        status: 'processing',
        lifecycle_state: null,
        member_id: memberId || undefined,
        sale_id: null,
        error_message: null,
        completed_at: null,
        worker_id: owner,
        lease_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        attempt: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('action', 'sale');
    return await idempotency.acquire(orderId, 'sale');
  } catch (err) {
    return { acquired: false, reason: err.message };
  }
}

async function repairOne(page, catalog, row) {
  const report = {
    order_id: row.order_id,
    name: row.name,
    gym: row.gym,
    before: {
      member_id: row.member_id,
      sale_id: row.sale_id,
      bot_status: row.bot_status,
      bot_error: (row.bot_error || '').slice(0, 220),
      signed: row.signed,
      paid: row.paid,
    },
  };

  if (row.missing) {
    report.action = 'missing_order';
    return report;
  }

  // Déjà OK — sauf Alicia encore collée à Soheil 22870 / vente 45846
  if (row.member_id && row.sale_id) {
    const wrongAlicia =
      row.order_id === 'BC-1791575904026-054431' &&
      String(row.member_id) === '22870';
    if (!wrongAlicia) {
      report.action = 'already_ok';
      return report;
    }
    report.wrong_member = true;
  }

  // Sync d'abord (IDs déjà côté bot / job_actions)
  const synced = await syncOrderFromBotProcessed(row.order_id, { order: row.payload });
  if (synced.synced && synced.deciplus_sale_id) {
    report.action = 'synced_from_bot';
    report.synced = synced;
    return report;
  }

  if (!row.paid) {
    report.action = 'skip_unpaid';
    return report;
  }

  if (!APPLY) {
    report.action = 'would_process_sale';
    report.sync_attempt = synced;
    return report;
  }

  const lease = await stealLease(row.order_id, { memberId: row.member_id || null });
  report.lease = {
    acquired: Boolean(lease?.acquired),
    reason: lease?.reason || null,
    member_id: lease?.member_id || null,
  };
  if (!lease?.acquired && lease?.reason === 'completed') {
    report.action = 'lease_still_completed';
    return report;
  }

  const hydrated = await hydrateOrderMedia(row.payload);
  const product = hydrated.product_snapshot || { id: row.product_id, name: row.product };
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  payload.force_requeue = true;
  payload.force_sale_retry = true;
  // Amine non signé : forcer la vente si fiche déjà connue / payé
  if (!payload.signature?.signed_at && row.member_id) {
    payload.deciplus_member_id = String(row.member_id);
    payload.force_sale_unsigned = true;
    payload.notify_change_complete = true; // contourne boutiqueSaleDispatchAllowed
  } else if (!payload.signature?.signed_at) {
    payload.notify_change_complete = true;
    payload.force_sale_unsigned = true;
  }
  if (lease?.member_id) payload.deciplus_member_id = String(lease.member_id);
  if (row.member_id) payload.deciplus_member_id = String(row.member_id);

  // Sans IBAN (inscription non finalisée) : vente Deciplus en comptant, 1er mois déjà payé.
  const hasIban = Boolean(payload.payment?.iban && isValidFrenchIban(payload.payment.iban));
  if (!hasIban && String(payload.payment?.status || '').toLowerCase() === 'paid') {
    payload.payment = {
      ...(payload.payment || {}),
      billing_plan: 'comptant',
      payment_plan: 'once',
      iban: null,
    };
    payload.billing_plan = 'comptant';
    payload.force_comptant = true;
  }

  const order = normalizeOrder(payload);
  if (order.payment?.iban && !isValidFrenchIban(order.payment.iban)) {
    order.payment.iban = null;
  }
  if (payload.force_comptant) {
    order.payment = order.payment || {};
    order.payment.billing_plan = 'comptant';
    order.billing_plan = 'comptant';
  }

  const { processSaleJob } = require('../bot/index');
  const outcome = await processSaleJob(page, order, {});
  await applyBotSaleStatus(row.order_id, {
    deciplus_member_id: outcome.deciplus_member_id || row.member_id || undefined,
    deciplus_sale_id: outcome.deciplus_sale_id || undefined,
    status: outcome.deciplus_sale_id ? 'success' : outcome.status || 'manual_review',
    error: outcome.deciplus_sale_id ? null : outcome.error || null,
  });

  report.action = 'processed';
  report.outcome_status = outcome.status;
  report.outcome_member = outcome.deciplus_member_id || null;
  report.outcome_sale = outcome.deciplus_sale_id || null;
  report.outcome_error = outcome.error || null;
  return report;
}

async function syncCohortDispatched() {
  const sb = getSupabase();
  const since = '2026-09-25T00:00:00.000Z';
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, payload, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) throw error;
  const targets = (data || [])
    .map((r) => ({ ...(r.payload || {}), order_id: r.order_id }))
    .filter((p) => String(p.payment?.status || '').toLowerCase() === 'paid')
    .filter((p) => p.dispatched_at && !p.deciplus_member_id && !p.deciplus_sale_id)
    .slice(0, 40);

  const results = [];
  for (const order of targets) {
    if (!APPLY) {
      results.push({ order_id: order.order_id, action: 'would_sync' });
      continue;
    }
    const synced = await syncOrderFromBotProcessed(order.order_id, { order });
    results.push({ order_id: order.order_id, ...synced });
  }
  return { scanned: targets.length, results };
}

(async () => {
  const rows = await loadRows();
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'check',
        summary: rows.map((r) => ({
          name: r.name || null,
          order_id: r.order_id,
          member_id: r.member_id,
          sale_id: r.sale_id,
          signed: r.signed,
          bot_error: (r.bot_error || '').slice(0, 120),
        })),
      },
      null,
      2
    )
  );

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const report = {
    at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'check',
    results: [],
    sync_cohort: null,
  };

  const needBrowser = APPLY && rows.some((r) => !r.missing && !(r.member_id && r.sale_id) && r.paid);
  if (needBrowser) {
    const { login } = require('../bot/auth');
    const { runWithSession, closeBrowser } = require('../bot/browser-pool');
    for (const row of rows) {
      if (row.missing || (row.member_id && row.sale_id) || !row.paid) {
        const one = await repairOne(null, null, row);
        report.results.push(one);
        console.log(JSON.stringify(one, null, 2));
        continue;
      }
      console.log('\n===', row.name || '?', row.order_id, '===');
      try {
        await runWithSession(`fix-oct10-${row.order_id}`, async (page) => {
          const { switchDeciplusSite } = require('../bot/deciplus-zone');
          const site = getGymConfig(row.gym)?.deciplus_label || 'Minimes';
          try {
            await login(page, { siteLabel: site });
          } catch (err) {
            console.warn('login retry after', err.message);
            await switchDeciplusSite(page, site).catch(() => {});
          }
          const catalog = await fetchDeciplusCatalog(page);
          const one = await repairOne(page, catalog, row);
          report.results.push(one);
          console.log(JSON.stringify(one, null, 2));
        });
      } catch (err) {
        const fail = { order_id: row.order_id, name: row.name, error: err.message };
        report.results.push(fail);
        console.error('FAIL', row.name, err.message);
      }
      await closeBrowser().catch(() => {});
    }
  } else {
    for (const row of rows) {
      const one = await repairOne(null, null, row);
      report.results.push(one);
      console.log(JSON.stringify(one, null, 2));
    }
  }

  report.sync_cohort = await syncCohortDispatched();
  console.log('\nSYNC COHORT', JSON.stringify(report.sync_cohort, null, 2));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nWrote', OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
