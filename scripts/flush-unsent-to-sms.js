'use strict';

/**
 * Inventaire WhatsApp boutique non partis → envoi SMS gateway.
 *   node scripts/flush-unsent-to-sms.js --dry
 *   node scripts/flush-unsent-to-sms.js --send
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const { sanitizeFriend, isOffre29Order, buildReferralCopy } = require('../storefront/lib/referral-notify');
const {
  canPayOrder,
  resumeWhatsAppText,
  nudgeWhatsAppText,
  customerPhone,
} = require('../storefront/lib/inscription-nudge');
const { gymEssaiFollowupText } = require('../storefront/lib/essai-followup');
const { isOfferPlacesSmsPaused } = require('../storefront/lib/whatsapp-outbound');

const DRY = process.argv.includes('--dry') || !process.argv.includes('--send');
const DUO_ONLY = process.argv.includes('--duo-only');
const SINCE = process.argv.find((a) => a.startsWith('--since='))?.slice(8) || '2026-08-17T00:00:00.000Z';
const QUEUE_FILE = path.join(__dirname, '..', 'data', 'essai-followup-queue.json');
const SMS_API = (process.env.SMS_GATEWAY_URL || 'http://prem-eu2.bot-hosting.net:21724').replace(/\/$/, '');
const SMS_EMAIL = process.env.SMS_GATEWAY_EMAIL || 'angoularaphael05@gmail.com';
const SMS_PASSWORD = process.env.SMS_GATEWAY_PASSWORD || 'Fareno12';

function gsmSafe(text) {
  return String(text || '')
    .replace(/€/g, 'euros')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ê/g, 'e')
    .replace(/Ê/g, 'E')
    .replace(/î/g, 'i')
    .replace(/Î/g, 'I')
    .replace(/ô/g, 'o')
    .replace(/Ô/g, 'O')
    .replace(/â/g, 'a')
    .replace(/Â/g, 'A')
    .replace(/\*/g, '')
    .replace(/~/g, '-')
    .replace(/[🚀🔥💥⏳🥊🚨]/g, '')
    .replace(/ +/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

async function pageOrders() {
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
        ].join(',')
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
  return Boolean(row?.referral_notify?.whatsapp?.sent || row?.referral_notify?.sms?.sent);
}

function resumeSent(row) {
  return Boolean(
    row?.funnel?.resume_whatsapp_sent_at ||
      row?.funnel?.nudge_whatsapp_sent_at ||
      row?.funnel?.resume_whatsapp_backfill_at ||
      row?.funnel?.resume_sms_sent_at
  );
}

function nudgeWaSkippedPause(row) {
  const f = row?.funnel || {};
  if (f.nudge_whatsapp_sent_at || f.nudge_sms_sent_at) return false;
  const skip = String(f.nudge_whatsapp_skipped || '').toLowerCase();
  return skip.includes('promo') || skip.includes('pause') || skip.includes('restrict');
}

function managerUnsent(row) {
  const paidMateriel = String(row?.order_type || '').toLowerCase() === 'materiel' && String(row?.payment?.status || '').toLowerCase() === 'paid';
  const paidBlade = String(row?.addons?.blade?.status || '').toLowerCase() === 'paid';
  if (!paidMateriel && !paidBlade) return false;
  const n = row?.manager_notify || row?.addons?.blade?.manager_notify;
  return !n?.sent;
}

function isFrMobile(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('33') && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0[67]\d{8}$/.test(d);
}

function splitName(full) {
  const parts = String(full || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { prenom: 'Client', nom: '-' };
  if (parts.length === 1) return { prenom: parts[0], nom: '-' };
  return { prenom: parts[0], nom: parts.slice(1).join(' ') };
}

async function sms(pathname, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${SMS_API}${pathname}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(json?.error || text || `${res.status}`);
  }
  return json;
}

