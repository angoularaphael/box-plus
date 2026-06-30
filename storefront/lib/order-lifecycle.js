/**
 * Cycle de vie commande — tunnel 6 étapes
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, ensureDir } = require('../../lib/utils');
const persistence = require('./order-persistence');

const ORDERS_DIR = persistence.ORDERS_DIR;

const UPLOADS_DIR =
  process.env.BOXPLUS_UPLOADS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-uploads' : path.join(ROOT, 'data', 'storefront', 'uploads'));

function initDirs() {
  ensureDir(ORDERS_DIR);
  ensureDir(UPLOADS_DIR);
  ensureDir(path.join(UPLOADS_DIR, 'ribs'));
}

function generateOrderId() {
  return `BC-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function generateAccessToken() {
  return crypto.randomBytes(24).toString('hex');
}

function productSnapshot(product) {
  return {
    id: product.id,
    name: product.name,
    display_name: product.display_name || product.name,
    price_cents: product.price_cents,
    price_label: product.price_label,
    stripe_price_label: product.stripe_price_label,
    installments_note: product.installments_note,
    requires_iban: product.requires_iban,
    requires_payment: product.requires_payment,
    sale_type: product.sale_type,
    deciplus_id: product.deciplus_id || null,
  };
}

function createDraft({ product_id, product, customer_short }) {
  initDirs();
  const order_id = generateOrderId();
  const access_token = generateAccessToken();
  const order = {
    order_id,
    access_token,
    step: customer_short ? 3 : 2,
    product_id,
    product_snapshot: productSnapshot(product),
    customer_short: customer_short || null,
    customer_full: null,
    payment: { status: 'pending' },
    signature: null,
    documents: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ready_for_dispatch: false,
  };
  saveOrder(order);
  return order;
}

async function createDraftAsync({ product_id, product, customer_short }) {
  const order = createDraft({ product_id, product, customer_short });
  await persistence.saveOrderAsync(order);
  return order;
}

/** Lecture locale (fs) — même instance serverless ou dev. */
function loadOrder(orderId) {
  initDirs();
  return persistence.loadOrderFromFs(orderId);
}

/** Lecture fs puis Supabase si besoin (Vercel multi-instances). */
async function loadOrderAsync(orderId) {
  initDirs();
  return persistence.loadOrder(orderId);
}

function saveOrder(order) {
  initDirs();
  return persistence.saveOrder(order);
}

async function saveOrderAsync(order) {
  initDirs();
  return persistence.saveOrderAsync(order);
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

function listAllOrders() {
  initDirs();
  if (!fs.existsSync(ORDERS_DIR)) return [];
  return fs
    .readdirSync(ORDERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
    );
}

async function listAllOrdersAsync() {
  return persistence.listAllOrders();
}

function toAdminSummary(order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  return {
    order_id: order.order_id,
    step: order.step,
    product: order.product_snapshot?.display_name || order.product_snapshot?.name || '—',
    email: short.email || '—',
    name: `${short.first_name || ''} ${short.last_name || ''}`.trim() || '—',
    gym: full.gym || null,
    payment_status: order.payment?.status || 'pending',
    signed: Boolean(order.signature?.signed_at),
    signed_at: order.signature?.signed_at || null,
    dispatched: Boolean(order.dispatched_at),
    email_sent: Boolean(order.email_sent_at),
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

module.exports = {
  ORDERS_DIR,
  UPLOADS_DIR,
  createDraft,
  createDraftAsync,
  loadOrder,
  loadOrderAsync,
  saveOrder,
  saveOrderAsync,
  verifyAccess,
  updateShortProfile,
  markPaymentPaid,
  updateFullProfile,
  recordSignature,
  markEmailSent,
  getUploadDir,
  generateOrderId,
  listAllOrders,
  listAllOrdersAsync,
  toAdminSummary,
  productSnapshot,
};
