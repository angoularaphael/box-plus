#!/usr/bin/env node
'use strict';
/**
 * Rattrapage confirmations de résiliation (Brevo) jamais parties.
 *
 *   node scripts/catchup-cancel-confirm-emails.js
 *   node scripts/catchup-cancel-confirm-emails.js --send
 *   node scripts/catchup-cancel-confirm-emails.js --send --limit=20
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const SEND = process.argv.includes('--send');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0);
const SINCE = '2025-08-01T00:00:00+02:00';
const GAP_MS = 400;
const DATA_DIR = path.join(ROOT, 'data');
const OUT_FILE = path.join(DATA_DIR, `catchup-cancel-confirm-${Date.now()}.json`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function emailOf(p) {
  return String(
    p.customer?.email || p.customer_short?.email || p.customer_full?.email || p.email || ''
  )
    .trim()
    .toLowerCase();
}

function nameOf(p) {
  const c = p.customer || {};
  const s = p.customer_short || {};
  return `${c.first_name || s.first_name || ''} ${c.last_name || s.last_name || ''}`
    .replace(/\s+/g, ' ')
    .trim();
}

function isTest(p) {
  const hay = `${nameOf(p)} ${emailOf(p)} ${p.order_id || ''}`.toLowerCase();
  return /\btest\b|boxplus-test|@boxplus-test\.local|live-resilier|cancel-ok-|cancel-e2e|cancel-mismatch|retry-cancel/.test(
    hay
  );
}

function isCancelDone(p) {
  const st = String(p.cancel_status || '').toLowerCase();
  return st === 'done' || st === 'completed' || st === 'ok' || st === 'success';
}

function isWebCancel(p) {
  if (String(p.action || '').toLowerCase() === 'cancel') return true;
  if (/^CANCEL-/i.test(String(p.order_id || ''))) return true;
  if (String(p.origine || '').toLowerCase() === 'résiliation') return true;
  return false;
}

async function loadDoneCancelsMissingMail() {
  const { getSupabase } = require('../storefront/lib/supabase');
  const { isChangeCancelReason } = require('../storefront/lib/membership');
  const sb = getSupabase();
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', SINCE)
      .order('created_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 500) break;
    from += 500;
  }

  const allMissing = [];
  const byEmail = new Map();
  for (const row of rows) {
    const p = { ...(row.payload || {}), order_id: row.order_id, created_at: row.created_at };
    if (!isWebCancel(p)) continue;
    if (!isCancelDone(p)) continue;
    if (isChangeCancelReason(p.cancel_reason)) continue;
    if (p.cancel_confirm_email_sent_at) continue;
    if (isTest(p)) continue;
    const email = emailOf(p);
    if (!email || !email.includes('@') || !/\.[a-z]{2,}$/i.test(email)) {
      p._skip_reason = 'no_email';
      byEmail.set(`__noemail__${p.order_id}`, p);
      continue;
    }
    allMissing.push(p);
    const prev = byEmail.get(email);
    const prevTs = Date.parse(prev?.cancel_status_at || prev?.created_at || 0) || 0;
    const curTs = Date.parse(p.cancel_status_at || p.created_at || 0) || 0;
    if (!prev || curTs >= prevTs) byEmail.set(email, p);
  }
  return { candidates: [...byEmail.values()], allMissing };
}

(async () => {
  const { sendCancelConfirmationEmail } = require('../storefront/lib/membership');
  const { isConfigured } = require('../storefront/lib/brevo-send');
  const { saveOrderAsync, loadOrder } = require('../storefront/lib/order-persistence');

  if (!SEND) {
    console.log('Dry-run. Relancer avec --send pour envoyer via Brevo.');
  }
  if (SEND && !isConfigured()) throw new Error('BREVO_API_KEY manquant');

  const { candidates: missing, allMissing } = await loadDoneCancelsMissingMail();
  const report = {
    at: new Date().toISOString(),
    via: 'brevo',
    dry_run: !SEND,
    candidates: missing.length,
    sent: [],
    skipped: [],
    failed: [],
  };

  let n = 0;
  for (const order of missing) {
    const email = emailOf(order);
    const cancelDate =
      order.cancel_date ||
      order.effective_date ||
      (order.cancel_status_at ? String(order.cancel_status_at).slice(0, 10) : null) ||
      (order.created_at ? String(order.created_at).slice(0, 10) : null);
    const rec = {
      order_id: order.order_id,
      name: nameOf(order),
      email: email || null,
      cancel_date: cancelDate,
      cancel_status: order.cancel_status || null,
      created_at: order.created_at || null,
    };
    if (order._skip_reason === 'no_email' || !email || !email.includes('@') || !/\.[a-z]{2,}$/i.test(email || '')) {
      rec.why = 'no_email';
      report.skipped.push(rec);
      console.log('SKIP no_email', rec.name || '(sans nom)', rec.order_id);
      continue;
    }
    if (LIMIT && n >= LIMIT) break;
    n += 1;

    if (!SEND) {
      report.sent.push({ ...rec, dry_run: true });
      console.log('WOULD', rec.name, rec.email, rec.cancel_date || '(sans date)', rec.order_id);
      continue;
    }

    try {
      const identity = {
        ...(order.customer || {}),
        first_name:
          order.customer?.first_name || order.customer_short?.first_name || order.first_name,
        last_name: order.customer?.last_name || order.customer_short?.last_name || order.last_name,
        email,
      };
      const result = await sendCancelConfirmationEmail(identity, {
        cancelDate,
        cancelReason: order.cancel_reason || null,
      });
      if (!result?.sent) {
        rec.why = result?.reason || result?.error || 'not_sent';
        report.failed.push(rec);
        console.log('FAIL', rec.name, rec.why, rec.order_id);
        continue;
      }
      const sentAt = new Date().toISOString();
      const full = (await loadOrder(order.order_id)) || order;
      full.cancel_confirm_email_sent_at = sentAt;
      if (!full.cancel_date && cancelDate) full.cancel_date = cancelDate;
      if (!full.access_token) full.access_token = `cancel-${order.order_id}`;
      await saveOrderAsync(full);
      // Marquer les autres demandes done du même e-mail pour éviter un second envoi
      for (const twin of allMissing) {
        if (twin.order_id === order.order_id) continue;
        if (emailOf(twin) !== email) continue;
        try {
          const twinFull = (await loadOrder(twin.order_id)) || twin;
          twinFull.cancel_confirm_email_sent_at = sentAt;
          if (!twinFull.access_token) twinFull.access_token = `cancel-${twin.order_id}`;
          await saveOrderAsync(twinFull);
        } catch {
          /* ignore */
        }
      }
      report.sent.push(rec);
      console.log('SENT', rec.name, rec.email, rec.order_id);
      await sleep(GAP_MS);
    } catch (err) {
      rec.why = err.message;
      report.failed.push(rec);
      console.log('FAIL', rec.name, err.message, rec.order_id);
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        dry_run: !SEND,
        candidates: report.candidates,
        would_or_sent: report.sent.length,
        skipped: report.skipped.length,
        failed: report.failed.length,
        out: OUT_FILE,
      },
      null,
      2
    )
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
