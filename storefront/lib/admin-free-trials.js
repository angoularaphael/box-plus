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
    campaign_src: campaignSrcLabel(order),
  };
}

function campaignSrcKind(order = {}) {
  const s = String(order.utm?.source || order.utm_source || '').toLowerCase();
  if (s === 'flyer' || s === 'affiche' || s === 'qr') return 'flyer';
  if (s === 'email' || s === 'mail' || s === 'newsletter') return 'email';
  if (s === 'whatsapp' || s === 'wa') return 'whatsapp';
  if (s === 'sms' || s === 'texto') return 'sms';
  if (!s || s === 'seance-offerte-web') return 'direct';
  return s;
}

function campaignSrcLabel(order = {}) {
  const kind = campaignSrcKind(order);
  if (kind === 'flyer') return 'Flyer QR';
  if (kind === 'email') return 'E-mail David';
  if (kind === 'whatsapp') return 'WhatsApp';
  if (kind === 'sms') return 'SMS';
  if (kind === 'direct') return 'Accès direct';
  return kind;
}

function leadStatusLabel(status) {
  const st = String(status || '').toLowerCase();
  if (st === 'confirmed' || st === 'done' || st === 'success') return 'Confirmée';
  if (st === 'queued' || st === 'pending') return 'En file Deciplus';
  if (st === 'error' || st === 'failed') return 'Erreur';
  if (st === 'dry_run') return 'Test';
  return status ? String(status) : 'Reçue';
}

/**
 * Les inscriptions séance offerte vivent dans tunnel_leads (pas boxplus_orders).
 * On normalise en « commande » pour réutiliser isFreeTrialOrder / toFreeTrialAdminRow.
 */
function orderFromTunnelLead(row = {}, job = null) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const orderId = String(meta.id || row.id || '').trim();
  if (!orderId || /^pv-/i.test(orderId)) return null;
  const src = meta.src || meta.source || meta.utm_source || '';
  const memberId = job?.member_id || meta.deciplus_member_id || null;
  const saleId = job?.sale_id || meta.deciplus_sale_id || null;
  const jobState = String(job?.lifecycle_state || job?.status || '').toLowerCase();
  let botStatus = meta.bot_status || null;
  if (!botStatus && job) {
    if (jobState === 'verified' || job?.status === 'completed') botStatus = 'success';
    else if (jobState === 'manual_review' || job?.status === 'manual_review') botStatus = 'manual_review';
    else if (jobState === 'failed' || job?.status === 'failed') botStatus = 'error';
    else botStatus = job.status || job.lifecycle_state || null;
  }
  return {
    order_id: orderId,
    created_at: row.created_at || meta.created_at || null,
    updated_at: meta.updated_at || row.created_at || null,
    product_id: meta.product_id || 'seance-essai-offerte',
    product_name: meta.product_name || 'SEANCE D ESSAI GRATUITE WEB',
    product_snapshot: {
      id: meta.product_id || 'seance-essai-offerte',
      name: 'Séance d’essai offerte',
      display_name: 'Séance d’essai offerte',
      price_cents: 0,
      requires_payment: false,
    },
    source: 'seance-offerte-web',
    requires_payment: false,
    payment: { amount: 0, status: 'free' },
    customer_short: {
      first_name: row.prenom || meta.prenom || '',
      last_name: row.nom || meta.nom || '',
      email: row.email || meta.email || null,
      phone: row.telephone || meta.tel || null,
    },
    customer_full: {
      gym: meta.salle || null,
      address: meta.adresse || meta.address || null,
      postal_code: meta.code_postal || meta.postal_code || null,
      city: meta.ville || meta.city || null,
    },
    gym: meta.salle || null,
    utm: { source: src },
    status: leadStatusLabel(meta.status),
    deciplus_member_id: memberId,
    deciplus_sale_id: saleId,
    bot_status: botStatus,
    bot_error: job?.error_message || meta.last_error || null,
    signature: meta.signed_at ? { signed_at: meta.signed_at } : null,
    visit_date: meta.visit_date || null,
    ami: meta.ami || null,
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
  orderFromTunnelLead,
  toFreeTrialAdminRow,
  buildFreeTrialRows,
  compareNewestFirst,
};
