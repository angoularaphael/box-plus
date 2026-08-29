'use strict';

require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = process.env.BOXPLUS_ORDERS_REMOTE || '1';

const fs = require('fs');
const path = require('path');
const { getWhatsAppStatus } = require('../storefront/lib/whatsapp-bot');
const { isOffre29Order } = require('../storefront/lib/referral-notify');
const { canPayOrder } = require('../storefront/lib/inscription-nudge');
const { listPending } = require('../lib/queue');

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'essai-followup-queue.json');
const SINCE = '2026-08-13T00:00:00.000Z';

function already29Contacted(order) {
  return Boolean(
    order?.funnel?.resume_whatsapp_sent_at ||
      order?.funnel?.nudge_whatsapp_sent_at ||
      order?.funnel?.nudge_email_sent_at ||
      order?.funnel?.nudge_sent_at ||
      order?.funnel?.resume_whatsapp_backfill_at
  );
}

async function listUnpaid29() {
  const { getSupabase } = require('../storefront/lib/supabase');
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
          'signature:payload->signature',
        ].join(',')
      )
      .gte('created_at', SINCE)
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
    return true;
  });
}

function essaiQueueStats() {
  if (!fs.existsSync(QUEUE_FILE)) return { missing: true };
  const payload = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const counts = {};
  for (const item of payload.queue || []) {
    const st = item.status || 'unknown';
    counts[st] = (counts[st] || 0) + 1;
  }
  const waiting = (payload.queue || []).filter((i) => i.status === 'waiting');
  const errors = (payload.queue || []).filter((i) => i.status === 'error' || i.status === 'missing');
  return {
    collected_at: payload.collected_at,
    totals: payload.totals,
    counts,
    waiting: waiting.length,
    waiting_names: waiting.map((i) => `${i.name} (${i.gym})`),
    errors: errors.map((i) => ({ name: i.name, status: i.status, error: i.error || i.reason })),
  };
}

async function main() {
  const wa = await getWhatsAppStatus();
  let unpaid29 = { error: 'skip' };
  try {
    const rows = await listUnpaid29();
    const notContacted = rows.filter((row) => canPayOrder(row) && !already29Contacted(row));
    unpaid29 = {
      unpaid: rows.length,
      not_contacted: notContacted.length,
      sample: notContacted.slice(0, 15).map((r) => ({
        order_id: r.order_id,
        name: `${r.customer_short?.first_name || ''} ${r.customer_short?.last_name || ''}`.trim(),
        phone: Boolean(r.customer_short?.phone),
        created_at: r.created_at,
      })),
    };
  } catch (err) {
    unpaid29 = { error: err.message };
  }

  let pendingJobs = [];
  try {
    pendingJobs = listPending().map((j) => ({
      order_id: j.order_id,
      action: j.action || j.order?.action || 'sale',
      status: j.status,
      attempts: j.attempts,
    }));
  } catch (err) {
    pendingJobs = [{ error: err.message }];
  }

  const report = {
    wa: {
      connected: wa.connected,
      reachable: wa.reachable,
      build: wa.build,
      me: wa.me,
      error: wa.error || null,
    },
    essai_queue: essaiQueueStats(),
    offre_29: unpaid29,
    local_bot_queue_pending: pendingJobs.length,
    local_bot_queue: pendingJobs.slice(0, 20),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
