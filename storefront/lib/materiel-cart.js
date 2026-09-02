/**
 * Panier matériel — validation stock, commandes, Stripe
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, ensureDir } = require('../../lib/utils');
const {
  findMaterielVariant,
  findMaterielProduct,
  loadMaterielCatalog,
  saveMaterielCatalog,
} = require('./merch');
const { sanitizePaymentId } = require('./security');
const { isBladeProductId, recordBladeSale } = require('./blade-upsell');
const { notifyMaterielSale, applyManagerNotify } = require('./gym-materiel-managers');
const { intersectPickupGyms } = require('./gym-pickup');
const {
  ORDERS_DIR,
  loadOrder,
  loadOrderAsync,
  saveOrder,
  saveOrderAsync,
  listAllOrdersAsync,
  listOrdersCreatedSinceAsync,
  purgeUnpaidOrdersAsync,
} = require('./materiel-order-persistence');

const PENDING_DIR =
  process.env.BOXPLUS_MATERIEL_PENDING_DIR ||
  (process.env.VERCEL
    ? path.join('/tmp', 'boxplus-materiel-pending')
    : path.join(ROOT, 'data', 'storefront', 'materiel-pending'));

function ensureStores() {
  ensureDir(ORDERS_DIR);
  ensureDir(PENDING_DIR);
}

function generateOrderId() {
  return `MAT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function pendingPath(sessionId) {
  const safe = sanitizePaymentId(sessionId);
  if (!safe) return null;
  return path.join(PENDING_DIR, `${safe}.json`);
}

function savePendingCheckout(sessionId, payload) {
  ensureStores();
  const file = pendingPath(sessionId);
  if (!file) return;
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

function loadPendingCheckout(sessionId) {
  const file = pendingPath(sessionId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function removePendingCheckout(sessionId) {
  const file = pendingPath(sessionId);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}

function resolveLine(line) {
  const { product, variant } = findMaterielVariant(line.product_id, line.variant_id);
  if (!product || product.active === false) {
    return { error: `Produit introuvable: ${line.product_id}` };
  }
  const v = variant || product.combinations?.[0];
  if (!v) return { error: `Variante introuvable: ${line.product_id}` };
  const qty = Math.max(1, Number(line.qty || 1));
  if (v.stock < qty) {
    return { error: `Stock insuffisant pour ${product.name} (${v.label})` };
  }
  const unitCents = v.price_cents || product.price_cents;
  return {
    product_id: product.id,
    variant_id: v.id,
    name: product.name,
    variant_label: v.label,
    reference: v.reference || product.reference,
    image: v.image || product.image,
    unit_cents: unitCents,
    qty,
    line_total_cents: unitCents * qty,
  };
}

function validateCartLines(lines) {
  const errors = [];
  if (!Array.isArray(lines) || !lines.length) {
    return { errors: ['Panier vide'], items: [], total_cents: 0 };
  }
  const items = [];
  let total = 0;
  for (const line of lines) {
    const resolved = resolveLine(line);
    if (resolved.error) {
      errors.push(resolved.error);
      continue;
    }
    items.push(resolved);
    total += resolved.line_total_cents;
  }
  return { errors, items, total_cents: total };
}

function allowedPickupGyms(items = []) {
  const lists = [];
  for (const item of items) {
    const product = findMaterielProduct(item.product_id);
    if (product?.pickup_gyms?.length) lists.push(product.pickup_gyms);
  }
  if (!lists.length) return null;
  return intersectPickupGyms(lists);
}

function validateCustomerForm(form, items = []) {
  const errors = [];
  if (!form.first_name?.trim()) errors.push('Prénom requis');
  if (!form.last_name?.trim()) errors.push('Nom requis');
  if (!form.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push('Email invalide');
  }
  if (!form.phone?.trim()) errors.push('Téléphone requis');
  const gyms = allowedPickupGyms(items);
  if (gyms && !gyms.length) {
    errors.push(
      'Ces articles ne peuvent pas être retirés dans la même salle. Faites deux commandes séparées.'
    );
  } else if (gyms && gyms.length === 1) {
    form.pickup_gym = gyms[0];
  } else if (!form.pickup_gym?.trim()) {
    errors.push('Lieu de retrait requis');
  } else if (gyms) {
    const raw = String(form.pickup_gym).trim();
    if (!gyms.includes(raw)) {
      errors.push(`Retrait possible uniquement : ${gyms.join(', ')}`);
    }
  }
  return errors;
}

function buildStripeLineItems(items) {
  return items.map((item) => ({
    price_data: {
      currency: 'eur',
      unit_amount: item.unit_cents,
      product_data: {
        name: item.variant_label ? `${item.name} (${item.variant_label})` : item.name,
        metadata: {
          product_id: item.product_id,
          variant_id: String(item.variant_id),
        },
      },
    },
    quantity: item.qty,
  }));
}

function decrementStock(items) {
  const catalog = loadMaterielCatalog();
  let changed = false;
  for (const item of items) {
    const product = (catalog.products || []).find((p) => p.id === item.product_id);
    if (!product) continue;
    const combo = (product.combinations || []).find((c) => c.id === item.variant_id);
    if (combo && combo.stock >= item.qty) {
      combo.stock -= item.qty;
      changed = true;
    }
    product.stock = (product.combinations || []).reduce((s, c) => s + (c.stock || 0), 0);
  }
  if (changed) saveMaterielCatalog(catalog);
}

function buildMaterielOrder({ customer, items, total_cents, pickup_gym, order_id }) {
  return {
    order_id: order_id || generateOrderId(),
    access_token: crypto.randomBytes(24).toString('hex'),
    order_type: 'materiel',
    created_at: new Date().toISOString(),
    customer,
    pickup_gym,
    items,
    total_cents,
    payment: { status: 'pending', method: null },
    email_sent: false,
  };
}

function createMaterielOrder(params) {
  const order = buildMaterielOrder(params);
  saveOrder(order);
  return order;
}

async function createMaterielOrderAsync(params) {
  const order = buildMaterielOrder(params);
  await saveOrderAsync(order);
  return order;
}

function markMaterielPaid(orderId, paymentMeta = {}) {
  const order = loadOrder(orderId);
  if (!order) return null;
  order.payment = { status: 'paid', ...paymentMeta };
  order.paid_at = new Date().toISOString();
  saveOrder(order);
  decrementStock(order.items);
  return order;
}

async function markMaterielPaidAsync(orderId, paymentMeta = {}) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  if (order.payment?.status !== 'paid') {
    order.payment = { status: 'paid', ...paymentMeta };
    order.paid_at = new Date().toISOString();
    decrementStock(order.items);
    if ((order.items || []).some((i) => isBladeProductId(i.product_id))) {
      recordBladeSale(order, { source: 'materiel' }).catch(() => {});
    }
  } else {
    order.payment = { ...order.payment, ...paymentMeta };
  }
  if (!order.manager_notify?.sent) {
    try {
      const notify = await notifyMaterielSale(order, { source: 'materiel' });
      applyManagerNotify(order, notify, 'materiel');
    } catch (err) {
      applyManagerNotify(order, { sent: false, error: err.message }, 'materiel');
    }
  }
  await saveOrderAsync(order);
  return order;
}

function listAllMaterielOrders() {
  if (!fs.existsSync(ORDERS_DIR)) return [];
  try {
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
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function listAllMaterielOrdersAsync() {
  return listAllOrdersAsync();
}

async function listMaterielOrdersCreatedSinceAsync(sinceIso) {
  const persistence = require('./materiel-order-persistence');
  if (typeof persistence.listOrdersCreatedSinceAsync === 'function') {
    return persistence.listOrdersCreatedSinceAsync(sinceIso);
  }
  return listAllOrdersAsync();
}

async function purgeUnpaidMaterielOrdersAsync() {
  return purgeUnpaidOrdersAsync();
}

module.exports = {
  validateCartLines,
  validateCustomerForm,
  allowedPickupGyms,
  buildStripeLineItems,
  createMaterielOrder,
  createMaterielOrderAsync,
  markMaterielPaid,
  markMaterielPaidAsync,
  savePendingCheckout,
  loadPendingCheckout,
  removePendingCheckout,
  listAllMaterielOrders,
  listAllMaterielOrdersAsync,
  listMaterielOrdersCreatedSinceAsync,
  purgeUnpaidMaterielOrdersAsync,
  loadOrder,
  loadOrderAsync,
  saveOrder,
  saveOrderAsync,
  ORDERS_DIR,
};
