/**
 * Cycle de vie commande — tunnel 8 étapes
 * 1 Offre · 2 Salle · 3 Identité · 4 Paiement · 5 IBAN · 6 Dossier · 7 Signature · 8 Confirmé
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

const STEPS = {
  OFFER: 1,
  GYM: 2,
  IDENTITY: 3,
  PAYMENT: 4,
  IBAN: 5,
  DOSSIER: 6,
  SIGNATURE: 7,
  CONFIRMED: 8,
};

function initDirs() {
  ensureDir(ORDERS_DIR);
  ensureDir(UPLOADS_DIR);
  ensureDir(path.join(UPLOADS_DIR, 'ribs'));
  ensureDir(path.join(UPLOADS_DIR, 'photos'));
  ensureDir(path.join(UPLOADS_DIR, 'signatures'));
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
    description: product.description || null,
    price_cents: product.price_cents,
    price_label: product.price_label,
    stripe_price_label: product.stripe_price_label,
    installments_note: product.installments_note,
    requires_iban: product.requires_iban,
    supports_billing_choice: product.supports_billing_choice,
    supports_installment_choice: product.supports_installment_choice,
    badge: product.badge || null,
    benefits: product.benefits || [],
    deciplus_total_note: product.deciplus_total_note || null,
    requires_payment: product.requires_payment,
    sale_type: product.sale_type,
    deciplus_id: product.deciplus_id || null,
    subsection: product.subsection || null,
  };
}

function createDraft({ product_id, product, customer_short, gym }) {
  initDirs();
  const order_id = generateOrderId();
  const access_token = generateAccessToken();
  const order = {
    order_id,
    access_token,
    step: customer_short ? STEPS.PAYMENT : gym ? STEPS.IDENTITY : STEPS.GYM,
    product_id,
    product_snapshot: productSnapshot(product),
    customer_short: customer_short || null,
    customer_full: gym ? { gym } : null,
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

async function createDraftAsync({ product_id, product, customer_short, gym }) {
  const order = createDraft({ product_id, product, customer_short, gym });
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
  return updateShortProfileAsync(orderId, customer_short);
}

async function updateShortProfileAsync(orderId, customer_short) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.customer_short = customer_short;
  order.step = Math.max(order.step || 1, STEPS.PAYMENT);
  return saveOrderAsync(order);
}

async function updateGymAsync(orderId, gym) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.customer_full = { ...(order.customer_full || {}), gym };
  order.step = Math.max(order.step || 1, STEPS.IDENTITY);
  return saveOrderAsync(order);
}

function markPaymentPaid(orderId, paymentData) {
  return markPaymentPaidAsync(orderId, paymentData);
}

async function markPaymentPaidAsync(orderId, paymentData) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.payment = {
    ...order.payment,
    ...paymentData,
    status: 'paid',
    paid_at: new Date().toISOString(),
  };
  const plan = order.payment?.billing_plan;
  const snap = order.product_snapshot || {};
  const { requiresIbanForPlan } = require('../../lib/billing-plan');
  const needsIban = !order.payment?.iban && requiresIbanForPlan(snap, plan);
  order.step = needsIban ? STEPS.IBAN : STEPS.DOSSIER;
  return saveOrderAsync(order);
}

function markPaymentFailed(orderId, paymentData) {
  return markPaymentFailedAsync(orderId, paymentData);
}

async function markPaymentFailedAsync(orderId, paymentData = {}) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.payment = {
    ...order.payment,
    ...paymentData,
    status: 'failed',
    failed_at: new Date().toISOString(),
  };
  order.step = Math.min(order.step || STEPS.PAYMENT, STEPS.PAYMENT);
  return saveOrderAsync(order);
}

async function updateIbanAsync(orderId, iban) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  const { normalizeIban } = require('../../lib/iban');
  const clean = normalizeIban(iban);
  order.payment = { ...(order.payment || {}), iban: clean };
  order.customer_full = { ...(order.customer_full || {}), iban: clean };
  order.step = Math.max(order.step || 1, STEPS.DOSSIER);
  return saveOrderAsync(order);
}

function updateFullProfile(orderId, customer_full) {
  return updateFullProfileAsync(orderId, customer_full);
}

async function updateFullProfileAsync(orderId, customer_full) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.customer_full = {
    ...(order.customer_full || {}),
    ...customer_full,
    gym: customer_full.gym || order.customer_full?.gym,
    iban: customer_full.iban || order.customer_full?.iban || order.payment?.iban,
  };
  if (customer_full.photo_path) {
    order.documents = { ...(order.documents || {}), photo: customer_full.photo_path };
  }
  order.step = Math.max(order.step || 1, STEPS.SIGNATURE);
  return saveOrderAsync(order);
}

function recordSignature(orderId, signatureData) {
  return recordSignatureAsync(orderId, signatureData);
}

async function recordSignatureAsync(orderId, signatureData) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.signature = {
    ...signatureData,
    signed_at: new Date().toISOString(),
  };
  order.step = STEPS.CONFIRMED;
  order.ready_for_dispatch = true;
  return saveOrderAsync(order);
}

async function markSubscriptionPastDueAsync(orderId, data = {}) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.payment = {
    ...(order.payment || {}),
    ...data,
    status: 'past_due',
    past_due_at: new Date().toISOString(),
    unpaid_notified_at: data.unpaid_notified_at || order.payment?.unpaid_notified_at || null,
  };
  order.access_blocked = Boolean(data.access_blocked ?? order.access_blocked);
  return saveOrderAsync(order);
}

async function findOrderBySubscriptionId(subscriptionId) {
  if (!subscriptionId) return null;
  const all = await listAllOrdersAsync();
  return (
    all.find(
      (o) =>
        o.payment?.stripe_subscription_id === subscriptionId ||
        o.payment?.subscription_id === subscriptionId
    ) || null
  );
}

async function markEmailSentAsync(orderId) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.email_sent_at = new Date().toISOString();
  return saveOrderAsync(order);
}

function markEmailSent(orderId) {
  return markEmailSentAsync(orderId);
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

async function deleteOrderAsync(orderId) {
  initDirs();
  const { DOCS_DIR } = require('./contract-pdf');
  const docs = [
    path.join(DOCS_DIR, `contrat-${orderId}.pdf`),
    path.join(DOCS_DIR, `facture-${orderId}.pdf`),
  ];
  for (const file of docs) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
  await persistence.deleteOrder(orderId);
  return true;
}

function isValidOrder(order) {
  if (!order || typeof order !== 'object') return false;
  const id = String(order.order_id || '').trim();
  return Boolean(id && id !== 'undefined' && id !== 'null');
}

function memberDisplayName(short = {}) {
  const first = String(short.first_name || '').trim();
  const last = String(short.last_name || '').trim();
  const looksLikeEmail = (s) => s.includes('@');
  if (first && last && first !== last && !looksLikeEmail(first)) return `${first} ${last}`;
  if (first && !looksLikeEmail(first)) return first;
  if (last && !looksLikeEmail(last)) return last;
  return '—';
}

async function listAllOrdersAsync() {
  const all = await persistence.listAllOrders();
  const valid = [];
  for (const order of all) {
    if (isValidOrder(order)) {
      valid.push(order);
    } else if (order?.order_id) {
      try {
        await persistence.deleteOrder(String(order.order_id));
      } catch {
        /* ignore */
      }
    }
  }
  return valid;
}

