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

const GYM_LABELS = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'Saint-Cyprien',
  balma: 'Balma',
};

function gymLabel(slug) {
  const key = String(slug || '').trim();
  if (!key) return null;
  return GYM_LABELS[key] || GYM_LABELS[key.toLowerCase()] || key;
}

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
    tab: product.tab || null,
    subsection: product.subsection || null,
    duration_label: product.duration_label || null,
  };
}

function createDraft({ product_id, product, customer_short, gym, referral_friend, source }) {
  initDirs();
  const order_id = generateOrderId();
  const access_token = generateAccessToken();
  const isBalma = String(source || '').toLowerCase() === 'balma_retour';
  const gymForced = gym || (isBalma ? 'minimes' : null);
  const order = {
    order_id,
    access_token,
    step: customer_short ? STEPS.PAYMENT : gymForced ? STEPS.IDENTITY : STEPS.GYM,
    product_id,
    product_snapshot: productSnapshot(product),
    customer_short: customer_short || null,
    customer_full: gymForced ? { gym: gymForced } : null,
    referral_friend: referral_friend || null,
    source: source || null,
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

async function createDraftAsync({ product_id, product, customer_short, gym, referral_friend, source }) {
  const order = createDraft({ product_id, product, customer_short, gym, referral_friend, source });
  await persistence.saveOrderAsync(order);
  return order;
}

async function attachReferralFriendAsync(orderId, friend) {
  const order = await loadOrderAsync(orderId);
  if (!order || !friend) return order;
  order.referral_friend = friend;
  return saveOrderAsync(order);
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
  applyFunnelStepClock(order);
  return persistence.saveOrder(order);
}

async function saveOrderAsync(order) {
  initDirs();
  applyFunnelStepClock(order);
  return persistence.saveOrderAsync(order);
}

function applyFunnelStepClock(order) {
  if (!order || order.action) return order;
  const id = String(order.order_id || '');
  if (/^(COACH|CHANGE|VERIFY)-/i.test(id)) return order;
  if (!order.access_token) return order;
  if (order.signature?.signed_at || Number(order.step || 0) >= STEPS.CONFIRMED) return order;
  const key = String(Number(order.step || 0));
  const funnel = order.funnel || {};
  if (String(funnel.tracked_step || '') === key && funnel.step_entered_at) return order;
  order.funnel = {
    ...funnel,
    tracked_step: key,
    step_entered_at: new Date().toISOString(),
  };
  return order;
}

function verifyAccess(order, token) {
  if (!order || !token || !order.access_token) return false;
  const a = Buffer.from(String(order.access_token));
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function updateShortProfile(orderId, customer_short) {
  return updateShortProfileAsync(orderId, customer_short);
}

async function updateShortProfileAsync(orderId, customer_short) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.customer_short = customer_short;
  order.step = Math.max(order.step || 1, STEPS.PAYMENT);
  const saved = await saveOrderAsync(order);
  try {
    const { collapseUnpaidDraftsForEmail } = require('./order-prune');
    await collapseUnpaidDraftsForEmail(customer_short?.email, order.order_id);
  } catch {
    /* ignore */
  }
  return saved;
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
    paid_at: order.payment?.paid_at || paymentData.paid_at || new Date().toISOString(),
  };
  const paidAt = Date.parse(order.payment.paid_at);
  const nudgeMs = Number(process.env.BOXPLUS_INSCRIPTION_NUDGE_MS || 30 * 60 * 1000);
  order.funnel = {
    ...(order.funnel || {}),
    complete_deadline_at:
      order.funnel?.complete_deadline_at ||
      new Date((Number.isFinite(paidAt) ? paidAt : Date.now()) + nudgeMs).toISOString(),
  };
  const plan = order.payment?.billing_plan;
  const snap = order.product_snapshot || {};
  const { requiresIbanForPlan } = require('../../lib/billing-plan');
  const needsIban = !order.payment?.iban && requiresIbanForPlan(snap, plan);
  order.step = needsIban ? STEPS.IBAN : STEPS.DOSSIER;
  const saved = await saveOrderAsync(order);
  try {
    const { collapseUnpaidDraftsForEmail } = require('./order-prune');
    const email = order.customer_short?.email || order.customer_full?.email;
    await collapseUnpaidDraftsForEmail(email, order.order_id);
  } catch {
    /* ignore */
  }
  try {
    const { notifyAventurePaid } = require('./aventure-dispatch');
    await notifyAventurePaid(saved);
  } catch {
    /* le dispatch Aventure ne doit pas bloquer le paiement */
  }
  return saved;
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
  const { isBalmaRetourOrder } = require('../../lib/balma');
  const aventure = isBalmaRetourOrder(order) || order.aventure;
  order.step = aventure ? STEPS.DOSSIER : Math.min(order.step || STEPS.PAYMENT, STEPS.PAYMENT);
  return saveOrderAsync(order);
}

async function updateIbanAsync(orderId, iban) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  const { normalizeIban } = require('../../lib/iban');
  const clean = normalizeIban(iban);
  order.payment = { ...(order.payment || {}), iban: clean };
  order.customer_full = { ...(order.customer_full || {}), iban: clean };
  const { isBalmaRetourOrder } = require('../../lib/balma');
  const aventure = isBalmaRetourOrder(order) || order.aventure || order.skip_dossier;
  order.step = aventure ? STEPS.DOSSIER : Math.max(order.step || 1, STEPS.DOSSIER);
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
  if (typeof persistence.findOrderBySubscriptionId === 'function') {
    return persistence.findOrderBySubscriptionId(subscriptionId);
  }
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
  return all.filter(isValidOrder);
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
    phone: short.phone || customer.phone || full.phone || full.mobile || null,
    name: nameFromCustomer,
    gym: full.gym || order.gym || customer.gym || null,
    gym_label: gymLabel(full.gym || order.gym || customer.gym),
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
    source: order.source || order.utm?.source || null,
    aventure: Boolean(
      order.aventure || order.skip_dossier || String(order.source || '').toLowerCase() === 'balma_retour'
    ),
    origine:
      order.aventure ||
      order.skip_dossier ||
      String(order.source || '').toLowerCase() === 'balma_retour'
        ? 'Aventure Balma'
        : String(order.source || '') === 'custom_offer'
          ? 'Offre perso'
          : 'Boutique',
    created_at: order.created_at,
    updated_at: order.updated_at,
    can_resume:
      !isAction &&
      !order.signature?.signed_at &&
      Number(order.step || 0) < STEPS.CONFIRMED &&
      Boolean(order.access_token) &&
      !/^(COACH|CHANGE|VERIFY)-/i.test(String(order.order_id || '')),
    can_pay:
      !isAction &&
      Boolean(order.access_token) &&
      !order.access_blocked &&
      !/^(COACH|CHANGE|VERIFY)-/i.test(String(order.order_id || '')) &&
      !['paid', 'free', 'past_due'].includes(String(payRaw || 'pending')) &&
      order.product_snapshot?.requires_payment !== false &&
      Number(order.product_snapshot?.price_cents || 0) > 0,
    deciplus_member_id: order.deciplus_member_id || null,
    deciplus_sale_id: order.deciplus_sale_id || null,
    bot_status: order.bot_status || null,
    bot_error: order.bot_error || null,
    skip_bot: Boolean(order.skip_bot),
    manual_migration: Boolean(order.manual_migration),
  };
}

