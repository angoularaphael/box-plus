#!/usr/bin/env node
'use strict';
/**
 * Rattrapage factures boutique jamais parties (email_sent vide).
 * Envoi Resend no-reply@boxingcenter.fr + PDF facture.
 *
 *   node scripts/resend-missing-invoices.js --send
 *   node scripts/resend-missing-invoices.js --send --limit=10
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.RESEND_SENDER_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
process.env.RESEND_SENDER_NAME = 'Boxing Center';
process.env.RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'boxingcentertls@gmail.com';

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { generateInscriptionInvoicePdf } = require('../storefront/lib/invoice-pdf');
const { sendEmailViaResend, isConfigured } = require('../storefront/lib/resend-send');
const { markEmailSent } = require('../storefront/lib/order-lifecycle');
const { CLUB_PORTET } = require('../storefront/lib/pdf-layout');

const SEND = process.argv.includes('--send');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0);
const SINCE = '2026-06-01T00:00:00+02:00';
const GAP_MS = 450;
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'resend-missing-invoices-state.json');
const OUT_FILE = path.join(DATA_DIR, `resend-missing-invoices-${Date.now()}.json`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nameOf(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`
    .replace(/\s+/g, ' ')
    .trim();
}

function emailOf(p) {
  return String(p.customer_short?.email || p.customer_full?.email || p.summary?.email || '')
    .trim()
    .toLowerCase();
}

function isTest(p) {
  const hay = `${nameOf(p)} ${emailOf(p)}`.toLowerCase();
  return /\btest\b|boxplus-test|@boxplus-test\.local/.test(hay);
}

function isPortet(p) {
  const gym = String(p.customer_full?.gym || p.gym || '').toLowerCase();
  return gym === 'portet' || gym.includes('portet');
}

function portetCc(p) {
  if (!isPortet(p)) return [];
  const to = emailOf(p);
  const raw = String(process.env.PORTET_DOSSIER_CC || CLUB_PORTET.email || '').trim();
  return raw
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter((v) => v && v.toLowerCase() !== to);
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { sent: {} };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { sent: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInvoiceEmail(order) {
  const short = order.customer_short || {};
  const product = order.product_snapshot || {};
  const gym = order.customer_full?.gym || order.gym || '—';
  const first = short.first_name || 'Bonjour';
  const subject = `Votre facture Boxing Center — ${order.order_id}`;
  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#0B1F3A">Votre facture Boxing Center</h1>
  <p>Bonjour ${escapeHtml(first)},</p>
  <p>Voici votre facture d’inscription, en pièce jointe.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Offre</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(product.display_name || product.name || '')}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Référence</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(order.order_id || '')}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Salle</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(gym)}</td></tr>
  </table>
  <p>Si vous avez déjà reçu ce document, vous pouvez ignorer ce message.</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="https://boxingcenter.fr" style="color:#2EC4C6">boxingcenter.fr</a></p>
</body>
</html>`;
  return { subject, html };
}

async function loadPaidMissing() {
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
  const out = [];
  for (const row of rows) {
    const p = { ...(row.payload || {}), order_id: row.order_id };
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (isTest(p)) continue;
    if (p.email_sent_at || p.email_sent) continue;
    out.push(p);
  }
  return out;
}

(async () => {
  if (!SEND) {
    console.log('Dry-run. Relancer avec --send pour envoyer via Resend.');
  }
  if (SEND && !isConfigured()) throw new Error('RESEND_API_KEY manquant');

  const state = loadState();
  const missing = await loadPaidMissing();
  const report = {
    at: new Date().toISOString(),
    via: 'resend',
    dry_run: !SEND,
    candidates: missing.length,
    sent: [],
    skipped: [],
    failed: [],
  };

  let n = 0;
  for (const order of missing) {
    const email = emailOf(order);
    const rec = {
      order_id: order.order_id,
      name: nameOf(order),
      email: email || null,
      gym: order.customer_full?.gym || order.gym || null,
      product: order.product_snapshot?.display_name || order.product_snapshot?.name || order.product_id,
    };
    if (!email || !email.includes('@')) {
      rec.why = 'no_email';
      report.skipped.push(rec);
      console.log('SKIP no_email', rec.name, rec.order_id);
      continue;
    }
    if (state.sent[order.order_id]) {
      rec.why = 'already_sent_state';
      rec.messageId = state.sent[order.order_id].messageId || null;
      report.skipped.push(rec);
      console.log('SKIP already', rec.name, rec.order_id);
      continue;
    }
    if (LIMIT && n >= LIMIT) break;
    n += 1;

    if (!SEND) {
      report.sent.push({ ...rec, dry_run: true });
      console.log('WOULD', rec.name, rec.email, rec.product);
      continue;
    }

    try {
      const invoice = await generateInscriptionInvoicePdf(order);
      const buf = fs.readFileSync(invoice.filepath);
      if (buf.length < 500) throw new Error('PDF facture trop petit');
      const mail = buildInvoiceEmail(order);
      const result = await sendEmailViaResend({
        to: email,
        subject: mail.subject,
        html: mail.html,
        fromName: 'Boxing Center',
        cc: portetCc(order),
        attachments: [
          {
            filename: invoice.filename,
            content: buf.toString('base64'),
          },
        ],
        headers: { 'X-Transactional': 'true' },
        tags: [{ name: 'category', value: 'transactional' }],
      });
      await markEmailSent(order.order_id);
      state.sent[order.order_id] = {
        at: new Date().toISOString(),
        messageId: result.messageId,
        email,
      };
      saveState(state);
      rec.messageId = result.messageId;
      report.sent.push(rec);
      console.log('SENT', rec.name, rec.email, rec.order_id, result.messageId);
    } catch (err) {
      rec.error = String(err.message || err).slice(0, 200);
      report.failed.push(rec);
      console.error('FAIL', rec.name, rec.email, rec.error);
    }
    await sleep(GAP_MS);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        file: OUT_FILE,
        candidates: report.candidates,
        sent: report.sent.length,
        skipped: report.skipped.length,
        failed: report.failed.length,
      },
      null,
      2
    )
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