function actionProductLabel(order) {
  if (order.action === 'cancel') return order.product_name || 'Résiliation abonnement';
  if (order.action === 'verify_identity') return order.product_name || 'Vérification identité';
  if (order.action === 'coaching_booking') {
    return (
      order.product_snapshot?.display_name ||
      order.product_name ||
      `Coaching · ${order.activity_label || order.activity || ''}`
    );
  }
  if (String(order.order_id || '').startsWith('CHANGE-')) {
    return order.product_snapshot?.display_name || order.product_name || 'Changement d’abonnement';
  }
  return null;
}

function actionStepLabel(order) {
  if (order.action === 'cancel') {
    if (order.cancel_status === 'done' || order.cancel_status === 'completed') return 'Confirmé';
    if (order.cancel_status === 'mismatch') return 'Identité';
    return 'En cours';
  }
  if (order.action === 'verify_identity') {
    if (order.cancel_status === 'done' || order.cancel_status === 'ok') return 'Confirmé';
    if (order.cancel_status === 'mismatch') return 'Identité';
    return 'En cours';
  }
  if (order.action === 'coaching_booking') {
    if (order.booking_status === 'sent' || order.email_sent_at) return 'Envoyé';
    return 'Reçu';
  }
  return null;
}

function toAdminSummary(order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const customer = order.customer || {};
  const nameFromCustomer =
    memberDisplayName(short) !== '—'
      ? memberDisplayName(short)
      : memberDisplayName(customer) !== '—'
        ? memberDisplayName(customer)
        : String(customer.name || '').trim() || '—';
  const email = short.email || customer.email || full.email || '—';
  const product =
    order.product_snapshot?.display_name ||
    order.product_snapshot?.name ||
    actionProductLabel(order) ||
    order.product_name ||
    '—';
  const isAction = Boolean(order.action);
  const payRaw = order.payment?.status;
  let payment_status = payRaw || (isAction ? null : 'pending');
  if (payment_status === 'n/a') payment_status = null;

  return {
    order_id: order.order_id,
    action: order.action || null,
    step: order.step || 1,
    step_label: actionStepLabel(order),
    product,
    email,
    phone: short.phone || customer.phone || null,
    name: nameFromCustomer,
    gym: full.gym || order.gym || customer.gym || null,
    activity: order.activity_label || order.activity || null,
    booking_date: order.booking_date || null,
    slot: order.slot_label || order.slot || null,
    booking_status: order.booking_status || null,
    payment_status,
    access_blocked: Boolean(order.access_blocked),
    signed: Boolean(order.signature?.signed_at),
    signed_at: order.signature?.signed_at || null,
    dispatched: Boolean(order.dispatched_at),
    email_sent: Boolean(order.email_sent_at),
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

module.exports = {
  STEPS,
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
  updateShortProfileAsync,
  updateGymAsync,
  markPaymentPaid,
  markPaymentFailed,
  updateIbanAsync,
  updateFullProfile,
  recordSignature,
  markEmailSent,
  markSubscriptionPastDueAsync,
  findOrderBySubscriptionId,
  getUploadDir,
  generateOrderId,
  listAllOrders,
  listAllOrdersAsync,
  deleteOrderAsync,
  toAdminSummary,
  productSnapshot,
};
