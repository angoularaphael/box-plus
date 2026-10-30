'use strict';

const crypto = require('crypto');
const fs = require('fs');

const { logInfo, logWarn } = require('./logger');

const CALLBACK_PATH = '/internal/shop-event';
const CLUBS = new Set(['minimes', 'saint-cyprien', 'etats-unis', 'ramonville', 'portet']);

function signBody(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function bridgeBase() {
  return String(process.env.APP_BRIDGE_PUBLIC_URL || process.env.MEMBER_BRIDGE_URL || '').replace(/\/$/, '');
}

function isAppOrder(order = {}) {
  return Boolean(order.app_checkout?.checkout_session_id);
}

function amountTtcCents(order = {}) {
  if (Number.isFinite(order.payment?.amount_cents)) {
    return Math.max(0, Math.floor(Number(order.payment.amount_cents)));
  }
  const snap = order.product_snapshot || {};
  if (Number.isFinite(snap.price_cents)) return Math.max(0, Math.floor(Number(snap.price_cents)));
  return Math.max(0, Math.round(Number(order.payment?.amount || 0) * 100));
}

function eventId(orderId, type) {
  return `${String(orderId)}#${type}`;
}

async function postShopEvent(payload) {
  const base = bridgeBase();
  const secret = process.env.SHOP_BRIDGE_SECRET || '';
  if (!base || !secret) {
    logWarn('Evenement app non envoye : APP_BRIDGE_PUBLIC_URL ou SHOP_BRIDGE_SECRET absent', {
      event_id: payload.event_id,
    });
    return false;
  }
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const res = await fetch(`${base}${CALLBACK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bc-timestamp': timestamp,
          'x-bc-signature': signBody(secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return true;
      logWarn('Evenement app refuse', { event_id: payload.event_id, status: res.status, attempt });
      if (res.status >= 400 && res.status < 500) return false;
    } catch (err) {
      logWarn('Evenement app echoue', { event_id: payload.event_id, error: err.message, attempt });
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return false;
}

function ensureOutbox(order) {
  if (!order.app_bridge) order.app_bridge = { outbox: [], delivered: {} };
  if (!Array.isArray(order.app_bridge.outbox)) order.app_bridge.outbox = [];
  if (!order.app_bridge.delivered || typeof order.app_bridge.delivered !== 'object') {
    order.app_bridge.delivered = {};
  }
  return order.app_bridge;
}

function buildPayload(order, type, extra = {}) {
  const checkoutSessionId = order.app_checkout?.checkout_session_id || null;
  const club = order.app_checkout?.club || order.gym || order.customer_full?.gym || null;
  return {
    event_id: eventId(order.order_id, type),
    type,
    order_id: order.order_id,
    boxplus_order_id: order.order_id,
    checkout_session_id: checkoutSessionId,
    amount_ttc_cents: amountTtcCents(order),
    club: club && CLUBS.has(String(club)) ? String(club) : null,
    deciplus_sale_id: order.deciplus_sale_id || null,
    label: order.product_snapshot?.display_name || order.product_snapshot?.name || null,
    ...extra,
  };
}

async function deliverAppBridgeEvent(order, type, extra = {}) {
  if (!isAppOrder(order)) return { skipped: true };
  const box = ensureOutbox(order);
  const id = eventId(order.order_id, type);
  if (box.delivered[id]) return { skipped: true, delivered: true };
  const payload = buildPayload(order, type, extra);
  const ok = await postShopEvent(payload);
  if (ok) {
    box.delivered[id] = new Date().toISOString();
    box.outbox = box.outbox.filter((row) => row.event_id !== id);
    logInfo('Evenement app livre', { order_id: order.order_id, type, event_id: id });
    return { delivered: true };
  }
  if (!box.outbox.some((row) => row.event_id === id)) {
    box.outbox.push({ event_id: id, type, payload, queued_at: new Date().toISOString() });
  }
  return { delivered: false, queued: true };
}

async function notifyOrderPaid(order) {
  return deliverAppBridgeEvent(order, 'order.paid');
}

async function notifySaleDone(order) {
  return deliverAppBridgeEvent(order, 'sale.done');
}

async function notifySaleFailed(order, errorCode) {
  return deliverAppBridgeEvent(order, 'sale.failed', { error_code: errorCode || 'deciplus_echec' });
}

async function notifyCancelDone(order) {
  return deliverAppBridgeEvent(order, 'cancel.done');
}

async function notifyInvoiceIssued(order, invoice = {}) {
  const filepath = invoice.filepath || null;
  let sha256_hex = invoice.sha256_hex || null;
  if (filepath && fs.existsSync(filepath) && !sha256_hex) {
    sha256_hex = crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
  }
  const invoiceNumber = invoice.invoice_number || `FAC-${order.order_id}`;
  const storagePath = invoice.storage_path || invoice.filename || (filepath ? require('path').basename(filepath) : null);
  if (!storagePath || !sha256_hex) {
    logWarn('Facture app incomplete', { order_id: order.order_id });
    return { delivered: false, reason: 'facture_incomplete' };
  }
  return deliverAppBridgeEvent(order, 'invoice.issued', {
    invoice_number: invoiceNumber,
    storage_path: storagePath,
    sha256_hex,
    amount_ttc_cents: amountTtcCents(order),
  });
}

async function flushAppBridgeOutbox(order, saveOrderAsync) {
  if (!isAppOrder(order) || !saveOrderAsync) return order;
  const box = ensureOutbox(order);
  let changed = false;
  for (const row of [...box.outbox]) {
    const ok = await postShopEvent(row.payload);
    if (!ok) continue;
    box.delivered[row.event_id] = new Date().toISOString();
    box.outbox = box.outbox.filter((item) => item.event_id !== row.event_id);
    changed = true;
  }
  if (changed) await saveOrderAsync(order);
  return order;
}

module.exports = {
  CALLBACK_PATH,
  isAppOrder,
  postShopEvent,
  notifyOrderPaid,
  notifySaleDone,
  notifySaleFailed,
  notifyCancelDone,
  notifyInvoiceIssued,
  flushAppBridgeOutbox,
  deliverAppBridgeEvent,
};
