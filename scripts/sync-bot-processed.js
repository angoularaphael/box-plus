#!/usr/bin/env node
'use strict';
/**
 * Resynchronise les IDs Deciplus depuis le bot vers Supabase.
 *
 *   node scripts/sync-bot-processed.js --check
 *   node scripts/sync-bot-processed.js --fix
 *   node scripts/sync-bot-processed.js --fix --order=BC-xxx
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const { getSupabase } = require('../storefront/lib/supabase');
const { deciplusSaleSettled } = require('../storefront/lib/deciplus-sale-reconcile');
const { syncOrderFromBotProcessed } = require('../lib/bot-sync');

const CHECK = !process.argv.includes('--fix');
const ORDER = (process.argv.find((a) => a.startsWith('--order=')) || '').slice(8);
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-01';

async function loadPaidOrders() {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const createdSince = new Date(Date.parse(`${SINCE}T00:00:00.000Z`) - 45 * 24 * 3600 * 1000).toISOString();
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', createdSince)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return all
    .map((r) => ({ ...(r.payload || {}), order_id: r.order_id }))
    .filter((p) => String(p.payment?.status || '').toLowerCase() === 'paid')
    .filter((p) => !deciplusSaleSettled(p));
}

async function main() {
  const orders = ORDER
    ? [{ order_id: ORDER }]
    : await loadPaidOrders();
  const results = [];
  for (const order of orders) {
    const id = order.order_id;
    const synced = await syncOrderFromBotProcessed(id, { order });
    results.push({ order_id: id, ...synced });
    if (!CHECK && synced.synced) {
      console.log('OK', id, synced.deciplus_member_id, synced.deciplus_sale_id);
    }
  }
  const fixable = results.filter((r) => r.synced);
  const candidates = results.filter((r) => r.reason === 'no_processed_record' || r.reason === 'no_deciplus_ids');
  console.log(
    JSON.stringify(
      {
        mode: CHECK ? 'check' : 'fix',
        scanned: results.length,
        synced: fixable.length,
        still_missing: candidates.length,
        sample: results.slice(0, 20),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
