'use strict';

function amountsMatch(paidCents, expectedCents, tolerance = 1) {
  if (expectedCents == null || Number.isNaN(Number(expectedCents))) return false;
  const paid = Number(paidCents);
  const expected = Number(expectedCents);
  if (!Number.isFinite(paid) || !Number.isFinite(expected)) return false;
  return Math.abs(paid - expected) <= tolerance;
}

function expectedChargeCents(order, product) {
  const plan = String(order?.payment?.payment_plan || 'once').toLowerCase();
  const price = Number(product?.price_cents || order?.product_snapshot?.price_cents || 0);
  if (!price) return null;
  const quarter = Math.round(price / 4);
  // Pay Later 4× peut encaisser le quart (64,75 €) même si la commande boutique est restée en « once ».
  if (plan === '4x' || price >= 20000) return [price, quarter];
  return price;
}

function paidMatchesExpected(paidCents, expectedCents) {
  if (Array.isArray(expectedCents)) {
    return expectedCents.some((c) => amountsMatch(paidCents, c));
  }
  return amountsMatch(paidCents, expectedCents);
}

function payplugMatches({ payment, orderId, expectedCents, storedPaymentId }) {
  if (!payment?.id) return { ok: false, error: 'payment_mismatch' };
  const meta = payment.metadata || {};
  const metaOrder = String(meta.lifecycle_order_id || meta.order_id || meta.verify_order_id || '').trim();
  const wanted = String(orderId || '').trim();
  const stored = String(storedPaymentId || '').trim();
  const idMatch = Boolean(stored) && stored === String(payment.id);
  const metaMatch = Boolean(wanted) && Boolean(metaOrder) && metaOrder === wanted;

  // Double page PayPlug : le client paie pay_A alors que la commande stocke pay_B.
  // On accepte l’id déjà lié, OU les metadata qui pointent vers CETTE commande.
  // Un paiement d’une autre commande (metadata + id différents) reste refusé.
  if (!idMatch && !metaMatch) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (expectedCents != null && !paidMatchesExpected(payment.amount || payment.authorized_amount, expectedCents)) {
    return { ok: false, error: 'amount_mismatch' };
  }
  return { ok: true };
}

/** Conserve les ids PayPlug précédents quand on ouvre une 2ᵉ page hébergée. */
function rememberPreviousPayplugId(paymentState, newId) {
  const prev = String(paymentState?.payplug_payment_id || '').trim();
  const next = String(newId || '').trim();
  const hist = Array.isArray(paymentState?.payplug_payment_ids)
    ? paymentState.payplug_payment_ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (prev && next && prev !== next && !hist.includes(prev)) hist.push(prev);
  return hist.slice(-8);
}

function payplugIdCandidates(order) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    ids.push(s);
  };
  add(order?.payment?.payplug_payment_id);
  for (const id of order?.payment?.payplug_payment_ids || []) add(id);
  return ids;
}

function rememberPreviousPaypalId(paymentState, newId) {
  const prev = String(paymentState?.paypal_order_id || '').trim();
  const next = String(newId || '').trim();
  const hist = Array.isArray(paymentState?.paypal_order_ids)
    ? paymentState.paypal_order_ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (prev && next && prev !== next && !hist.includes(prev)) hist.push(prev);
  return hist.slice(-8);
}

function paypalIdCandidates(order, extraId) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    ids.push(s);
  };
  add(extraId);
  add(order?.payment?.paypal_order_id);
  for (const id of order?.payment?.paypal_order_ids || []) add(id);
  return ids;
}

function paypalCustomId(captured) {
  const unit = (captured?.purchase_units || [])[0] || {};
  return String(unit.custom_id || unit.reference_id || '').trim();
}

function paypalPaidCents(captured) {
  const unit = (captured?.purchase_units || [])[0] || {};
  const cap = (unit.payments?.captures || [])[0];
  const value = cap?.amount?.value || unit.amount?.value;
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function rememberPreviousCawlId(paymentState, newId) {
  const prev = String(paymentState?.cawl_hosted_checkout_id || '').trim();
  const next = String(newId || '').trim();
  const hist = Array.isArray(paymentState?.cawl_hosted_checkout_ids)
    ? paymentState.cawl_hosted_checkout_ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (prev && next && prev !== next && !hist.includes(prev)) hist.push(prev);
  return hist.slice(-8);
}

function cawlIdCandidates(order, extraId) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    ids.push(s);
  };
  add(extraId);
  add(order?.payment?.cawl_hosted_checkout_id);
  for (const id of order?.payment?.cawl_hosted_checkout_ids || []) add(id);
  add(order?.payment?.cawl_payment_id);
  return ids;
}

function cawlMatches({ session, orderId, expectedCents, storedCheckoutId }) {
  if (!session) return { ok: false, error: 'payment_mismatch' };
  const {
    cawlMerchantReference,
    cawlPaidCents,
    isCawlPaid,
  } = require('./cawl');
  const stored = String(storedCheckoutId || '').trim();
  const ref = cawlMerchantReference(session);
  const wanted = String(orderId || '').trim();
  const refMatch = Boolean(wanted) && Boolean(ref) && ref === wanted;
  const storedOk = Boolean(stored);
  if (!storedOk && !refMatch) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (expectedCents != null && isCawlPaid(session)) {
    const paid = cawlPaidCents(session);
    if (paid == null || !paidMatchesExpected(paid, expectedCents)) {
      return { ok: false, error: 'amount_mismatch' };
    }
  }
  return { ok: true };
}

function paypalMatches({ captured, orderId, expectedCents, storedPaypalId }) {
  if (!captured?.id) return { ok: false, error: 'payment_mismatch' };
  const stored = String(storedPaypalId || '').trim();
  const customId = paypalCustomId(captured);
  const wanted = String(orderId || '').trim();
  const idMatch = Boolean(stored) && stored === String(captured.id);
  const customMatch = Boolean(wanted) && Boolean(customId) && customId === wanted;

  // Nouveau checkout PayPal après un refus carte : l’id stocké est l’ancien,
  // le custom_id (order_id boutique) fait foi — comme PayPlug pay_A vs pay_B.
  if (!idMatch && !customMatch) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (expectedCents != null) {
    const paid = paypalPaidCents(captured);
    if (paid == null || !paidMatchesExpected(paid, expectedCents)) {
      return { ok: false, error: 'amount_mismatch' };
    }
  }
  return { ok: true };
}

/**
 * PayPlug envoie parfois un JWT HS256 dans Payplug-Signature.
 * On vérifie s’il est présent ; l’autorité réelle reste retrievePayment().
 */
function verifyPayplugSignature(rawBody, signatureHeader, secret) {
  const sig = String(signatureHeader || '').trim();
  const key = String(secret || '').trim();
  if (!sig || !key) return false;
  const parts = sig.split('.');
  if (parts.length !== 3) return false;
  const crypto = require('crypto');
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', key).update(data).digest('base64url');
  const expectedStd = crypto
    .createHmac('sha256', key)
    .update(data)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const { hmacEqual } = require('./security');
  return hmacEqual(parts[2], expected) || hmacEqual(parts[2], expectedStd);
}

module.exports = {
  amountsMatch,
  paidMatchesExpected,
  expectedChargeCents,
  payplugMatches,
  rememberPreviousPayplugId,
  payplugIdCandidates,
  rememberPreviousPaypalId,
  paypalIdCandidates,
  paypalMatches,
  paypalCustomId,
  paypalPaidCents,
  rememberPreviousCawlId,
  cawlIdCandidates,
  cawlMatches,
  verifyPayplugSignature,
};