function compareAdminOrders(a, b) {
  const ta = Date.parse(a?.created_at || '') || 0;
  const tb = Date.parse(b?.created_at || '') || 0;
  if (tb !== ta) return tb - ta;
  return String(b?.order_id || '').localeCompare(String(a?.order_id || ''), 'fr');
}

function sortAdminOrders(list = []) {
  return [...list].sort(compareAdminOrders);
}

async function applyBotSaleStatus(orderId, patch = {}) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  const memberId = String(patch.deciplus_member_id || '').trim();
  const saleId = String(patch.deciplus_sale_id || '').trim();
  if (memberId) order.deciplus_member_id = memberId;
  if (saleId) order.deciplus_sale_id = saleId;
  if (patch.status) order.bot_status = String(patch.status);
  if (patch.manual_migration) {
    order.manual_migration = true;
    order.skip_bot = true;
  }
  order.bot_error = patch.error ? String(patch.error).slice(0, 500) : null;
  order.bot_processed_at = new Date().toISOString();
  await saveOrderAsync(order);
  return order;
}

module.exports = {
  STEPS,
  gymLabel,
  ORDERS_DIR,
  UPLOADS_DIR,
  createDraft,
  createDraftAsync,
  attachReferralFriendAsync,
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
  memberDisplayName,
  toAdminSummary,
  sortAdminOrders,
  compareAdminOrders,
  gymLabel,
  GYM_LABELS,
  productSnapshot,
  applyBotSaleStatus,
};
