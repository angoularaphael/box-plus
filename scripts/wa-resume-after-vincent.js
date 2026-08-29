'use strict';

/**
 * Reprise WhatsApp après Vincent (dernier envoi réellement parti).
 * 1) Offre Duo amis après Vincent
 * 2) Relances coach essais 10 €
 * Écart : 5 minutes.
 *
 *   node scripts/wa-resume-after-vincent.js
 *   node scripts/wa-resume-after-vincent.js --dry
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const { getWhatsAppStatus, sendWhatsAppMessage, toWhatsAppPhone } = require('../storefront/lib/whatsapp-bot');
const { sanitizeFriend, buildReferralCopy } = require('../storefront/lib/referral-notify');
const { sendGymFollowup } = require('../storefront/lib/essai-followup');

const ROOT = path.join(__dirname, '..');
const QUEUE_FILE = path.join(ROOT, 'data', 'essai-followup-queue.json');
const DRY = process.argv.includes('--dry');
const GAP_MS = Number(process.argv.find((a) => a.startsWith('--gap-ms='))?.slice(9) || 5 * 60 * 1000);
const SKIP_INITIAL_WAIT = process.argv.includes('--now');

/** Vincent (ami Offre Duo) — dernier vrai envoi le 28 août ~17h34 UTC. */
const VINCENT_DUO_ORDER = 'BC-1787835445255-998a8a';

const DUO_AFTER_VINCENT = [
  'BC-1787839649652-9fb9ce', // Mathias — déjà parti
  'BC-1787839650553-32a58d', // Heloise — déjà parti
  'BC-1787937593348-3caffc', // Léa — déjà parti
  'BC-1787937999561-d0dd16', // Tiphaine — déjà parti
  'BC-1787941290683-169173', // Yacine — déjà parti
  'BC-1787946324615-1a4f1b', // Thomas — déjà parti
  'BC-1787946950395-52a56d', // Larissa
  'BC-1787984840143-374006', // Shedi
];

const DUO_ALREADY_SENT = new Set([
  'BC-1787839649652-9fb9ce',
  'BC-1787839650553-32a58d',
  'BC-1787937593348-3caffc',
  'BC-1787937999561-d0dd16',
  'BC-1787941290683-169173',
  'BC-1787946324615-1a4f1b',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCoachQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
}

function saveCoachQueue(payload) {
  payload.updated_at = new Date().toISOString();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(payload, null, 2));
}

async function sendDuo(orderId) {
  const order = await loadOrderAsync(orderId);
  if (!order) return { kind: 'duo', order_id: orderId, ok: false, error: 'order_not_found' };
  const friend = sanitizeFriend(order.referral_friend);
  if (!friend) return { kind: 'duo', order_id: orderId, ok: false, error: 'no_friend' };
  const to = toWhatsAppPhone(friend.telephone);
  if (!to || !/^33[67]/.test(to)) {
    return { kind: 'duo', order_id: orderId, ok: false, error: 'invalid_phone', ami: friend.prenom, to };
  }
  const referrer = order.customer_short || {};
  const copy = buildReferralCopy({
    friendPrenom: friend.prenom,
    referrerFirst: referrer.first_name,
    referrerLast: referrer.last_name,
  });
  if (DRY) return { kind: 'duo', order_id: orderId, ok: true, dry: true, ami: friend.prenom, to };
  const wa = await sendWhatsAppMessage(to, copy.text);
  order.referral_notify = {
    ...(order.referral_notify || {}),
    whatsapp: {
      sent: true,
      backfill: true,
      resume_after_vincent: true,
      at: new Date().toISOString(),
      delivered: Boolean(wa.delivered),
      id: wa.id || null,
    },
  };
  order.referral_notified_at = order.referral_notified_at || new Date().toISOString();
  await saveOrderAsync(order);
  return {
    kind: 'duo',
    order_id: orderId,
    ok: true,
    ami: friend.prenom,
    to,
    delivered: Boolean(wa.delivered),
    ackName: wa.ackName || null,
    id: wa.id || null,
  };
}

async function sendCoach(payload, item) {
  const order = await loadOrderAsync(item.order_id);
  if (!order) {
    item.status = 'missing';
    item.error = 'order_not_found';
    return { kind: 'coach', order_id: item.order_id, ok: false, error: 'missing', name: item.name };
  }
  if (DRY) {
    return { kind: 'coach', order_id: item.order_id, ok: true, dry: true, name: item.name, to: item.coach_phone };
  }
  const wa = await sendGymFollowup(order);
  if (!wa.sent) {
    item.status = 'error';
    item.error = wa.error || wa.reason || 'send_failed';
    return { kind: 'coach', order_id: item.order_id, ok: false, error: item.error, name: item.name };
  }
  item.status = 'sent';
  item.sent_at = new Date().toISOString();
  item.to = wa.to;
  item.error = undefined;
  order.essai_followup_status = 'sent';
  order.essai_followup_at = item.sent_at;
  order.essai_followup_wa = wa;
  await saveOrderAsync(order);
  return {
    kind: 'coach',
    order_id: item.order_id,
    ok: true,
    name: item.name,
    gym: item.gym_label,
    to: wa.to,
    delivered: Boolean(wa.wa?.delivered),
    ackName: wa.wa?.ackName || null,
  };
}

async function main() {
  const status = await getWhatsAppStatus();
  const payload = loadCoachQueue();
  const coaches = payload.queue || [];
  console.log(
    JSON.stringify({
      vincent: VINCENT_DUO_ORDER,
      wa: { connected: status.connected, build: status.build, me: status.me },
      dry: DRY,
      gap_ms: GAP_MS,
      duo: DUO_AFTER_VINCENT.length,
      coaches: coaches.length,
    })
  );
  if (!DRY && !status.connected) throw new Error('Bot WhatsApp boutique non connecté');

  if (!DRY && !SKIP_INITIAL_WAIT && GAP_MS > 0) {
    console.log(JSON.stringify({ wait_ms: GAP_MS, reason: 'gap_after_test' }));
    await sleep(GAP_MS);
  }

  const jobs = [
    ...DUO_AFTER_VINCENT.filter((order_id) => !DUO_ALREADY_SENT.has(order_id)).map((order_id) => ({
      type: 'duo',
      order_id,
    })),
    ...coaches.map((item) => ({ type: 'coach', item })),
  ];

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += 1) {
    const live = await getWhatsAppStatus();
    if (!DRY && !live.connected) {
      console.log(JSON.stringify({ stopped: 'wa_disconnected', at: i, of: jobs.length }));
      break;
    }
    const job = jobs[i];
    let result;
    try {
      result = job.type === 'duo' ? await sendDuo(job.order_id) : await sendCoach(payload, job.item);
    } catch (err) {
      result = {
        kind: job.type,
        order_id: job.order_id || job.item?.order_id,
        ok: false,
        error: err.message,
      };
    }
    if (result.ok) sent += 1;
    else failed += 1;
    console.log(JSON.stringify({ i: i + 1, of: jobs.length, ...result }));
    saveCoachQueue(payload);
    if (!DRY && i < jobs.length - 1 && GAP_MS > 0) {
      const next = jobs[i + 1];
      console.log(
        JSON.stringify({
          wait_ms: GAP_MS,
          next: next.type === 'duo' ? next.order_id : next.item.order_id,
        })
      );
      await sleep(GAP_MS);
    }
  }

  payload.resume_after_vincent = {
    sent,
    failed,
    dry: DRY,
    finished_at: new Date().toISOString(),
  };
  saveCoachQueue(payload);
  console.log(JSON.stringify({ done: true, sent, failed, dry: DRY }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
