#!/usr/bin/env node
'use strict';
/**
 * Vide la file prem-eu1, vérifie les fiches Deciplus, relance le rattrapage.
 *
 *   node scripts/flush-bot-queue-catchup.js --stats
 *   node scripts/flush-bot-queue-catchup.js --clear-remote
 *   node scripts/flush-bot-queue-catchup.js --audit --since=2026-09-07
 *   node scripts/flush-bot-queue-catchup.js --audit --fix-fares
 *   node scripts/flush-bot-queue-catchup.js --dispatch --since=2026-09-07
 *   node scripts/flush-bot-queue-catchup.js --all --since=2026-09-07
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig, normalizeOrder } = require('../lib/normalize');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { forwardJobToBot } = require('../lib/bot-forward');
const {
  productRequiresDeciplusSale,
  deciplusSaleSettled,
} = require('../storefront/lib/deciplus-sale-reconcile');
const { saleContractMatches } = require('../lib/sale-contract-match');
const { resolveProductConfig } = require('../bot/catalog');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');

const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-09-07';
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0);
const BOT_BASE = (
  process.argv.find((a) => a.startsWith('--bot='))?.slice(6) ||
  process.env.BOXPLUS_BOT_URL ||
  'http://prem-eu1.bot-hosting.net:20311'
).replace(/\/$/, '');
const SECRET = process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';
const FARES_ORDER = 'BC-1786789882131-ad43db';
const OUT = path.join(__dirname, '..', 'data', `flush-catchup-${Date.now()}.json`);

const DO_STATS = process.argv.includes('--stats');
const DO_CLEAR = process.argv.includes('--clear-remote') || process.argv.includes('--all');
const DO_AUDIT = process.argv.includes('--audit') || process.argv.includes('--all');
const DO_DISPATCH = process.argv.includes('--dispatch') || process.argv.includes('--all');
const FIX_FARES = process.argv.includes('--fix-fares') || process.argv.includes('--all');

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function gymLabel(slug) {
  try {
    return getGymConfig(slug).deciplus_label;
  } catch {
    return String(slug || 'Minimes');
  }
}

function needsBot(p) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (!productRequiresDeciplusSale(p)) return false;
  if (deciplusSaleSettled(p)) return false;
  if (!p.signature?.signed_at) return false;
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  if (!cs.first_name && !cf.first_name) return false;
  if (!cs.last_name && !cf.last_name) return false;
  return true;
}

async function botFetch(pathSuffix, body) {
  const opts = {
    headers: { 'x-sync-secret': SECRET, 'Content-Type': 'application/json' },
  };
  if (body) {
    opts.method = 'POST';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BOT_BASE}${pathSuffix}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} ${pathSuffix}`);
  return data;
}

async function loadOrdersSince() {
  const sb = getSupabase();
  const since = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all
    .map((r) => {
      const p = r.payload || {};
      p.order_id = p.order_id || r.order_id;
      return { order_id: r.order_id, created_at: r.created_at, payload: p };
    })
    .filter((r) => /^BC-/i.test(r.order_id) && needsBot(r.payload));
}

function buildProductConfig(row, catalog) {
  const order = buildOrderFromLifecycle(row.payload, row.payload.product_snapshot || { id: row.payload.product_id });
  const cfg = resolveProductConfig(order, catalog);
  return applyBillingPlanToProductConfig(cfg, row.payload);
}

async function auditDeciplus(rows) {
  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { searchMember, searchMemberByName } = require('../bot/member');
  const { switchDeciplusSite } = require('../bot/deciplus-zone');
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  const report = { synced: [], missing: [], errors: [] };

  await runWithSession('flush-catchup-audit', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    const catalog = await fetchDeciplusCatalog(page);
    let n = 0;
    for (const row of rows) {
      if (LIMIT > 0 && n >= LIMIT) break;
      n += 1;
      const p = row.payload;
      const name = rowName(p);
      const gym = p.customer_full?.gym || p.gym || 'minimes';
      const site = gymLabel(gym);
      const productConfig = buildProductConfig(row, catalog);
      try {
        await closeGreyboxIfOpen(page).catch(() => {});
        await switchDeciplusSite(page, site);
        let hit = await searchMember(page, p.customer_short?.email || p.customer_full?.email || '');
        if (!hit?.found) {
          const parts = name.split(/\s+/);
          const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
          const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
          hit = await searchMemberByName(page, last, first);
        }
        if (!hit?.found || !hit.member_id) {
          report.missing.push({ order_id: row.order_id, name, gym, reason: 'not_in_deciplus' });
          continue;
        }
        const gymCfg = getGymConfig(gym);
        await openMemberCheck(page, hit.member_id, gymCfg);
        const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
        const abo = contracts.filter((c) => !c.isBadge);
        const match = abo.find((c) => saleContractMatches(c.label, productConfig)) || abo[abo.length - 1];
        if (!match) {
          report.missing.push({
            order_id: row.order_id,
            name,
            member_id: hit.member_id,
            reason: 'member_no_matching_contract',
            labels: abo.map((c) => String(c.label || '').slice(0, 80)),
          });
          continue;
        }
        await applyBotSaleStatus(row.order_id, {
          deciplus_member_id: String(hit.member_id),
          deciplus_sale_id: String(match.idc),
          status: 'success',
          error: null,
        });
        report.synced.push({ order_id: row.order_id, name, member_id: hit.member_id, sale_id: match.idc });
        console.log('SYNC', name, hit.member_id, match.idc);
      } catch (err) {
        report.errors.push({ order_id: row.order_id, name, error: err.message.slice(0, 160) });
        console.error('ERR', row.order_id, err.message);
      }
    }
  });
  await require('../bot/browser-pool').closeBrowser().catch(() => {});
  return report;
}

async function fixFaresAmamra() {
  const sb = getSupabase();
  const { data } = await sb.from('boxplus_orders').select('payload').eq('order_id', FARES_ORDER).single();
  const p = data?.payload || {};
  const wrongMember = String(p.deciplus_member_id || '') === '3911';
  if (!wrongMember) {
    console.log('fares: pas de membre 3911 — skip');
    return { skipped: true };
  }
  await applyBotSaleStatus(FARES_ORDER, {
    deciplus_member_id: null,
    deciplus_sale_id: null,
    status: 'manual_review',
    error:
      'Mauvaise fiche Deciplus (3911, créée 2019) — match téléphone erroné. Date naissance manquante. Corriger à Portet puis relancer.',
  });
  if (SECRET && BOT_BASE) {
    try {
      await botFetch('/api/queue/clear', {
        unmark_ids: [FARES_ORDER],
        mark_processed: [
          {
            order_id: FARES_ORDER,
            status: 'manual_review',
            error: 'blocked_wrong_member_3911',
          },
        ],
      });
    } catch (err) {
      console.warn('fares queue clear remote:', err.message);
    }
  }
  console.log('fares: délié de 3911 — manual_review (date naissance requise)');
  return { fixed: true, order_id: FARES_ORDER };
}

async function clearRemoteQueue(rows) {
  const markProcessed = [];
  const unmarkIds = [];
  for (const row of rows) {
    const p = row.payload;
    if (deciplusSaleSettled(p)) {
      markProcessed.push({
        order_id: row.order_id,
        status: 'success',
        deciplus_member_id: p.deciplus_member_id,
        deciplus_sale_id: p.deciplus_sale_id,
      });
    } else {
      unmarkIds.push(row.order_id);
    }
  }
  unmarkIds.push(FARES_ORDER);

  const body = {
    stale_processing_ms: 90 * 1000,
    include_processed: true,
    unmark_ids: [...new Set(unmarkIds)],
    mark_processed: markProcessed,
  };

  try {
    const result = await botFetch('/api/queue/clear', body);
    console.log('queue_cleared', result.cleared?.length || 0, 'unmarked', result.unmarked?.length || 0);
    return result;
  } catch (err) {
    console.warn('clear API indisponible — fallback cancel par job:', err.message);
    const spamIds = [
      FARES_ORDER,
      'BC-1786783739376-58c7d3',
      ...rows.map((r) => r.order_id),
    ];
    const cancelled = [];
    for (const id of [...new Set(spamIds)]) {
      try {
        const r = await botFetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
          reason: 'flush_queue_catchup',
        });
        cancelled.push({ order_id: id, ...r });
      } catch {
        /* absent */
      }
    }
    return { fallback: true, cancelled };
  }
}

