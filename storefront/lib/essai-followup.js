'use strict';

/**
 * Essais boutique à 10 € :
 *  - J+0 / J+1 / J+2 : WhatsApp + e-mail au client (abonnement 29 € / 259 €)
 *  - J+3 : si toujours pas d’abo, WhatsApp au coach de la salle
 * Écart WhatsApp : 2 min. Périmètre : paiements depuis le 13 août 2026.
 */
const { matchGymSlug } = require('../../lib/gym-slugs');
const { getStoreUrl } = require('../../lib/app-urls');
const { logInfo, logWarn } = require('../../lib/logger');
const { isMembershipContract } = require('../../lib/sale-contract-match');
const { sendWhatsAppMessage } = require('./whatsapp-bot');
const { buildOfferCampaignEmail } = require('./campaign-email');

const ESSAI_SINCE_MS = Date.parse('2026-08-13T00:00:00+02:00');
const FOLLOWUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CUSTOMER_NUDGE_DAYS = 3;
const CUSTOMER_NUDGE_GAP_MS = 24 * 60 * 60 * 1000;
const WA_GAP_MS = 2 * 60 * 1000;
const CHECK_STALE_MS = 6 * 60 * 60 * 1000;
const MAX_CHECKS_PER_TICK = 5;

const GYM_COACH_WHATSAPP = {
  minimes: { telephone: '+33767919166', label: 'Minimes' },
  'etats-unis': { telephone: '+33767919166', label: 'États-Unis' },
  portet: { telephone: '+33687900216', label: 'Portet' },
  'st-cyprien': { telephone: '+33625745369', label: 'Saint-Cyprien' },
};

const OFFRE_29_IDS = new Set(['dp-104', 'offre-duo', 'offre_29', 'offre-29']);
const OFFRE_259_IDS = new Set(['dp-100', 'offre-saison', 'offre_259', 'offre-12mois']);

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

function isOffre29Order(order = {}) {
  const id = productIdOf(order);
  if (OFFRE_29_IDS.has(id)) return true;
  const name = productNameOf(order);
  if (/259/.test(name) || /44\s*99/.test(name)) return false;
  return /offre\s*(a|duo)?\s*29|29\s*99|29,99|29\.99/.test(name);
}

function isOffre259Order(order = {}) {
  const id = productIdOf(order);
  if (OFFRE_259_IDS.has(id)) return true;
  const name = productNameOf(order);
  if (/29\s*99|offre\s*(a|duo)?\s*29/.test(name) && !/259/.test(name)) return false;
  return /\b259\b|offre promo 12 mois|offre saison/.test(name);
}

