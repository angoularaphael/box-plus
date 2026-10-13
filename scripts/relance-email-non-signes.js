#!/usr/bin/env node
'use strict';
/**
 * Relance e-mail (Brevo) — payé mais pas encore signé (finaliser / signer le contrat).
 *
 *   node scripts/relance-email-non-signes.js --dry-run
 *   node scripts/relance-email-non-signes.js --send
 *   node scripts/relance-email-non-signes.js --send --since=2026-01-01
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const { getSupabase } = require('../storefront/lib/supabase');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const {
  sendResumeEmail,
  canPayOrder,
  isInscriptionTunnel,
} = require('../storefront/lib/inscription-nudge');
const { isConfigured } = require('../storefront/lib/brevo-send');

const SEND = process.argv.includes('--send');
const SINCE =
  process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] || '2024-01-01T00:00:00Z';
const DELAY_MS = Number(process.env.BREVO_CATCHUP_DELAY_MS || 400);

function isTestEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return true;
  if (/@boxplus-test\.local$/i.test(e)) return true;
  if (/client\.studio\./i.test(e)) return true;
  if (/studio\.rib\./i.test(e)) return true;
  if (/@example\.com$/i.test(e)) return true;
  if (e === 'test@gmail.com') return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    if (p.archived) continue;
    if (!isInscriptionTunnel(p)) continue;
    if (p.action) continue;
    if (p.signature?.signed_at) continue;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    const email = String(
      p.customer_short?.email || p.customer?.email || p.customer_full?.email || ''
    ).trim();
    if (isTestEmail(email)) continue;
    targets.push({
      order_id: row.order_id,
      name: [p.customer_short?.first_name, p.customer_short?.last_name].filter(Boolean).join(' ').trim(),
      email,
      gym: p.customer_full?.gym || p.gym,
      product: p.product_snapshot?.name || p.product_id,
      paid_at: p.payment?.paid_at,
    });
  }
  return targets;
}

async function main() {
  if (SEND && !isConfigured()) throw new Error('BREVO_API_KEY manquant');

  const targets = await listTargets();
  const jobs = [];
  const skipped = [];
  const seenEmail = new Set();

  for (const t of targets) {
    const key = t.email.toLowerCase();
    if (seenEmail.has(key)) {
      skipped.push({ ...t, reason: 'doublon_email' });
      continue;
    }
    seenEmail.add(key);
    const order = await loadOrderAsync(t.order_id);
    if (!order) {
      skipped.push({ ...t, reason: 'order_missing' });
      continue;
    }
    if (order.signature?.signed_at) {
      skipped.push({ ...t, reason: 'signed_since_list' });
      continue;
    }
    jobs.push({ ...t, order });
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
  for (const j of jobs) {
    console.log(JSON.stringify({ job: true, order_id: j.order_id, name: j.name, email: j.email, product: j.product }));
  }

  if (!SEND) {
    console.log(JSON.stringify({ hint: 'relancer avec --send' }));
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const kind = canPayOrder(job.order) ? 'pay' : 'resume';
      const mailed = await sendResumeEmail(job.order, { kind });
      if (mailed.sent) {
        const now = new Date().toISOString();
        job.order.funnel = {
          ...(job.order.funnel || {}),
          resume_email_sent_at: now,
          last_nudge_at: now,
        };
        await saveOrderAsync(job.order);
        sent += 1;
        console.log(JSON.stringify({ sent: true, order_id: job.order_id, to: mailed.to, kind }));
      } else {
        failed += 1;
        console.log(
          JSON.stringify({
            sent: false,
            order_id: job.order_id,
            error: mailed.error || mailed.reason || 'unknown',
          })
        );
      }
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
