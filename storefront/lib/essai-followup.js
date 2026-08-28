'use strict';

/**
 * Essais boutique à 10 € → si pas d’abonnement 3 jours plus tard,
 * WhatsApp au coach de la salle (bot boutique), 2 min entre chaque envoi.
 * Périmètre : paiements depuis le 13 août 2026.
 */
const { matchGymSlug } = require('../../lib/gym-slugs');
const { getStoreUrl } = require('../../lib/app-urls');
const { logInfo, logWarn } = require('../../lib/logger');
const { sendWhatsAppMessage } = require('./whatsapp-bot');

const ESSAI_SINCE_MS = Date.parse('2026-08-13T00:00:00+02:00');
const FOLLOWUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const WA_GAP_MS = 2 * 60 * 1000;
const CHECK_STALE_MS = 6 * 60 * 60 * 1000;
const MAX_CHECKS_PER_TICK = 5;

const GYM_COACH_WHATSAPP = {
  minimes: { telephone: '+33767919166', label: 'Minimes' },
  'etats-unis': { telephone: '+33767919166', label: 'États-Unis' },
  portet: { telephone: '+33687900216', label: 'Portet' },
  'st-cyprien': { telephone: '+33625745369', label: 'Saint-Cyprien' },
};

const ABO_PRODUCT_IDS = new Set([
  'dp-104',
  'dp-100',
  'offre-duo',
  'offre-saison',
  'offre_29',
  'offre_259',
  'offre-29',
  '44-99-4-semaines',
  'comptant-12-mois',
]);

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/€/g, 'e')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function emailKey(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return v.includes('@') ? v : '';
}

function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('330') && d.length >= 12) d = `0${d.slice(3)}`;
  else if (d.startsWith('33') && d.length >= 11) d = `0${d.slice(2)}`;
  return d.length >= 9 ? d : '';
}

function orderEmail(order = {}) {
  return emailKey(
    order.customer_short?.email || order.customer?.email || order.customer_full?.email
  );
}

function orderPhone(order = {}) {
  return phoneKey(
    order.customer_short?.phone ||
      order.customer?.phone ||
      order.customer_full?.phone ||
      order.customer_full?.mobile
  );
}

function orderName(order = {}) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const customer = order.customer || {};
  const first = String(short.first_name || full.first_name || customer.first_name || '').trim();
  const last = String(short.last_name || full.last_name || customer.last_name || '').trim();
  return `${first} ${last}`.replace(/\s+/g, ' ').trim();
}

function orderGym(order = {}) {
  return (
    matchGymSlug(order.customer_full?.gym || order.gym || order.customer?.gym || order.pickup_gym) ||
    ''
  );
}

function paidAtMs(order = {}) {
  const t = Date.parse(order.payment?.paid_at || order.created_at || '');
  return Number.isFinite(t) ? t : 0;
}

function productIdOf(order = {}) {
  return String(order.product_id || order.product_snapshot?.id || '').toLowerCase();
}

function productNameOf(order = {}) {
  return fold(
    order.product_snapshot?.display_name || order.product_snapshot?.name || order.product_name || ''
  );
}

function isPaidEssaiOrder(order = {}) {
  if (!order || order.action) return false;
  if (/^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(String(order.order_id || ''))) return false;
  if (String(order.payment?.status || '').toLowerCase() !== 'paid') return false;
  const id = productIdOf(order);
  const name = productNameOf(order);
  if (id.includes('offerte') || name.includes('gratuite web')) return false;
  const isEssai =
    id === 'seance-essai' ||
    id === 'seance_essai' ||
    name.includes('seance d essai') ||
    name.includes('seance essai');
  if (!isEssai) return false;
  const cents = Number(order.product_snapshot?.price_cents || order.payment?.amount_cents || 0);
  const amount = Number(order.payment?.amount || 0);
  if (cents === 0 && amount === 0) return false;
  return true;
}

