/**
 * Cycle de vie commande — tunnel 6 étapes
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, ensureDir } = require('../../lib/utils');

const ORDERS_DIR =
  process.env.BOXPLUS_ORDERS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-orders' : path.join(ROOT, 'data', 'storefront', 'orders'));

const UPLOADS_DIR =
  process.env.BOXPLUS_UPLOADS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-uploads' : path.join(ROOT, 'data', 'storefront', 'uploads'));

function initDirs() {
  ensureDir(ORDERS_DIR);
  ensureDir(UPLOADS_DIR);
  ensureDir(path.join(UPLOADS_DIR, 'photos'));
  ensureDir(path.join(UPLOADS_DIR, 'ribs'));
}

function orderPath(orderId) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
}

function generateOrderId() {
  return `BC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function generateAccessToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createDraft({ product_id, product, customer_short }) {
  initDirs();
  const order_id = generateOrderId();
  const access_token = generateAccessToken();
  const order = {
    order_id,
    access_token,
    step: 2,
    product_id,
    product_snapshot: {
      id: product.id,
      name: product.name,
      display_name: product.display_name || product.name,
      price_cents: product.price_cents,
      requires_iban: product.requires_iban,
      requires_payment: product.requires_payment,
      sale_type: product.sale_type,
      deciplus_id: product.deciplus_id || null,
    },
    customer_short: customer_short || null,
    customer_full: null,
    payment: { status: 'pending' },
    signature: null,
    documents: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ready_for_dispatch: false,
  };
  fs.writeFileSync(orderPath(order_id), JSON.stringify(order, null, 2));
  return order;
}

function loadOrder(orderId) {
  initDirs();
  const file = orderPath(orderId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveOrder(order) {
  initDirs();
  order.updated_at = new Date().toISOString();
  fs.writeFileSync(orderPath(order.order_id), JSON.stringify(order, null, 2));
  return order;
}

function verifyAccess(order, token) {
  return order && token && order.access_token === token;
}

function updateShortProfile(orderId, customer_short) {
  const order = loadOrder(orderId);
  if (!order) return null;
  order.customer_short = customer_short;
  order.step = Math.max(order.step, 3);
  return saveOrder(order);
}

function markPaymentPaid(orderId, paymentData) {
  const order = loadOrder(orderId);
  if (!order) return null;
  order.payment = {
    ...order.payment,
    ...paymentData,
    status: 'paid',
    paid_at: new Date().toISOString(),
  };
  order.step = 4;
  return saveOrder(order);
}

function updateFullProfile(orderId, customer_full) {
  const order = loadOrder(orderId);
  if (!order) return null;
  order.customer_full = customer_full;
  order.step = Math.max(order.step, 5);
  return saveOrder(order);
}

function recordSignature(orderId, signatureData) {
  const order = loadOrder(orderId);
  if (!order) return null;
  order.signature = {
    ...signatureData,
    signed_at: new Date().toISOString(),
  };
  order.step = 6;
  order.ready_for_dispatch = true;
  return saveOrder(order);
}

function markEmailSent(orderId) {
  const order = loadOrder(orderId);
  if (!order) return null;
  order.email_sent_at = new Date().toISOString();
  return saveOrder(order);
}

function getUploadDir(type) {
  initDirs();
  return path.join(UPLOADS_DIR, type);
}

module.exports = {
  ORDERS_DIR,
  UPLOADS_DIR,
  createDraft,
  loadOrder,
  saveOrder,
  verifyAccess,
  updateShortProfile,
  markPaymentPaid,
  updateFullProfile,
  recordSignature,
  markEmailSent,
  getUploadDir,
  generateOrderId,
};
