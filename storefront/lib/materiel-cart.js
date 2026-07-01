/**
 * Panier matériel — validation stock, commandes, Stripe
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, ensureDir } = require('../../lib/utils');
const { findMaterielVariant, loadMaterielCatalog, saveMaterielCatalog } = require('./merch');

const ORDERS_DIR =
  process.env.BOXPLUS_MATERIEL_ORDERS_DIR ||
  (process.env.VERCEL
    ? path.join('/tmp', 'boxplus-materiel-orders')
    : path.join(ROOT, 'data', 'storefront', 'materiel-orders'));

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

function orderPath(orderId) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
}

function pendingPath(sessionId) {
  return path.join(PENDING_DIR, `${sessionId}.json`);
}

function saveOrder(order) {
  ensureStores();
  fs.writeFileSync(orderPath(order.order_id), JSON.stringify(order, null, 2), 'utf8');
  return order;
}

function loadOrder(orderId) {
  const file = orderPath(orderId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function savePendingCheckout(sessionId, payload) {
  ensureStores();
  fs.writeFileSync(pendingPath(sessionId), JSON.stringify(payload, null, 2), 'utf8');
}

function loadPendingCheckout(sessionId) {
  const file = pendingPath(sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function removePendingCheckout(sessionId) {
  const file = pendingPath(sessionId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
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

function validateCustomerForm(form) {
  const errors = [];
  if (!form.first_name?.trim()) errors.push('Prénom requis');
  if (!form.last_name?.trim()) errors.push('Nom requis');
  if (!form.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push('Email invalide');
  }
  if (!form.phone?.trim()) errors.push('Téléphone requis');
  if (!form.pickup_gym?.trim()) errors.push('Lieu de retrait requis');
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

function createMaterielOrder({ customer, items, total_cents, pickup_gym, order_id }) {
  const order = {
    order_id: order_id || generateOrderId(),
    order_type: 'materiel',
    created_at: new Date().toISOString(),
    customer,
    pickup_gym,
    items,
    total_cents,
    payment: { status: 'pending', method: null },
    email_sent: false,
  };
  saveOrder(order);
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

function listAllMaterielOrders() {
  if (!fs.existsSync(ORDERS_DIR)) return [];
  try {
    return fs.readdirSync(ORDERS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

module.exports = {
  validateCartLines,
  validateCustomerForm,
  buildStripeLineItems,
  createMaterielOrder,
  markMaterielPaid,
  savePendingCheckout,
  loadPendingCheckout,
  removePendingCheckout,
  listAllMaterielOrders,
  loadOrder,
  saveOrder,
  ORDERS_DIR,
};