function isMembershipOrder(order = {}) {
  if (!order || order.action) return false;
  if (/^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(String(order.order_id || ''))) return false;
  if (String(order.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isPaidEssaiOrder(order)) return false;
  const id = productIdOf(order);
  if (/^coaching|materiel|badge/.test(id)) return false;
  const name = productNameOf(order);
  if (name.includes('essai') && !/29|259|abo/.test(name)) return false;
  if (ABO_PRODUCT_IDS.has(id)) return true;
  const cents = Number(order.product_snapshot?.price_cents || order.payment?.amount_cents || 0);
  const amount = Number(order.payment?.amount || 0);
  if (cents >= 2900 || amount >= 29) return true;
  if (/offre|abonnement|12 mois|4 semain|259|29 99|2999/.test(name)) return true;
  return false;
}

function getGymCoachTarget(salle) {
  const slug = matchGymSlug(salle) || String(salle || '').toLowerCase();
  return GYM_COACH_WHATSAPP[slug] || null;
}

function isMembershipContract(contract) {
  if (!contract || contract.isBadge) return false;
  const label = String(contract.label || '');
  if (/essai|coaching/i.test(label)) return false;
  return true;
}

function formatFrDate(isoOrMs) {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs || '');
  if (!Number.isFinite(t) || t <= 0) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(t));
}

