const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir } = require('../../lib/utils');
const { normalizeOrder, validateOrder } = require('../../lib/normalize');
const { enqueue } = require('../../lib/queue');
const { isValidFrenchIban, normalizeIban } = require('../../lib/iban');

const PENDING_DIR =
  process.env.BOXPLUS_PENDING_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-pending' : path.join(ROOT, 'data', 'storefront', 'pending'));

const METADATA_CHUNK = 450;

function initPending() {
  ensureDir(PENDING_DIR);
}

function savePendingOrder(sessionId, order) {
  initPending();
  const file = path.join(PENDING_DIR, `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...order, saved_at: new Date().toISOString() }, null, 2));
  return file;
}

function loadPendingOrder(sessionId) {
  initPending();
  const file = path.join(PENDING_DIR, `${sessionId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function removePendingOrder(sessionId) {
  const file = path.join(PENDING_DIR, `${sessionId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function buildOrderPayload(input, product) {
  const iban = input.iban ? normalizeIban(input.iban) : null;
  const amount = product.price_cents / 100;
  const requiresIban = product.requires_iban !== false && !/comptant/i.test(product.name || '');

  return {
    order_id: input.order_id || `STORE-${Date.now()}`,
    action: 'sale',
    product_id: product.id,
    product_name: product.name,
    product_reference: product.id,
    deciplus_id: product.deciplus_id || null,
    deciplus_product_search: product.deciplus_product_search || null,
    sale_type: product.sale_type || null,
    requires_iban: requiresIban,
    gym: input.gym,
    customer: {
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email,
      phone: input.phone,
      birthdate: input.birthdate,
      gender: input.gender,
      address: input.address,
      postal_code: input.postal_code,
      city: input.city,
      country: input.country || 'FR',
      emergency_contact: input.emergency_contact || null,
      medical_info: input.medical_info || null,
    },
    payment: {
      amount,
      method: input.payment_method || 'stripe',
      status: product.requires_payment ? 'paid' : 'free',
      date: new Date().toISOString(),
      iban: requiresIban ? iban : null,
      stripe_session_id: input.stripe_session_id || null,
      stripe_payment_intent: input.stripe_payment_intent || null,
    },
    utm: {
      source: input.utm_source || null,
      medium: input.utm_medium || null,
      campaign: input.utm_campaign || 'rentree-2026',
    },
    source: 'storefront-stripe',
  };
}

function validateCheckoutForm(input, product) {
  return [...validateShortForm(input), ...validateFullForm(input, product)];
}

function validateShortForm(input) {
  const errors = [];
  if (!input.first_name) errors.push('Prénom requis');
  if (!input.last_name) errors.push('Nom requis');
  if (!input.email) errors.push('Email requis');
  if (!input.phone) errors.push('Téléphone requis');
  if (!input.birthdate) errors.push('Date de naissance requise');
  return errors;
}

function validateFullForm(input, product = {}) {
  const errors = [];
  if (!input.gender) errors.push('Sexe requis');
  if (!input.gym) errors.push('Salle principale requise');
  if (product.requires_iban) {
    if (!input.iban) errors.push('IBAN requis');
    else if (!isValidFrenchIban(input.iban)) errors.push('IBAN français invalide');
  }
  return errors;
}

function validatePaymentForm(input, product) {
  const errors = [];
  if (product.requires_iban) {
    if (!input.iban) errors.push('IBAN requis pour le prélèvement');
    else if (!isValidFrenchIban(input.iban)) errors.push('IBAN français invalide');
  }
  return errors;
}

function buildOrderFromLifecycle(order, product) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  return buildOrderPayload(
    {
      order_id: order.order_id,
      first_name: short.first_name,
      last_name: short.last_name,
      email: short.email,
      phone: short.phone,
      birthdate: short.birthdate,
      gender: full.gender,
      gym: full.gym,
      address: full.address,
      postal_code: full.postal_code,
      city: full.city,
      iban: full.iban || order.payment?.iban,
      payment_method: order.payment?.method || 'stripe',
      stripe_session_id: order.payment?.stripe_session_id,
      emergency_contact: full.emergency_contact,
      medical_info: full.medical_info,
    },
    product
  );
}

function packOrderMetadata(payload) {
  const json = JSON.stringify(payload);
  const meta = { bp_len: String(json.length), bp_chunks: String(Math.ceil(json.length / METADATA_CHUNK) || 0) };
  for (let i = 0; i < json.length; i += METADATA_CHUNK) {
    meta[`bp${Math.floor(i / METADATA_CHUNK)}`] = json.slice(i, i + METADATA_CHUNK);
  }
  return meta;
}

function unpackOrderMetadata(metadata = {}) {
  const chunks = Number(metadata.bp_chunks || 0);
  if (!chunks) return null;
  let json = '';
  for (let i = 0; i < chunks; i += 1) {
    json += metadata[`bp${i}`] || '';
  }
  if (Number(metadata.bp_len) !== json.length) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function dispatchOrder(rawPayload) {
  const order = normalizeOrder(rawPayload);
  const errors = validateOrder(order);
  if (errors.length) {
    throw new Error(`Validation BOXPLUS: ${errors.join(', ')}`);
  }

  if (process.env.BOXPLUS_BOT_URL) {
    const { forwardJobToBot } = require('../../lib/bot-forward');
    const result = await forwardJobToBot(order);
    return { queued: result.queued !== false, forwarded: true, ...result };
  }

  return enqueue(order);
}

function submitToBoxplus(rawPayload) {
  const order = normalizeOrder(rawPayload);
  const errors = validateOrder(order);
  if (errors.length) {
    throw new Error(`Validation BOXPLUS: ${errors.join(', ')}`);
  }
  return enqueue(order);
}

module.exports = {
  buildOrderPayload,
  buildOrderFromLifecycle,
  validateCheckoutForm,
  validateShortForm,
  validateFullForm,
  validatePaymentForm,
  submitToBoxplus,
  dispatchOrder,
  packOrderMetadata,
  unpackOrderMetadata,
  savePendingOrder,
  loadPendingOrder,
  removePendingOrder,
};
