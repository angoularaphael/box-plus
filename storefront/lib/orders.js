const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir } = require('../../lib/utils');
const { normalizeOrder, validateOrder } = require('../../lib/normalize');
const { enqueue } = require('../../lib/queue');
const { isValidFrenchIban, normalizeIban } = require('../../lib/iban');

const PENDING_DIR = path.join(ROOT, 'data', 'storefront', 'pending');

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

  return {
    order_id: input.order_id || `STORE-${Date.now()}`,
    action: 'sale',
    product_name: product.name,
    product_reference: product.id,
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
    },
    payment: {
      amount,
      method: input.payment_method || 'stripe',
      status: product.requires_payment ? 'paid' : 'free',
      date: new Date().toISOString(),
      iban: product.requires_iban ? iban : null,
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
  const errors = [];
  if (!input.first_name) errors.push('Prénom requis');
  if (!input.last_name) errors.push('Nom requis');
  if (!input.email) errors.push('Email requis');
  if (!input.phone) errors.push('Téléphone requis');
  if (!input.gym) errors.push('Salle requise');
  if (!input.birthdate) errors.push('Date de naissance requise');
  if (!input.gender) errors.push('Sexe requis');
  if (product.requires_iban) {
    if (!input.iban) errors.push('IBAN requis');
    else if (!isValidFrenchIban(input.iban)) errors.push('IBAN français invalide');
  }
  return errors;
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
  validateCheckoutForm,
  submitToBoxplus,
  savePendingOrder,
  loadPendingOrder,
  removePendingOrder,
};
