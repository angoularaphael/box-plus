#!/usr/bin/env node
'use strict';
/**
 * Copie club des inscriptions Boxe éducative Portet → nobleartportesien@gmail.com
 * (ne renvoyer PAS au client).
 *
 *   node scripts/forward-portet-educative-to-nobleart.js
 *   node scripts/forward-portet-educative-to-nobleart.js --send
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.RESEND_SENDER_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
process.env.RESEND_SENDER_NAME = process.env.RESEND_SENDER_NAME || 'David';
process.env.RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'boxingcentertls@gmail.com';

const fs = require('fs');
const path = require('path');
const { listPaidOrdersSince, loadOrder } = require('../storefront/lib/order-persistence');
const { generateInscriptionInvoicePdf } = require('../storefront/lib/invoice-pdf');
const { sendEmailViaResend, isConfigured } = require('../storefront/lib/resend-send');
const { isNoblartPaypalOfferProduct } = require('../lib/billing-plan');

const SEND = process.argv.includes('--send');
const FORCE = process.argv.includes('--force');
const CLUB_TO = 'nobleartportesien@gmail.com';
const SINCE = '2026-01-01T00:00:00+01:00';
const GAP_MS = 500;
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'forward-portet-educative-nobleart-state.json');
const OUT_FILE = path.join(DATA_DIR, `forward-portet-educative-nobleart-${Date.now()}.json`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function gymOf(order = {}) {
  return String(order.customer_full?.gym || order.gym || order.customer?.gym || '').toLowerCase();
}

function isPortet(order) {
  return gymOf(order).includes('portet');
}

function isEducative(order = {}) {
  const product = order.product_snapshot || {
    id: order.product_id,
    name: order.product_name || order.offer,
  };
  if (!isNoblartPaypalOfferProduct(product)) return false;
  const hay = `${product.id || ''} ${product.legacy_id || ''} ${product.name || ''} ${order.product_id || ''} ${order.product_name || ''}`;
  return /educative|éducative/i.test(hay);
}

function nameOf(order) {
  const cs = order.customer_short || {};
  const cf = order.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`
    .replace(/\s+/g, ' ')
    .trim();
}

function emailOf(order) {
  return String(order.customer_short?.email || order.customer_full?.email || '').trim().toLowerCase();
}

function phoneOf(order) {
  return String(order.customer_short?.phone || order.customer_full?.phone || '').trim();
}

function productName(order) {
  const p = order.product_snapshot || {};
  return p.display_name || p.name || order.product_name || order.product_id || 'Boxe éducative';
}

function paidAt(order) {
  return order.payment?.paid_at || order.payment?.captured_at || order.updated_at || order.created_at || '';
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

function buildDigestHtml(rows) {
  const tr = rows
    .map(
      (r) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.email)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.phone)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.product)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.order_id)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(String(r.paid_at).slice(0, 10))}</td>
    </tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Boxe éducative Portet</title></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:900px;margin:0 auto;padding:24px">
  <h1 style="color:#0B1F3A">Boxe éducative — Portet</h1>
  <p>Voici la liste des inscriptions <strong>boxe éducative</strong> à Portet, désormais copiées sur <strong>nobleartportesien@gmail.com</strong> (plus Végé).</p>
  <p><strong>${rows.length}</strong> dossier(s).</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px">
    <tr style="background:#f5f6f8">
      <th style="padding:8px;text-align:left">Nom</th>
      <th style="padding:8px;text-align:left">Email</th>
      <th style="padding:8px;text-align:left">Tél</th>
      <th style="padding:8px;text-align:left">Offre</th>
      <th style="padding:8px;text-align:left">Réf</th>
      <th style="padding:8px;text-align:left">Payé</th>
    </tr>
    ${tr}
  </table>
  <p style="color:#5C6370;font-size:13px">Noble Art Portésien — copie club automatique</p>
</body>
</html>`;
}

async function main() {
  const slim = await listPaidOrdersSince(SINCE);
  const matched = slim.filter((o) => isPortet(o) && isEducative(o));
  const rows = [];
  for (const item of matched) {
    const full = (await loadOrder(item.order_id).catch(() => null)) || item;
    if (!isPortet(full) || !isEducative(full)) continue;
    rows.push({
      order_id: full.order_id,
      name: nameOf(full),
      email: emailOf(full),
      phone: phoneOf(full),
      product: productName(full),
      paid_at: paidAt(full),
      method: full.payment?.method || full.payment?.preferred_checkout || '',
      order: full,
    });
  }
  rows.sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));

  const preview = rows.map(({ order, ...rest }) => rest);
  console.log(JSON.stringify({ count: rows.length, send: SEND, to: CLUB_TO, preview }, null, 2));

  if (!SEND) {
    console.log('Dry-run. Relancer avec --send pour copier les dossiers sur nobleartportesien@gmail.com');
    return;
  }
  if (!isConfigured()) {
    throw new Error('RESEND_API_KEY manquant');
  }

  const state = loadState();
  const results = [];

  if (!state.digest_sent || FORCE) {
    const digest = await sendEmailViaResend({
      to: CLUB_TO,
      subject: `Boxe éducative Portet — ${rows.length} inscription(s) transférée(s)`,
      html: buildDigestHtml(preview),
      fromName: 'Noble Art Portésien',
    });
    state.digest_sent = { at: new Date().toISOString(), id: digest.messageId, count: rows.length };
    saveState(state);
    results.push({ type: 'digest', ok: true, id: digest.messageId });
    await sleep(GAP_MS);
  }

  for (const row of rows) {
    if (state.sent[row.order_id] && !FORCE) {
      results.push({ order_id: row.order_id, skipped: true });
      continue;
    }
    let attachments = [];
    try {
      const invoice = await generateInscriptionInvoicePdf(row.order);
      if (invoice?.filepath && fs.existsSync(invoice.filepath)) {
        attachments.push({ filename: invoice.filename, filepath: invoice.filepath });
      }
    } catch (err) {
      results.push({ order_id: row.order_id, ok: false, error: `pdf: ${err.message}` });
      continue;
    }
    if (!attachments.length) {
      results.push({ order_id: row.order_id, ok: false, error: 'pdf_missing' });
      continue;
    }
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#0B1F3A">Facture boxe éducative — Portet</h1>
  <p>Facture pour <strong>Noble Art Portésien</strong> (pièce jointe PDF).</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Adhérent</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.name)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.email)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Téléphone</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.phone)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Offre</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.product)}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Référence</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.order_id)}</td></tr>
  </table>
</body></html>`;
    try {
      const sent = await sendEmailViaResend({
        to: CLUB_TO,
        subject: `Facture boxe éducative Portet — ${row.name || row.order_id}`,
        html,
        fromName: 'Noble Art Portésien',
        attachments,
      });
      state.sent[row.order_id] = { at: new Date().toISOString(), id: sent.messageId };
      saveState(state);
      results.push({
        order_id: row.order_id,
        ok: true,
        id: sent.messageId,
        pdf: attachments[0].filename,
      });
    } catch (err) {
      results.push({ order_id: row.order_id, ok: false, error: err.message });
    }
    await sleep(GAP_MS);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ to: CLUB_TO, count: rows.length, results }, null, 2));
  console.log(JSON.stringify({ sent: results.filter((r) => r.ok).length, skipped: results.filter((r) => r.skipped).length, failed: results.filter((r) => r.ok === false).length, out: OUT_FILE }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