function gymEssaiFollowupText(order) {
  const gym = getGymCoachTarget(orderGym(order));
  const salle = gym?.label || order.customer_full?.gym || order.gym || 'non renseignée';
  const paid = formatFrDate(paidAtMs(order));
  return [
    'Séance d’essai 10 € — pas d’abonnement',
    '',
    'Cette personne a pris une séance d’essai à 10 € et n’a pas pris d’abonnement 3 jours plus tard. Merci de la recontacter.',
    '',
    `Salle : ${salle}`,
    `Nom : ${orderName(order) || 'non renseigné'}`,
    `Téléphone : ${order.customer_short?.phone || order.customer?.phone || order.customer_full?.phone || 'non renseigné'}`,
    `Email : ${orderEmail(order) || 'non renseigné'}`,
    paid ? `Essai payé le : ${paid}` : null,
    '',
    'Message automatique Boxing Center — boutique',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function membershipKeysFromOrders(orders = []) {
  const emails = new Set();
  const phones = new Set();
  for (const order of orders) {
    if (!isMembershipOrder(order)) continue;
    const email = orderEmail(order);
    const phone = orderPhone(order);
    if (email) emails.add(email);
    if (phone) phones.add(phone);
  }
  return { emails, phones };
}

function hasLaterMembership(order, keys) {
  const email = orderEmail(order);
  const phone = orderPhone(order);
  if (email && keys.emails.has(email)) return true;
  if (phone && keys.phones.has(phone)) return true;
  return Boolean(order.essai_has_abo);
}

function lastFollowupWaAt(orders = []) {
  let latest = 0;
  for (const order of orders) {
    const t = Date.parse(order.essai_followup_at || '');
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest;
}

/**
 * Décide l’action pour un essai 10 €.
 * - skip / wait / converted / enqueue_check / send
 */
function classifyEssaiFollowup(order, { now = Date.now(), membershipKeys, lastWaAt = 0 } = {}) {
  if (!isPaidEssaiOrder(order)) return { action: 'skip', reason: 'not_paid_essai' };
  const paid = paidAtMs(order);
  if (!paid || paid < ESSAI_SINCE_MS) return { action: 'skip', reason: 'before_13_aout' };
  const status = String(order.essai_followup_status || '');
  if (status === 'sent') return { action: 'skip', reason: 'already_sent' };
  if (status === 'converted' || order.essai_has_abo) {
    return { action: 'skip', reason: 'converted' };
  }

  const gym = getGymCoachTarget(orderGym(order));
  if (!gym) return { action: 'skip', reason: 'gym_no_coach', salle: orderGym(order) };

  if (hasLaterMembership(order, membershipKeys || { emails: new Set(), phones: new Set() })) {
    return { action: 'converted', reason: 'has_membership' };
  }

  if (now < paid + FOLLOWUP_AFTER_MS) return { action: 'wait', reason: 'before_h72' };

  if (order.essai_abo_checked_at && order.essai_has_abo) {
    return { action: 'converted', reason: 'deciplus_abo' };
  }

  const checked = Boolean(order.essai_abo_checked_at);
  const queuedAt = Date.parse(order.essai_followup_check_queued_at || '');
  const queuedFresh =
    Number.isFinite(queuedAt) && now - queuedAt < CHECK_STALE_MS && !checked;

  if (!checked && !queuedFresh) {
    return { action: 'enqueue_check', reason: 'need_deciplus_check', gym };
  }
  if (!checked && queuedFresh) {
    return { action: 'wait', reason: 'check_pending' };
  }

  if (now - lastWaAt < WA_GAP_MS) {
    return { action: 'wait', reason: 'wa_gap', gym };
  }
  return { action: 'send', reason: 'h72_no_abo', gym };
}

function essaiCheckSaleJob(order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const customer = order.customer || {};
  return {
    order_id: `${order.order_id}#essai-abo`,
    action: 'check_sale',
    essai_followup: true,
    check_kind: 'abo',
    gym: orderGym(order) || order.gym || full.gym || null,
    deciplus_member_id: order.deciplus_member_id || null,
    customer: {
      first_name: short.first_name || full.first_name || customer.first_name || '',
      last_name: short.last_name || full.last_name || customer.last_name || '',
      email: orderEmail(order),
      phone: short.phone || customer.phone || full.phone || '',
      birthdate: short.birthdate || full.birthdate || customer.birthdate || '',
    },
    source: 'essai-followup',
    status_callback_base: getStoreUrl(),
  };
}

function stripEssaiAboSuffix(orderId) {
  return String(orderId || '').replace(/#essai-abo$/i, '');
}

async function applyEssaiAboCheck(
  orderId,
  body = {},
  { loadOrder, saveOrder } = {}
) {
  const { loadOrderAsync, saveOrderAsync } = require('./order-lifecycle');
  const load = loadOrder || loadOrderAsync;
  const save = saveOrder || saveOrderAsync;
  const id = stripEssaiAboSuffix(orderId);
  const order = await load(id);
  if (!order) return null;
  const hasAbo = Boolean(body.has_abo || body.has_sale);
  order.deciplus_member_id = body.deciplus_member_id || order.deciplus_member_id || null;
  order.essai_abo_checked_at = new Date().toISOString();
  order.essai_has_abo = hasAbo;
  order.essai_followup_contracts = Array.isArray(body.contracts) ? body.contracts.slice(0, 8) : [];
  if (hasAbo) {
    order.essai_followup_status = 'converted';
  } else if (order.essai_followup_status !== 'sent') {
    order.essai_followup_status = 'ready';
  }
  await save(order);
  return order;
}

async function sendGymFollowup(order, { sendWa = sendWhatsAppMessage, dryRun = false } = {}) {
  const gym = getGymCoachTarget(orderGym(order));
  if (!gym) return { sent: false, reason: 'gym_no_coach' };
  const text = gymEssaiFollowupText(order);
  if (dryRun) return { sent: false, reason: 'dry_run', to: gym.telephone, text };
  try {
    const wa = await sendWa(gym.telephone, text);
    return { sent: true, to: gym.telephone, wa };
  } catch (err) {
    return { sent: false, error: err.message, to: gym.telephone };
  }
}

async function dispatchDueEssaiFollowups({
  now = Date.now(),
  dryRun = false,
  listOrders,
  loadOrder,
  saveOrder,
  sendWa = sendWhatsAppMessage,
  forwardJob,
} = {}) {
  const { listAllOrdersAsync, loadOrderAsync, saveOrderAsync } = require('./order-lifecycle');
  const listed = (await (listOrders || listAllOrdersAsync)()) || [];
  const keys = membershipKeysFromOrders(listed);
  let lastWaAt = lastFollowupWaAt(listed);
  const results = [];
  let checks = 0;
  let sent = 0;

  const due = listed
    .filter(isPaidEssaiOrder)
    .sort((a, b) => paidAtMs(a) - paidAtMs(b));

  for (const slim of due) {
    const decision = classifyEssaiFollowup(slim, { now, membershipKeys: keys, lastWaAt });
    if (decision.action === 'skip' || decision.action === 'wait') {
      results.push({ order_id: slim.order_id, ...decision });
      continue;
    }

    const load = loadOrder || loadOrderAsync;
    const save = saveOrder || saveOrderAsync;
    const order = (await load(slim.order_id)) || slim;

    if (decision.action === 'converted') {
      order.essai_followup_status = 'converted';
      order.essai_has_abo = true;
      if (typeof save === 'function') await save(order);
      results.push({ order_id: order.order_id, action: 'converted', reason: decision.reason });
      continue;
    }

    if (decision.action === 'enqueue_check') {
      if (checks >= MAX_CHECKS_PER_TICK) {
        results.push({ order_id: order.order_id, action: 'wait', reason: 'check_rate' });
        continue;
      }
      const job = essaiCheckSaleJob(order);
      let forwarded = { forwarded: false };
      if (!dryRun && typeof forwardJob === 'function') {
        forwarded = await forwardJob(job).catch((err) => ({ forwarded: false, error: err.message }));
      } else if (!dryRun) {
        const { forwardJobToBot } = require('../../lib/bot-forward');
        forwarded = await forwardJobToBot(job).catch((err) => ({
          forwarded: false,
          error: err.message,
        }));
      }
      order.essai_followup_status = 'queued_check';
      order.essai_followup_check_queued_at = new Date(now).toISOString();
      if (typeof save === 'function') await save(order);
      checks += 1;
      results.push({
        order_id: order.order_id,
        action: 'enqueue_check',
        forwarded: Boolean(forwarded?.forwarded),
        error: forwarded?.error || null,
      });
      continue;
    }

    if (decision.action === 'send') {
      if (sent >= 1) {
        results.push({ order_id: order.order_id, action: 'wait', reason: 'wa_gap' });
        continue;
      }
      const wa = await sendGymFollowup(order, { sendWa, dryRun });
      if (wa.sent || dryRun) {
        order.essai_followup_status = dryRun ? 'ready' : 'sent';
        order.essai_followup_at = new Date(now).toISOString();
        order.essai_followup_wa = wa;
        lastWaAt = now;
        sent += 1;
      } else {
        order.essai_followup_wa = wa;
      }
      if (typeof save === 'function') await save(order);
      if (wa.sent) {
        logInfo('WhatsApp essai 10 € → coach', {
          order_id: order.order_id,
          to: wa.to,
          gym: orderGym(order),
        });
      } else if (wa.error) {
        logWarn('WhatsApp essai 10 € coach échoué', {
          order_id: order.order_id,
          error: wa.error,
        });
      }
      results.push({ order_id: order.order_id, action: 'send', ...wa });
    }
  }

  return {
    ok: true,
    since: '2026-08-13',
    essais: due.length,
    checks,
    sent,
    results,
  };
}

module.exports = {
  ESSAI_SINCE_MS,
  FOLLOWUP_AFTER_MS,
  WA_GAP_MS,
  GYM_COACH_WHATSAPP,
  isPaidEssaiOrder,
  isMembershipOrder,
  isMembershipContract,
  getGymCoachTarget,
  gymEssaiFollowupText,
  membershipKeysFromOrders,
  hasLaterMembership,
  classifyEssaiFollowup,
  essaiCheckSaleJob,
  stripEssaiAboSuffix,
  applyEssaiAboCheck,
  sendGymFollowup,
  dispatchDueEssaiFollowups,
  orderEmail,
  orderPhone,
  orderGym,
  paidAtMs,
};