/** Abonnement boutique qui compte : uniquement 29 € ou 259 €. */
function isMembershipOrder(order = {}) {
  if (!order || order.action) return false;
  if (/^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(String(order.order_id || ''))) return false;
  if (String(order.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isPaidEssaiOrder(order)) return false;
  return isOffre29Order(order) || isOffre259Order(order);
}

function getGymCoachTarget(salle) {
  const slug = matchGymSlug(salle) || String(salle || '').toLowerCase();
  return GYM_COACH_WHATSAPP[slug] || null;
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
    'Cette personne a pris une séance d’essai à 10 € et n’a pas pris d’abonnement 29 € ni 259 € 3 jours plus tard. Merci de la recontacter.',
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

function offersHubUrl() {
  return `${getStoreUrl()}/offres-speciales`;
}

function customerNudges(order = {}) {
  return Array.isArray(order.essai_customer_nudges) ? order.essai_customer_nudges : [];
}

function firstNameOf(order = {}) {
  return String(
    order.customer_short?.first_name || order.customer_full?.first_name || order.customer?.first_name || ''
  ).trim();
}

function displayFirstName(order = {}) {
  const raw = firstNameOf(order);
  if (!raw) return '';
  return raw
    .split(/([\s'-]+)/)
    .map((part, i) => {
      if (i % 2 === 1 || !part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

const OFFER_CAMPAIGN_BODY = `🚨 **DERNIÈRES PLACES POUR PROFITER DE L’OFFRE BOXING CENTER** 🥊

**Il reste encore quelques places disponibles.**

🔥 **29 € / 4 semaines**
→ Sans engagement
→ Sans préavis en cas de résiliation
→ Accès aux **5 salles**, toutes les disciplines et tous les cours

💥 **259 € / 12 mois**
→ Au lieu de 400 €
→ Possibilité de paiement **4 fois sans frais**
→ Accès aux **5 salles**, toutes les disciplines et tous les cours

⏳ **Profite de ton offre avant qu’il ne soit trop tard.**

**Tout se passe ici :**
__HUB_URL__

🥊 **29€ sans engagement, 259€ pour 12 mois**`;

function customerNudgeCopy(order, day = 1) {
  const name = displayFirstName(order);
  const hubUrl = offersHubUrl();
  const body = OFFER_CAMPAIGN_BODY.replace('__HUB_URL__', hubUrl);
  const text = name ? `${name},\n\n${body}` : body;
  const mail = buildOfferCampaignEmail({
    name,
    hubUrl,
    email: orderEmail(order),
  });
  return {
    day,
    subject: mail.subject,
    text,
    html: mail.html,
    emailText: mail.emailText,
    headers: mail.headers,
    attachments: mail.attachments,
    fromName: mail.fromName,
    replyTo: 'boxingcentertls@gmail.com',
    hubUrl,
    name,
  };
}

function classifyCustomerNudge(order, { now = Date.now(), membershipKeys } = {}) {
  if (!isPaidEssaiOrder(order)) return { action: 'skip', reason: 'not_paid_essai' };
  const paid = paidAtMs(order);
  if (!paid || paid < ESSAI_SINCE_MS) return { action: 'skip', reason: 'before_13_aout' };
  const status = String(order.essai_followup_status || '');
  if (status === 'converted' || order.essai_has_abo) {
    return { action: 'skip', reason: 'converted' };
  }
  if (hasLaterMembership(order, membershipKeys || { emails: new Set(), phones: new Set() })) {
    return { action: 'skip', reason: 'has_membership' };
  }
  if (now >= paid + FOLLOWUP_AFTER_MS) return { action: 'skip', reason: 'coach_window' };
  const sent = customerNudges(order);
  if (sent.length >= CUSTOMER_NUDGE_DAYS) return { action: 'skip', reason: 'nudges_done' };
  const day = sent.length + 1;
  const earliest = paid + (day - 1) * CUSTOMER_NUDGE_GAP_MS;
  if (now < earliest) return { action: 'wait', reason: 'before_day', day };
  if (!orderEmail(order) && !orderPhone(order)) {
    return { action: 'skip', reason: 'no_contact' };
  }
  return { action: 'nudge_customer', day, reason: `day_${day}` };
}

async function sendCustomerNudge(
  order,
  day,
  { sendWa, sendEmail, dryRun = false } = {}
) {
  const copy = customerNudgeCopy(order, day);
  const emailTo = orderEmail(order);
  const phone = orderPhone(order) || order.customer_short?.phone || order.customer?.phone || '';
  const out = { day, email: { sent: false }, whatsapp: { sent: false }, copy };
  if (dryRun) return { ...out, dry: true };
  const liveWa = !sendWa;
  const waSend = sendWa || ((to, text) => sendWhatsAppMessage(to, text, { kind: 'promo' }));

  if (emailTo) {
    try {
      const send = sendEmail || (async (payload) => {
        const { sendEmailViaResend, isConfigured } = require('./resend-send');
        if (!isConfigured()) return { sent: false, reason: 'resend_not_configured' };
        const result = await sendEmailViaResend(payload);
        if (!result) return { sent: false, reason: 'resend_not_configured' };
        return { sent: true, via: result.via || 'resend' };
      });
      out.email = await send({
        to: emailTo,
        subject: copy.subject,
        html: copy.html || undefined,
        text: copy.emailText || copy.text,
        headers: copy.headers,
        attachments: copy.attachments,
        fromName: copy.fromName,
        replyTo: copy.replyTo || 'boxingcentertls@gmail.com',
      });
    } catch (err) {
      out.email = { sent: false, error: err.message };
      logWarn('Email Relance offre 29/259 (Resend)', { order_id: order.order_id, error: err.message });
    }
  } else {
    out.email = { sent: false, reason: 'no_email' };
  }

  if (phone) {
    const { isPromoWhatsAppPaused } = require('./whatsapp-outbound');
    if (liveWa && isPromoWhatsAppPaused()) {
      out.whatsapp = { sent: false, skipped: true, reason: 'promo_paused', to: phone };
    } else {
      try {
        const wa = await waSend(phone, copy.text);
        out.whatsapp = { sent: true, to: phone, wa };
      } catch (err) {
        out.whatsapp = { sent: false, error: err.message, to: phone };
        logWarn('WhatsApp relance essai 10 € client', { order_id: order.order_id, error: err.message });
      }
    }
  } else {
    out.whatsapp = { sent: false, reason: 'no_phone' };
  }

  out.sent = Boolean(out.email.sent || out.whatsapp.sent);
  return out;
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
    const stamps = [order.essai_followup_at];
    for (const nudge of customerNudges(order)) {
      stamps.push(nudge.wa_at || nudge.at);
    }
    for (const stamp of stamps) {
      const t = Date.parse(stamp || '');
      if (Number.isFinite(t) && t > latest) latest = t;
    }
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
  const { isPromoWhatsAppPaused } = require('./whatsapp-outbound');
  if (sendWa === sendWhatsAppMessage && isPromoWhatsAppPaused()) {
    return { sent: false, skipped: true, reason: 'promo_paused' };
  }
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
  sendEmail,
  forwardJob,
} = {}) {
  const { listAllOrdersAsync, loadOrderAsync, saveOrderAsync } = require('./order-lifecycle');
  const listed = (await (listOrders || listAllOrdersAsync)()) || [];
  const keys = membershipKeysFromOrders(listed);
  let lastWaAt = lastFollowupWaAt(listed);
  const results = [];
  let checks = 0;
  let sent = 0;
  let customerNudgesSent = 0;

  const due = listed
    .filter(isPaidEssaiOrder)
    .sort((a, b) => paidAtMs(a) - paidAtMs(b));

  for (const slim of due) {
    const load = loadOrder || loadOrderAsync;
    const save = saveOrder || saveOrderAsync;

    const customerDecision = classifyCustomerNudge(slim, { now, membershipKeys: keys });
    if (customerDecision.action === 'nudge_customer') {
      if (sent + customerNudgesSent >= 1 || now - lastWaAt < WA_GAP_MS) {
        results.push({
          order_id: slim.order_id,
          action: 'wait',
          reason: 'wa_gap',
          kind: 'customer',
        });
        continue;
      }
      const order = (await load(slim.order_id)) || slim;
      const live = classifyCustomerNudge(order, { now, membershipKeys: keys });
      if (live.action !== 'nudge_customer') {
        results.push({ order_id: order.order_id, ...live, kind: 'customer' });
      } else {
        const nudge = await sendCustomerNudge(order, live.day, { sendWa, sendEmail, dryRun });
        if (nudge.sent || dryRun) {
          order.essai_customer_nudges = [
            ...customerNudges(order),
            {
              day: live.day,
              at: new Date(now).toISOString(),
              wa_at: nudge.whatsapp?.sent ? new Date(now).toISOString() : null,
              email: Boolean(nudge.email?.sent),
              whatsapp: Boolean(nudge.whatsapp?.sent),
            },
          ].slice(0, CUSTOMER_NUDGE_DAYS);
          lastWaAt = now;
          customerNudgesSent += 1;
          if (nudge.whatsapp?.sent) {
            logInfo('WhatsApp essai 10 € → client', {
              order_id: order.order_id,
              day: live.day,
            });
          }
        }
        if (typeof save === 'function') await save(order);
        results.push({
          order_id: order.order_id,
          action: 'nudge_customer',
          day: live.day,
          sent: Boolean(nudge.sent || dryRun),
          email: nudge.email,
          whatsapp: nudge.whatsapp,
        });
      }
      continue;
    }

    const decision = classifyEssaiFollowup(slim, { now, membershipKeys: keys, lastWaAt });
    if (decision.action === 'skip' || decision.action === 'wait') {
      results.push({ order_id: slim.order_id, ...decision });
      continue;
    }

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
      if (sent >= 1 || customerNudgesSent >= 1) {
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
    customer_nudges: customerNudgesSent,
    results,
  };
}

module.exports = {
  ESSAI_SINCE_MS,
  FOLLOWUP_AFTER_MS,
  CUSTOMER_NUDGE_DAYS,
  CUSTOMER_NUDGE_GAP_MS,
  WA_GAP_MS,
  GYM_COACH_WHATSAPP,
  isPaidEssaiOrder,
  isMembershipOrder,
  isMembershipContract,
  getGymCoachTarget,
  gymEssaiFollowupText,
  customerNudgeCopy,
  classifyCustomerNudge,
  sendCustomerNudge,
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
  orderName,
  paidAtMs,
  isOffre29Order,
  isOffre259Order,
};
