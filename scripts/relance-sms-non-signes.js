#!/usr/bin/env node
'use strict';
/**
 * Relance SMS — payé mais pas encore signé (finaliser dossier).
 *
 *   node scripts/relance-sms-non-signes.js --dry-run
 *   node scripts/relance-sms-non-signes.js --send
 *   node scripts/relance-sms-non-signes.js --send --since=2026-09-01
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const { getSupabase } = require('../storefront/lib/supabase');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const { nudgeWhatsAppText } = require('../storefront/lib/inscription-nudge');

const SEND = process.argv.includes('--send');
const SINCE = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] || '2026-09-01T00:00:00Z';
const DELAY_MS = Number(process.env.SMS_CATCHUP_DELAY_MS || 500);
const SMS_API = (process.env.SMS_GATEWAY_URL || 'http://prem-eu2.bot-hosting.net:21724').replace(/\/$/, '');
const SMS_EMAIL = process.env.SMS_GATEWAY_EMAIL || 'angoularaphael05@gmail.com';
const SMS_PASSWORD = process.env.SMS_GATEWAY_PASSWORD || 'Fareno12';
const TEST_PHONES = new Set(['0612345678', '33612345678']);

function isFrMobile(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('33') && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0[67]\d{8}$/.test(d);
}

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
  if (!res.ok) throw new Error(json?.error || text || `${res.status}`);
  return json;
}

function splitName(order) {
  const parts = [order.customer_short?.first_name, order.customer_short?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { prenom: 'Client', nom: '-' };
  if (parts.length === 1) return { prenom: parts[0], nom: '-' };
  return { prenom: parts[0], nom: parts.slice(1).join(' ') };
}

async function listTargets() {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const page = 200;
  for (;;) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id,payload,created_at')
      .gte('created_at', SINCE)
      .order('created_at', { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  const targets = [];
  for (const row of all) {
    const p = row.payload || {};
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (p.signature?.signed_at) continue;
    if (p.funnel?.nudge_sms_sent_at) continue;
    const phone = p.customer_short?.phone || p.customer_short?.telephone || '';
    if (!phone) continue;
    targets.push({
      order_id: row.order_id,
      name: [p.customer_short?.first_name, p.customer_short?.last_name].filter(Boolean).join(' ').trim(),
      phone,
      gym: p.customer_full?.gym || p.gym,
      product: p.product_snapshot?.name || p.product_id,
      paid_at: p.payment?.paid_at,
    });
  }
  return targets;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const targets = await listTargets();
  const jobs = [];
  const skipped = [];
  const seen = new Set();
  for (const t of targets) {
    if (!isFrMobile(t.phone)) {
      skipped.push({ ...t, reason: 'numero_invalide' });
      continue;
    }
    const key = String(t.phone).replace(/\D/g, '').replace(/^33/, '0');
    if (TEST_PHONES.has(key)) {
      skipped.push({ ...t, reason: 'test_phone' });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ ...t, reason: 'doublon_tel' });
      continue;
    }
    seen.add(key);
    const order = await loadOrderAsync(t.order_id);
    if (!order) {
      skipped.push({ ...t, reason: 'order_missing' });
      continue;
    }
    const names = splitName(order);
    jobs.push({
      ...t,
      prenom: names.prenom,
      nom: names.nom,
      message: gsmSafe(nudgeWhatsAppText(order)),
    });
  }

  console.log(
    JSON.stringify({
      mode: SEND ? 'send' : 'dry-run',
      since: SINCE,
      targets: targets.length,
      jobs: jobs.length,
      skipped: skipped.length,
    })
  );
  for (const s of skipped) console.log(JSON.stringify({ skip: true, ...s }));
  for (const j of jobs) {
    console.log(JSON.stringify({ job: true, order_id: j.order_id, name: j.name, phone: j.phone, product: j.product }));
  }

  if (!SEND) {
    console.log(JSON.stringify({ hint: 'relancer avec --send' }));
    return;
  }

  const login = await sms('/api/auth/login', {
    method: 'POST',
    body: { email: SMS_EMAIL, password: SMS_PASSWORD },
  });
  const token = login.token;
  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const campaign = await sms('/api/campaigns', {
        method: 'POST',
        token,
        body: {
          name: `Relance inscription ${job.prenom}`.slice(0, 80),
          message: job.message,
        },
      });
      await sms(`/api/campaigns/${campaign.id}/contacts`, {
        method: 'POST',
        token,
        body: { prenom: job.prenom, nom: job.nom || '-', telephone: job.phone },
      });
      const start = await sms(`/api/campaigns/${campaign.id}/start`, { method: 'POST', token });
      if (!start?.queued) throw new Error(start?.error || 'sms_not_queued');
      const order = await loadOrderAsync(job.order_id);
      const now = new Date().toISOString();
      if (order) {
        order.funnel = {
          ...(order.funnel || {}),
          nudge_sms_sent_at: now,
          nudge_whatsapp_sent_at: now,
          last_nudge_at: now,
          nudge_attempts: Math.max(1, Number(order.funnel?.nudge_attempts || 0) || 1),
        };
        await saveOrderAsync(order);
      }
      sent += 1;
      console.log(JSON.stringify({ sent: true, order_id: job.order_id, queued: start.queued, to: job.phone }));
    } catch (err) {
      failed += 1;
      console.log(JSON.stringify({ sent: false, order_id: job.order_id, error: err.message }));
    }
    await sleep(DELAY_MS);
  }
  console.log(JSON.stringify({ done: true, sent, failed, total: jobs.length }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