async function main() {
  const rows = await pageOrders();
  const duoRows = rows.filter((r) => {
    if (!isOffre29Order(r)) return false;
    if (String(r.payment?.status || '').toLowerCase() !== 'paid') return false;
    if (!sanitizeFriend(r.referral_friend)) return false;
    return !waDuoSent(r);
  });
  const resumeRows = rows.filter((r) => {
    if (!isOffre29Order(r)) return false;
    const st = String(r.payment?.status || 'pending').toLowerCase();
    if (st === 'paid' || st === 'free') return false;
    if (!r.customer_short?.phone && !r.customer_short?.telephone) return false;
    return !resumeSent(r);
  });
  const nudgeRows = rows.filter(nudgeWaSkippedPause);
  const materielRows = rows.filter(managerUnsent);

  const essaiPayload = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const essaiRetry = (essaiPayload.queue || []).filter((item) => item.status === 'error' || item.status === 'pending');

  const jobs = [];
  const seenOrder = new Set();
  const seenPhone = new Set();
  const skipped = [];
  function add(job) {
    const id = job.order_id;
    if (!id || seenOrder.has(id)) return;
    if (!isFrMobile(job.phone)) {
      skipped.push({ reason: 'numero_invalide', type: job.type, order_id: id, phone: job.phone, prenom: job.prenom });
      return;
    }
    const phoneKey = String(job.phone).replace(/\D/g, '').replace(/^33/, '0');
    if (seenPhone.has(phoneKey)) {
      skipped.push({ reason: 'doublon_tel', type: job.type, order_id: id, phone: job.phone, prenom: job.prenom });
      return;
    }
    seenOrder.add(id);
    seenPhone.add(phoneKey);
    jobs.push(job);
  }

  for (const r of duoRows) {
    if (isOfferPlacesSmsPaused()) {
      skipped.push({ reason: 'offer_places_sms_paused', type: 'duo', order_id: r.order_id });
      continue;
    }
    const friend = sanitizeFriend(r.referral_friend);
    const copy = buildReferralCopy({
      friendPrenom: friend.prenom,
      referrerFirst: r.customer_short?.first_name,
      referrerLast: r.customer_short?.last_name,
    });
    add({
      type: 'duo',
      order_id: r.order_id,
      phone: friend.telephone,
      prenom: friend.prenom,
      nom: friend.nom || '-',
      label: `Ami ${friend.prenom} (invite par ${copy.who})`,
      message: gsmSafe(copy.text),
    });
  }

  if (!DUO_ONLY) {
  for (const r of resumeRows) {
    const order = await loadOrderAsync(r.order_id);
    if (!order || !canPayOrder(order) || resumeSent(order)) continue;
    const phone = customerPhone(order);
    const names = splitName([order.customer_short?.first_name, order.customer_short?.last_name].filter(Boolean).join(' '));
    add({
      type: 'resume',
      order_id: r.order_id,
      phone,
      prenom: names.prenom,
      nom: names.nom,
      label: `Reprise 29 ${names.prenom}`,
      message: gsmSafe(resumeWhatsAppText(order, { kind: 'resume' })),
    });
  }

  for (const r of nudgeRows) {
    const order = await loadOrderAsync(r.order_id);
    if (!order || order.funnel?.nudge_whatsapp_sent_at || order.funnel?.nudge_sms_sent_at) continue;
    const phone = customerPhone(order);
    const names = splitName([order.customer_short?.first_name, order.customer_short?.last_name].filter(Boolean).join(' '));
    add({
      type: 'nudge',
      order_id: r.order_id,
      phone,
      prenom: names.prenom,
      nom: names.nom,
      label: `Inscription ${names.prenom}`,
      message: gsmSafe(nudgeWhatsAppText(order)),
    });
  }

  for (const item of essaiRetry) {
    const order = await loadOrderAsync(item.order_id);
    if (!order) continue;
    add({
      type: 'essai',
      order_id: item.order_id,
      phone: item.coach_phone,
      prenom: 'Coach',
      nom: item.gym_label || 'salle',
      label: `Essai coach ${item.name}`,
      message: gsmSafe(gymEssaiFollowupText(order)),
      essaiItem: item,
    });
  }
  }

  const summary = {
    since: SINCE,
    scanned: rows.length,
    duo_amis: duoRows.length,
    reprise_29: resumeRows.length,
    inscription_nudge: nudgeRows.length,
    materiel_managers: materielRows.length,
    essai_coach: essaiRetry.length,
    sms_valides: jobs.length,
    sms_skips: skipped.length,
  };
  console.log(JSON.stringify(summary));
  for (const s of skipped) console.log(JSON.stringify({ skip: true, ...s }));
  for (const j of jobs) {
    console.log(JSON.stringify({ type: j.type, order_id: j.order_id, phone: j.phone, prenom: j.prenom, label: j.label }));
  }
  if (materielRows.length) {
    for (const r of materielRows.slice(0, 20)) {
      console.log(JSON.stringify({ type: 'materiel_unsent', order_id: r.order_id }));
    }
  }

  if (DRY) {
    console.log(JSON.stringify({ dry: true, hint: 'relance avec --send pour SMS' }));
    return;
  }

  const login = await sms('/api/auth/login', {
    method: 'POST',
    body: { email: SMS_EMAIL, password: SMS_PASSWORD },
  });
  const token = login.token;
  let queued = 0;
  let failed = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      const campaign = await sms('/api/campaigns', {
        method: 'POST',
        token,
        body: {
          name: `WA→SMS ${job.type} ${job.prenom}`.slice(0, 80),
          message: job.message,
        },
      });
      await sms(`/api/campaigns/${campaign.id}/contacts`, {
        method: 'POST',
        token,
        body: { prenom: job.prenom, nom: job.nom || '-', telephone: job.phone },
      });
      const start = await sms(`/api/campaigns/${campaign.id}/start`, { method: 'POST', token });
      queued += start.queued || 0;

      const order = await loadOrderAsync(job.order_id);
      const now = new Date().toISOString();
      if (order) {
        if (job.type === 'duo') {
          order.referral_notify = {
            ...(order.referral_notify || {}),
            sms: { sent: true, at: now },
            whatsapp: { ...(order.referral_notify?.whatsapp || {}), sent: true, via: 'sms', at: now },
          };
        } else if (job.type === 'resume') {
          order.funnel = {
            ...(order.funnel || {}),
            resume_sms_sent_at: now,
            resume_whatsapp_sent_at: now,
            resume_whatsapp_backfill_at: now,
          };
        } else if (job.type === 'nudge') {
          order.funnel = {
            ...(order.funnel || {}),
            nudge_sms_sent_at: now,
            nudge_whatsapp_sent_at: now,
            nudge_whatsapp_skipped: undefined,
          };
        } else if (job.type === 'essai') {
          order.essai_followup_status = 'sent';
          order.essai_followup_at = now;
          order.essai_followup_via = 'sms';
        }
        await saveOrderAsync(order);
      }
      if (job.type === 'essai') {
        const item = (essaiPayload.queue || []).find((q) => q.order_id === job.order_id);
        if (item) {
          item.status = 'sent';
          item.sent_at = now;
          item.via = 'sms';
          item.error = undefined;
        }
        essaiPayload.updated_at = now;
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(essaiPayload, null, 2));
      }
      console.log(JSON.stringify({ i: i + 1, of: jobs.length, sent_queue: true, type: job.type, queued: start.queued, order_id: job.order_id }));
    } catch (err) {
      failed += 1;
      console.log(JSON.stringify({ i: i + 1, of: jobs.length, sent: false, type: job.type, error: err.message, order_id: job.order_id }));
    }
  }

  console.log(JSON.stringify({ done: true, queued, failed, jobs: jobs.length }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