async function dispatchMissing(rows) {
  const pending = rows.filter((r) => !deciplusSaleSettled(r.payload));
  const results = [];
  for (const row of pending) {
    if (row.order_id === FARES_ORDER) continue;
    const p = row.payload;
    const hydrated = await hydrateOrderMedia(p);
    const product = p.product_snapshot || { id: p.product_id };
    const built = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
    built.force_requeue = true;
    built.force_sale_retry = true;
    delete built.deciplus_member_id;
    delete built.deciplus_sale_id;
    if (/259|12\s*mois|promo 12|dp-100|offre-saison/i.test(`${product.name || ''} ${p.product_id || ''}`)) {
      built.deciplus_product_search = 'OFFRE PROMO 12MOIS';
      built.paiement_comptant = true;
    }
    try {
      const sent = await forwardJobToBot(normalizeOrder(built));
      results.push({ order_id: row.order_id, name: rowName(p), ...sent });
      console.log('DISPATCH', rowName(p), sent.queued !== false ? 'queued' : sent.reason);
    } catch (err) {
      results.push({ order_id: row.order_id, error: err.message });
      console.error('DISPATCH_FAIL', row.order_id, err.message);
    }
  }
  return results;
}

async function main() {
  if (!SECRET) throw new Error('SYNC_SECRET manquant dans .env');
  const report = { at: new Date().toISOString(), since: SINCE, bot: BOT_BASE };

  if (DO_STATS) {
    report.stats = await botFetch('/api/queue/stats');
    try {
      report.pending = await botFetch('/api/queue/pending');
    } catch {
      report.pending = { note: 'endpoint /api/queue/pending pas encore déployé sur le bot distant' };
    }
    console.log(JSON.stringify(report.stats, null, 2));
  }

  const rows = await loadOrdersSince();
  report.candidates = rows.length;
  console.log(`Candidats signés/payés sans vente : ${rows.length} (depuis ${SINCE})`);

  if (FIX_FARES) report.fares = await fixFaresAmamra();

  if (DO_CLEAR) report.clear = await clearRemoteQueue(rows);

  if (DO_AUDIT) {
    const still = rows.filter((r) => !deciplusSaleSettled(r.payload) && r.order_id !== FARES_ORDER);
    report.audit = await auditDeciplus(still);
    console.log(
      'audit',
      'synced',
      report.audit.synced.length,
      'missing',
      report.audit.missing.length,
      'errors',
      report.audit.errors.length
    );
  }

  if (DO_DISPATCH) {
    const fresh = await loadOrdersSince();
    report.dispatch = await dispatchMissing(fresh);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('WROTE', OUT);
}

if (!DO_STATS && !DO_CLEAR && !DO_AUDIT && !DO_DISPATCH && !FIX_FARES) {
  console.log('Usage: --stats | --clear-remote | --audit | --dispatch | --fix-fares | --all --since=YYYY-MM-DD');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
