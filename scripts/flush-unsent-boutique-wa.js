'use strict';

/**
 * Envoie tous les WhatsApp boutique non partis (bot reconnecté).
 *   node scripts/flush-unsent-boutique-wa.js
 *   node scripts/flush-unsent-boutique-wa.js --dry
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const {
  getWhatsAppStatus,
  sendWhatsAppMessage,
  toWhatsAppPhone,
} = require('../storefront/lib/whatsapp-bot');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const {
  sanitizeFriend,
  isOffre29Order,
  buildReferralCopy,
} = require('../storefront/lib/referral-notify');
const {
  canPayOrder,
  sendResumeWhatsApp,
  resumeWhatsAppText,
  nudgeWhatsAppText,
  customerPhone,
} = require('../storefront/lib/inscription-nudge');
const { sendGymFollowup } = require('../storefront/lib/essai-followup');
const { notifyMaterielSale } = require('../storefront/lib/gym-materiel-managers');

const DRY = process.argv.includes('--dry');
const GAP_MS = Math.max(8000, parseInt(process.argv.find((a) => a.startsWith('--gap-ms='))?.slice(9) || '9000', 10) || 9000);
const SINCE = process.argv.find((a) => a.startsWith('--since='))?.slice(8) || '2026-08-17T00:00:00.000Z';
const QUEUE_FILE = path.join(__dirname, '..', 'data', 'essai-followup-queue.json');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pageOrders(selectExtra) {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const page = 200;
  for (;;) {
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
          'referral_friend:payload->referral_friend',
          'referral_notify:payload->referral_notify',
          'manager_notify:payload->manager_notify',
          'addons:payload->addons',
          'order_type:payload->order_type',
        ]
          .concat(selectExtra || [])
          .join(',')
      )
      .gte('created_at', SINCE)
      .order('created_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return all;
}

function waDuoSent(row) {
  return Boolean(row?.referral_notify?.whatsapp?.sent);
}

function resumeSent(row) {
  return Boolean(
    row?.funnel?.resume_whatsapp_sent_at ||
      row?.funnel?.nudge_whatsapp_sent_at ||
      row?.funnel?.resume_whatsapp_backfill_at
  );
}

function nudgeWaSkippedPause(row) {
  const f = row?.funnel || {};
  if (f.nudge_whatsapp_sent_at) return false;
  const skip = String(f.nudge_whatsapp_skipped || '').toLowerCase();
  return skip.includes('promo') || skip.includes('pause') || skip.includes('restrict');
}

function managerNeedsRetry(row) {
  const n = row?.manager_notify || row?.addons?.blade?.manager_notify;
  if (!n || n.sent) return false;
  const err = `${n.error || ''} ${n.skipped || ''} ${n.whatsapp?.error || ''}`.toLowerCase();
  return /not connected|disconnect|restrict|pause|timeout|fetch failed|503|unreachable/i.test(err);
}

async function sendSafe(phone, text, kind) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const live = await getWhatsAppStatus();
    if (!live.connected) {
      if (attempt >= 4) throw new Error('Bot WhatsApp déconnecté');
      console.log(JSON.stringify({ wait_reconnect: true, attempt, error: live.error || live.qrError || null }));
      await sleep(15000);
      continue;
    }
    try {
      return await sendWhatsAppMessage(phone, text, { kind, timeoutMs: 25000 });
    } catch (err) {
      const msg = err.message || String(err);
      if (/pause après 10|File WhatsApp : pause/i.test(msg)) {
        console.log(JSON.stringify({ wait_batch_rest: true, ms: 20 * 60 * 1000, attempt }));
        await sleep(20 * 60 * 1000);
        continue;
      }
      if (/attendre entre deux/i.test(msg)) {
        await sleep(GAP_MS);
        continue;
      }
      if (/not connected|déconnecté|Bot not connected/i.test(msg)) {
        console.log(JSON.stringify({ wait_reconnect: true, attempt, error: msg }));
        await sleep(15000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('trop de retries file WhatsApp');
}

async function main() {
  const status = await getWhatsAppStatus();
  console.log(
    JSON.stringify({
      dry: DRY,
      wa: {
        connected: status.connected,
        reachable: status.reachable,
        me: status.me,
        error: status.error || null,
        promoPaused: status.outbound?.promoPaused,
      },
      since: SINCE,
    })
  );
  if (!DRY && !status.connected) throw new Error('Bot boutique non connecté');

  const rows = await pageOrders();
  const duo = rows.filter((r) => {
    if (!isOffre29Order(r)) return false;
    if (String(r.payment?.status || '').toLowerCase() !== 'paid') return false;
    if (!sanitizeFriend(r.referral_friend)) return false;
    return !waDuoSent(r);
  });
  const resume = rows.filter((r) => {
    if (!isOffre29Order(r)) return false;
    const st = String(r.payment?.status || 'pending').toLowerCase();
    if (st === 'paid' || st === 'free') return false;
    if (!r.customer_short?.phone && !r.customer_short?.telephone) return false;
    return !resumeSent(r);
  });
  const nudgeSkip = rows.filter(nudgeWaSkippedPause);
  const managers = rows.filter(managerNeedsRetry);

  const essaiPayload = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const essaiRetry = (essaiPayload.queue || []).filter(
    (item) => item.status === 'error' || item.status === 'pending'
  );

  const jobs = [];
  const seen = new Set();
  function addJob(job) {
    const id = job.order_id || job.item?.order_id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    jobs.push(job);
  }
  for (const r of duo) addJob({ type: 'duo', order_id: r.order_id });
  for (const r of resume) addJob({ type: 'resume', order_id: r.order_id });
  for (const r of nudgeSkip) addJob({ type: 'nudge', order_id: r.order_id });
  for (const r of managers) addJob({ type: 'manager', order_id: r.order_id });
  for (const item of essaiRetry) addJob({ type: 'essai', item });

  console.log(
    JSON.stringify({
      scanned: rows.length,
      duo: duo.length,
      resume: resume.length,
      nudge_skipped: nudgeSkip.length,
      manager_retry: managers.length,
      essai_retry: essaiRetry.length,
      jobs: jobs.length,
    })
  );

  if (DRY) {
    for (const j of jobs.slice(0, 40)) {
      console.log(JSON.stringify({ dry: true, ...j, order_id: j.order_id || j.item?.order_id }));
    }
    if (jobs.length > 40) console.log(JSON.stringify({ dry_truncated: jobs.length - 40 }));
    return;
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const id = job.order_id || job.item?.order_id;
    try {
      if (job.type === 'duo') {
        const order = await loadOrderAsync(id);
        if (!order || order.referral_notify?.whatsapp?.sent) {
          skipped += 1;
          console.log(JSON.stringify({ i: i + 1, type: 'duo', skipped: true, order_id: id }));
          continue;
        }
        const friend = sanitizeFriend(order.referral_friend);
        if (!friend) {
          skipped += 1;
          continue;
        }
        const to = toWhatsAppPhone(friend.telephone);
        if (!to || !/^33[67]/.test(to)) {
          skipped += 1;
          console.log(JSON.stringify({ i: i + 1, type: 'duo', skipped: 'bad_phone', order_id: id }));
          continue;
        }
        const copy = buildReferralCopy({
          friendPrenom: friend.prenom,
          referrerFirst: order.customer_short?.first_name,
          referrerLast: order.customer_short?.last_name,
        });
        await sendSafe(to, copy.text, 'promo');
        order.referral_notify = {
          ...(order.referral_notify || {}),
          whatsapp: { sent: true, backfill: true, flush: true, at: new Date().toISOString() },
        };
        order.referral_notified_at = order.referral_notified_at || new Date().toISOString();
        await saveOrderAsync(order);
        sent += 1;
        console.log(JSON.stringify({ i: i + 1, of: jobs.length, type: 'duo', sent: true, ami: friend.prenom, order_id: id }));
      } else if (job.type === 'resume') {
        const order = await loadOrderAsync(id);
        if (!order || !canPayOrder(order) || resumeSent(order)) {
          skipped += 1;
          continue;
        }
        const outText = resumeWhatsAppText(order, { kind: 'resume' });
        const phone = customerPhone(order);
        await sendSafe(phone, outText, 'promo');
        order.funnel = {
          ...(order.funnel || {}),
          resume_whatsapp_sent_at: new Date().toISOString(),
          resume_whatsapp_backfill_at: new Date().toISOString(),
        };
        await saveOrderAsync(order);
        sent += 1;
        console.log(JSON.stringify({ i: i + 1, of: jobs.length, type: 'resume', sent: true, order_id: id }));
      } else if (job.type === 'nudge') {
        const order = await loadOrderAsync(id);
        if (!order || order.funnel?.nudge_whatsapp_sent_at) {
          skipped += 1;
          continue;
        }
        const phone = customerPhone(order);
        const to = toWhatsAppPhone(phone);
        if (!to) {
          skipped += 1;
          continue;
        }
        await sendSafe(to, nudgeWhatsAppText(order), 'promo');
        order.funnel = {
          ...(order.funnel || {}),
          nudge_whatsapp_sent_at: new Date().toISOString(),
          nudge_whatsapp_skipped: undefined,
        };
        await saveOrderAsync(order);
        sent += 1;
        console.log(JSON.stringify({ i: i + 1, of: jobs.length, type: 'nudge', sent: true, order_id: id }));
      } else if (job.type === 'manager') {
        const order = await loadOrderAsync(id);
        if (!order) {
          skipped += 1;
          continue;
        }
        const out = await notifyMaterielSale(order, { force: true });
        if (out.sent) sent += 1;
        else failed += 1;
        if (out.sent) await saveOrderAsync(order);
        console.log(JSON.stringify({ i: i + 1, type: 'manager', sent: Boolean(out.sent), via: out.via, error: out.error, order_id: id }));
      } else if (job.type === 'essai') {
        const item = job.item;
        const order = await loadOrderAsync(item.order_id);
        if (!order) {
          item.status = 'missing';
          skipped += 1;
          continue;
        }
        const wa = await sendGymFollowup(order);
        if (!wa.sent) {
          item.status = 'error';
          item.error = wa.error || wa.reason || 'send_failed';
          failed += 1;
          console.log(JSON.stringify({ i: i + 1, type: 'essai', sent: false, error: item.error, name: item.name }));
        } else {
          item.status = 'sent';
          item.sent_at = new Date().toISOString();
          item.to = wa.to;
          item.error = undefined;
          order.essai_followup_status = 'sent';
          order.essai_followup_at = item.sent_at;
          order.essai_followup_wa = wa;
          await saveOrderAsync(order);
          sent += 1;
          console.log(JSON.stringify({ i: i + 1, of: jobs.length, type: 'essai', sent: true, name: item.name }));
        }
        essaiPayload.updated_at = new Date().toISOString();
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(essaiPayload, null, 2));
      }
    } catch (err) {
      failed += 1;
      console.log(JSON.stringify({ i: i + 1, type: job.type, sent: false, error: err.message, order_id: id }));
      if (/déconnecté|not connected/i.test(err.message || '')) {
        console.log(JSON.stringify({ stopped: 'wa_disconnected', at: i + 1, of: jobs.length, sent, failed, skipped }));
        break;
      }
    }
    if (i < jobs.length - 1) await sleep(GAP_MS);
  }

  console.log(JSON.stringify({ done: true, sent, failed, skipped, jobs: jobs.length }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
