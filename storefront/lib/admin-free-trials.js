'use strict';

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasExplicitZeroAmount(order = {}) {
  const values = [
    order.payment?.amount,
    order.payment?.amount_cents,
    order.product_snapshot?.price_cents,
    order.price_cents,
  ].filter((value) => value !== undefined && value !== null && value !== '');
  return (
    values.some((value) => Number(value) === 0) ||
    order.product_snapshot?.requires_payment === false ||
    order.requires_payment === false
  );
}

function hasFreeTrialIdentity(order = {}) {
  const identity = fold(
    [
      order.product_id,
      order.product_reference,
      order.product_name,
      order.product_snapshot?.id,
      order.product_snapshot?.legacy_id,
      order.product_snapshot?.name,
      order.product_snapshot?.display_name,
      order.source,
    ].join(' ')
  );
  return (
    identity.includes('seance essai offerte') ||
    identity.includes('seance d essai offerte') ||
    identity.includes('seance essai gratuite') ||
    identity.includes('seance d essai gratuite') ||
    identity.includes('seance offerte') ||
    identity.includes('seance gratuite') ||
    identity.includes('gratuite web') ||
    identity.includes('seance essai offert') ||
    identity.includes('seance offerte web')
  );
}

function isTestOrCoachingOrder(order = {}) {
  const action = fold(order.action);
  const source = fold(order.source);
  const id = String(order.order_id || '').toUpperCase();
  const product = fold(
    `${order.product_id || ''} ${order.product_name || ''} ${order.product_snapshot?.display_name || ''}`
  );
  return (
    action === 'coaching booking' ||
    action === 'check sale' ||
    /^COACH[-_]/.test(id) ||
    /^(TEST|DEMO)[-_]/.test(id) ||
    source.includes('demo') ||
    source.includes('test') ||
    product.includes('coaching')
  );
}

function isFreeTrialOrder(order = {}) {
  return (
    !isTestOrCoachingOrder(order) &&
    hasFreeTrialIdentity(order) &&
    hasExplicitZeroAmount(order)
  );
}

function customerDetails(order = {}) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const customer = order.customer || {};
  const first = short.first_name || full.first_name || customer.first_name || '';
  const last = short.last_name || full.last_name || customer.last_name || '';
  return {
    name:
      `${first} ${last}`.replace(/\s+/g, ' ').trim() ||
      customer.name ||
      short.email ||
      full.email ||
      customer.email ||
      '—',
    email: short.email || full.email || customer.email || null,
    phone: short.phone || full.phone || full.mobile || customer.phone || null,
    gym: full.gym || order.gym || customer.gym || null,
  };
}

function toFreeTrialAdminRow(order = {}) {
  const customer = customerDetails(order);
  const step = Number(order.step || 0);
  return {
    order_id: order.order_id,
    created_at: order.created_at || order.updated_at || null,
    ...customer,
    product:
      order.product_snapshot?.display_name ||
      order.product_snapshot?.name ||
      order.product_name ||
      order.product_id ||
      'Séance d’essai gratuite',
    order_status:
      order.step_label ||
      order.status ||
      order.state ||
      (step >= 8 ? 'Confirmée' : step > 0 ? `Étape ${step}` : 'Reçue'),
    payment_status: order.payment?.status || null,
    signed: Boolean(order.signature?.signed_at),
    signed_at: order.signature?.signed_at || null,
    deciplus_member_id: order.deciplus_member_id || null,
    deciplus_sale_id: order.deciplus_sale_id || null,
    bot_status: order.bot_status || null,
    bot_error: order.bot_error ? String(order.bot_error).slice(0, 300) : null,
  };
}

function compareNewestFirst(a, b) {
  const diff =
    (Date.parse(b.created_at || b.updated_at || '') || 0) -
    (Date.parse(a.created_at || a.updated_at || '') || 0);
  return diff || String(b.order_id || '').localeCompare(String(a.order_id || ''), 'fr');
}

function buildFreeTrialRows(orders = []) {
  return orders
    .filter(isFreeTrialOrder)
    .sort(compareNewestFirst)
    .map(toFreeTrialAdminRow);
}

module.exports = {
  fold,
  hasExplicitZeroAmount,
  hasFreeTrialIdentity,
  isFreeTrialOrder,
  toFreeTrialAdminRow,
  buildFreeTrialRows,
  compareNewestFirst,
};
