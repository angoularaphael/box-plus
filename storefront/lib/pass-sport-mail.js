'use strict';

const fs = require('fs');
const { logInfo, logWarn } = require('../../lib/logger');
const { sendEmailViaResend, isConfigured } = require('./resend-send');
const {
  PASS_SPORT_CENTS,
  formatEuroLabel,
  passSportEmailForGym,
} = require('../../lib/pass-sport');

const GYM_LABELS = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'Saint-Cyprien',
};

function gymOf(order) {
  return order.customer_full?.gym || order.gym || order.customer?.gym || '';
}

function personName(parts = {}) {
  return `${parts.first_name || ''} ${parts.last_name || ''}`.replace(/\s+/g, ' ').trim();
}

function mimeFromName(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

async function loadPassSportFile(order) {
  const docs = order.documents || {};
  const filename = docs.pass_sport_filename || 'pass-sport.jpg';
  if (docs.pass_sport && fs.existsSync(docs.pass_sport)) {
    return {
      filename,
      content: fs.readFileSync(docs.pass_sport),
      contentType: mimeFromName(filename),
    };
  }
  const url = docs.pass_sport_url;
  if (!url || typeof url !== 'string') return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo_pass_sport_http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return { filename, content: buf, contentType: mimeFromName(filename) };
}

async function notifyPassSportIfNeeded(order) {
  if (!order?.payment?.pass_sport || order.payment.pass_sport_emailed_at) return { sent: false, reason: 'skip' };
  const to = passSportEmailForGym(gymOf(order));
  const child = personName(order.customer_short || {});
  const guardian = personName(order.customer_full?.guardian || {});
  const email = order.customer_short?.email || order.customer_full?.email || '';
  const phone = order.customer_short?.phone || order.customer_full?.phone || '';
  const gym = gymOf(order);
  const gymLabel = GYM_LABELS[String(gym).toLowerCase()] || gym || 'salle';
  const product =
    order.product_snapshot?.display_name ||
    order.product_snapshot?.name ||
    order.product_name ||
    'abonnement enfants';
  const listCents = Number(order.payment.list_price_cents || order.product_snapshot?.price_cents || 0);
  const chargeCents = Number(
    order.payment.charge_cents || Math.max(0, listCents - PASS_SPORT_CENTS)
  );
  const plan = String(order.payment.payment_plan || 'once');
  const subject = `Pass Sport - ${gymLabel} - ${child || 'enfant'} - ${product}`;
  const text = [
    'Un parent a déduit un Pass Sport de 50 € sur la boutique.',
    '',
    `Salle : ${gymLabel}`,
    `Enfant : ${child || '—'}`,
    guardian ? `Responsable : ${guardian}` : null,
    email ? `Email : ${email}` : null,
    phone ? `Téléphone : ${phone}` : null,
    `Offre : ${product}`,
    `Tarif saison : ${formatEuroLabel(listCents)}`,
    `Pass Sport : -${formatEuroLabel(PASS_SPORT_CENTS)}`,
    `Montant restant payé en ligne : ${formatEuroLabel(chargeCents)} (${plan})`,
    `Commande : ${order.order_id}`,
    '',
    'La photo du Pass Sport est en pièce jointe.',
    'Le contrat Deciplus reste au tarif catalogue. Ajustez le règlement pour que le parent ne paie que le montant restant.',
  ]
    .filter(Boolean)
    .join('\n');

  let file = null;
  try {
    file = await loadPassSportFile(order);
  } catch (err) {
    logWarn('Pass Sport photo illisible', { order_id: order.order_id, error: err.message });
  }

  if (!isConfigured()) {
    logInfo('Pass Sport email (mode log)', { to, order_id: order.order_id, subject });
    return { sent: false, reason: 'resend_off', to };
  }

  const result = await sendEmailViaResend({
    to,
    subject,
    text,
    html: text.replace(/\n/g, '<br>'),
    attachments: file ? [file] : [],
  });

  const { saveOrderAsync } = require('./order-lifecycle');
  const fresh = { ...order };
  fresh.payment = {
    ...(order.payment || {}),
    pass_sport_emailed_at: new Date().toISOString(),
    pass_sport_email_to: to,
  };
  await saveOrderAsync(fresh);
  logInfo('Pass Sport envoyé', { order_id: order.order_id, to, via: result?.via || null });
  return { sent: true, to };
}

module.exports = { notifyPassSportIfNeeded };
