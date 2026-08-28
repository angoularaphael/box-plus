'use strict';

/**
 * Rattrapage WhatsApp reprise — offres 29 € non payées, bot déconnecté.
 * Usage : node scripts/backfill-offre29-resume-whatsapp.js [--since=2026-08-20] [--dry]
 */
require('dotenv').config();

const { getSupabase } = require('../storefront/lib/supabase');
const { isOffre29Order } = require('../storefront/lib/referral-notify');
const { getWhatsAppStatus } = require('../storefront/lib/whatsapp-bot');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const { canPayOrder, sendResumeWhatsApp } = require('../storefront/lib/inscription-nudge');

const SINCE = process.argv.find((a) => a.startsWith('--since='))?.slice(8) || '2026-08-20T00:00:00.000Z';
const DRY = process.argv.includes('--dry');

function alreadySent(order) {
  return Boolean(
    order?.funnel?.resume_whatsapp_sent_at ||
      order?.funnel?.nudge_whatsapp_sent_at ||
      order?.funnel?.resume_whatsapp_backfill_at
  );
}

async function listSince(sinceIso) {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const page = 200;
  while (true) {
    const to = from + page - 1;
    const { data, error } = await sb
      .from('boxplus_orders')
      .select(
        [
          'order_id',
          'created_at',
          'product_id:payload->product_id',
          'product_snapshot:payload->product_snapshot',
          'payment:payload->payment',
          'customer_short:payload->customer_short',
          'funnel:payload->funnel',
          'access_token:payload->access_token',
          'step:payload->step',
        ].join(',')
      )
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return all.filter((row) => {
    if (!isOffre29Order(row)) return false;
    const st = String(row.payment?.status || 'pending').toLowerCase();
    if (st === 'paid' || st === 'free') return false;
    if (!row.customer_short?.phone && !row.customer_short?.telephone) return false;
    if (alreadySent(row)) return false;
    return true;
  });
}

async function main() {
  const status = await getWhatsAppStatus();
  const rows = await listSince(SINCE);
  console.log(JSON.stringify({ wa: { connected: status.connected, reachable: status.reachable }, since: SINCE, dry: DRY, candidates: rows.length }));
  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    const order = await loadOrderAsync(row.order_id);
    if (!order || !canPayOrder(order) || alreadySent(order)) {
      skipped += 1;
      continue;
    }
    const summary = {
      order_id: order.order_id,
      prenom: order.customer_short?.first_name || '',
      created_at: row.created_at,
    };
    if (DRY) {
      console.log(JSON.stringify({ dry: true, ...summary }));
      continue;
    }
    if (!status.connected) {
      console.log(JSON.stringify({ skipped: 'wa_disconnected', ...summary }));
      continue;
    }
    try {
      const out = await sendResumeWhatsApp(order, { kind: 'resume' });
      if (!out.sent) {
        console.log(JSON.stringify({ sent: false, error: out.error, ...summary }));
        continue;
      }
      order.funnel = {
        ...(order.funnel || {}),
        resume_whatsapp_sent_at: new Date().toISOString(),
        resume_whatsapp_backfill_at: new Date().toISOString(),
      };
      await saveOrderAsync(order);
      sent += 1;
      console.log(JSON.stringify({ sent: true, to: out.to, ...summary }));
      await new Promise((r) => setTimeout(r, 1100));
    } catch (err) {
      console.log(JSON.stringify({ sent: false, error: err.message, ...summary }));
    }
  }
  console.log(JSON.stringify({ done: true, sent, skipped, dry: DRY }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
