'use strict';

/**
 * 1) Récupère les essais boutique 10 € depuis le 13 août, sans abo.
 * 2) Stocke data/essai-followup-queue.json
 * 3) Envoie WhatsApp coach, 2 min d’écart.
 *
 * Usage :
 *   node scripts/essai-followup-run.js --collect
 *   node scripts/essai-followup-run.js --send
 *   node scripts/essai-followup-run.js --collect --send
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const { getWhatsAppStatus } = require('../storefront/lib/whatsapp-bot');
const {
  ESSAI_SINCE_MS,
  FOLLOWUP_AFTER_MS,
  WA_GAP_MS,
  isPaidEssaiOrder,
  isMembershipOrder,
  getGymCoachTarget,
  gymEssaiFollowupText,
  membershipKeysFromOrders,
  hasLaterMembership,
  sendGymFollowup,
  paidAtMs,
  orderName,
  orderEmail,
  orderPhone,
  orderGym,
} = require('../storefront/lib/essai-followup');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data');
const QUEUE_FILE = path.join(OUT_DIR, 'essai-followup-queue.json');
const SINCE_ISO = '2026-08-13T00:00:00+02:00';
const COLLECT = process.argv.includes('--collect') || !process.argv.includes('--send');
const SEND = process.argv.includes('--send');
const DRY = process.argv.includes('--dry');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rowToOrder(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    order_id: row.order_id || payload.order_id,
    created_at: payload.created_at || row.created_at,
  };
}

async function listOrdersSince(sinceIso) {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const page = 200;
  while (true) {
    const to = from + page - 1;
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch.map(rowToOrder).filter((o) => o.order_id));
    if (batch.length < page) break;
    from += page;
  }
  return all;
}

function toQueueItem(order, reason = 'h72_no_abo') {
  const gym = orderGym(order);
  const target = getGymCoachTarget(gym);
  return {
    order_id: order.order_id,
    name: orderName(order),
    email: orderEmail(order),
    phone: order.customer_short?.phone || order.customer?.phone || order.customer_full?.phone || '',
    gym,
    gym_label: target?.label || gym,
    coach_phone: target?.telephone || null,
    paid_at: order.payment?.paid_at || order.created_at || null,
    deciplus_member_id: order.deciplus_member_id || null,
    reason,
    status: 'queued',
  };
}

async function collect() {
  const now = Date.now();
  const orders = await listOrdersSince(SINCE_ISO);
  const keys = membershipKeysFromOrders(orders);
  const essais = orders.filter(isPaidEssaiOrder).sort((a, b) => paidAtMs(a) - paidAtMs(b));
  const converted = [];
  const skipped = [];
  const queue = [];

  for (const order of essais) {
    const paid = paidAtMs(order);
    const gym = orderGym(order);
    const target = getGymCoachTarget(gym);
    if (String(order.essai_followup_status || '') === 'sent' || order.essai_followup_at) {
      skipped.push({ ...toQueueItem(order, 'already_sent'), status: 'already_sent' });
      continue;
    }
    if (hasLaterMembership(order, keys) || order.essai_has_abo) {
      converted.push({ ...toQueueItem(order, 'has_membership'), status: 'converted' });
      continue;
    }
    if (!target) {
      skipped.push({ ...toQueueItem(order, 'gym_no_coach'), status: 'skipped' });
      continue;
    }
    if (!paid || paid < ESSAI_SINCE_MS) {
      skipped.push({ ...toQueueItem(order, 'before_13_aout'), status: 'skipped' });
      continue;
    }
    if (now < paid + FOLLOWUP_AFTER_MS) {
      skipped.push({ ...toQueueItem(order, 'before_h72'), status: 'waiting' });
      continue;
    }
    queue.push(toQueueItem(order));
  }

  const payload = {
    collected_at: new Date().toISOString(),
    since: SINCE_ISO,
    totals: {
      orders: orders.length,
      essais: essais.length,
      queue: queue.length,
      converted: converted.length,
      skipped: skipped.length,
    },
    by_gym: queue.reduce((acc, item) => {
      acc[item.gym] = (acc[item.gym] || 0) + 1;
      return acc;
    }, {}),
    queue,
    converted,
    skipped,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_FILE)) {
    throw new Error(`Fichier manquant : ${QUEUE_FILE} — lance d’abord --collect`);
  }
  return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
}

function saveQueue(payload) {
  payload.updated_at = new Date().toISOString();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(payload, null, 2));
}

async function sendAll() {
  const payload = loadQueue();
  const status = await getWhatsAppStatus();
  const pending = (payload.queue || []).filter((item) => item.status === 'queued' || item.status === 'error');
  console.log(
    JSON.stringify({
      wa: { connected: status.connected, reachable: status.reachable, error: status.error || null },
      pending: pending.length,
      dry: DRY,
      gap_ms: WA_GAP_MS,
    })
  );
  if (!DRY && !status.connected) {
    throw new Error(`Bot WhatsApp boutique non connecté (${status.error || 'disconnected'})`);
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += 1) {
    const item = pending[i];
    const order = await loadOrderAsync(item.order_id);
    if (!order) {
      item.status = 'missing';
      item.error = 'order_not_found';
      failed += 1;
      console.log(JSON.stringify({ skipped: true, order_id: item.order_id, error: 'missing' }));
      saveQueue(payload);
      continue;
    }
    if (String(order.essai_followup_status || '') === 'sent') {
      item.status = 'already_sent';
      item.sent_at = order.essai_followup_at;
      console.log(JSON.stringify({ skipped: true, order_id: item.order_id, reason: 'already_sent' }));
      saveQueue(payload);
      continue;
    }

    const wa = await sendGymFollowup(order, { dryRun: DRY });
    if (wa.sent || DRY) {
      item.status = DRY ? 'dry' : 'sent';
      item.sent_at = new Date().toISOString();
      item.to = wa.to;
      sent += 1;
      if (!DRY) {
        order.essai_followup_status = 'sent';
        order.essai_followup_at = item.sent_at;
        order.essai_followup_wa = wa;
        await saveOrderAsync(order);
      }
      console.log(
        JSON.stringify({
          sent: !DRY,
          dry: DRY,
          i: i + 1,
          of: pending.length,
          order_id: item.order_id,
          name: item.name,
          gym: item.gym_label,
          to: wa.to,
        })
      );
    } else {
      item.status = 'error';
      item.error = wa.error || wa.reason || 'send_failed';
      failed += 1;
      console.log(JSON.stringify({ sent: false, order_id: item.order_id, error: item.error }));
    }
    saveQueue(payload);

    if (!DRY && i < pending.length - 1) {
      console.log(JSON.stringify({ wait_ms: WA_GAP_MS, next: pending[i + 1]?.order_id || null }));
      await sleep(WA_GAP_MS);
    }
  }

  payload.send_result = { sent, failed, dry: DRY, finished_at: new Date().toISOString() };
  saveQueue(payload);
  return payload.send_result;
}

async function main() {
  if (COLLECT) {
    const collected = await collect();
    console.log(
      JSON.stringify(
        {
          collected: true,
          file: QUEUE_FILE,
          totals: collected.totals,
          by_gym: collected.by_gym,
          queue: collected.queue.map((q) => ({
            order_id: q.order_id,
            name: q.name,
            gym: q.gym_label,
            paid_at: q.paid_at,
            phone: q.phone,
          })),
        },
        null,
        2
      )
    );
  }
  if (SEND) {
    const result = await sendAll();
    console.log(JSON.stringify({ send: result }));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
