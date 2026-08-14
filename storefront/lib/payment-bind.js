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
  if (plan === '4x') return [price, Math.round(price / 4)];
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

  if (stored && stored !== String(payment.id)) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (wanted && metaOrder && metaOrder !== wanted) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (!metaOrder && !stored) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (expectedCents != null && !paidMatchesExpected(payment.amount || payment.authorized_amount, expectedCents)) {
    return { ok: false, error: 'amount_mismatch' };
  }
  return { ok: true };
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

function paypalMatches({ captured, orderId, expectedCents, storedPaypalId }) {
  if (!captured?.id) return { ok: false, error: 'payment_mismatch' };
  const stored = String(storedPaypalId || '').trim();
  if (stored && stored !== String(captured.id)) {
    return { ok: false, error: 'payment_mismatch' };
  }
  const customId = paypalCustomId(captured);
  const wanted = String(orderId || '').trim();
  if (wanted && customId && customId !== wanted) {
    return { ok: false, error: 'payment_mismatch' };
  }
  if (!customId && !stored) {
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
  paypalMatches,
  paypalCustomId,
  paypalPaidCents,
  verifyPayplugSignature,
};
