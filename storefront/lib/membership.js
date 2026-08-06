'use strict';

const crypto = require('crypto');
const { dispatchOrder } = require('./orders');
const { findEnrichedProduct } = require('./merch');
const { isComptantStyleProduct } = require('../../lib/billing-plan');
const { sendEmailViaBrevo, isConfigured } = require('./brevo-send');
const { logInfo, logWarn } = require('../../lib/logger');

function listComptantTargets() {
  const { getEnrichedProducts } = require('./merch');
  return (getEnrichedProducts() || [])
    .filter((p) => isComptantStyleProduct(p) && /3|6|12/.test(String(p.name || '')))
    .map((p) => ({
      id: p.id,
      name: p.display_name || p.name,
      price_label: p.price_label || p.stripe_price_label,
      price_cents: p.price_cents,
    }));
}

function listCurrentPlans() {
  return [
    { id: 'prelevement-adulte', label: 'Prélèvement adulte (sans engagement)' },
    { id: 'prelevement-etudiant', label: 'Prélèvement étudiant' },
    { id: 'prelevement-promo', label: 'Prélèvement promo' },
    { id: 'autre', label: 'Autre / je ne sais pas' },
  ];
}

async function enqueueCancelRequest(body = {}) {
  const orderId = `CANCEL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const payload = {
    order_id: orderId,
    action: 'cancel',
    cancel_reason: body.reason || body.cancel_reason || 'resiliation_web',
    first_name: body.first_name,
    last_name: body.last_name,
    birthdate: body.birthdate,
    phone: body.phone,
    email: body.email,
    address: body.address,
    gym: body.gym || 'minimes',
    cancel_date: body.cancel_date,
    customer: {
      first_name: body.first_name,
      last_name: body.last_name,
      birthdate: body.birthdate,
      phone: body.phone,
      email: body.email,
      address: body.address,
    },
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
  const result = await dispatchOrder(payload);
  return { order_id: orderId, ...result };
}

async function enqueueChangeAfterPayment({ identity, targetProductId, stripeSessionId }) {
  const product = findEnrichedProduct(targetProductId);
  if (!product || !isComptantStyleProduct(product)) {
    throw new Error('Offre comptant cible invalide');
  }
  const baseId = `CHANGE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const cancel = await dispatchOrder({
    order_id: `${baseId}-cancel`,
    action: 'cancel',
    cancel_reason: 'change_to_comptant',
    first_name: identity.first_name,
    last_name: identity.last_name,
    birthdate: identity.birthdate,
    phone: identity.phone,
    email: identity.email,
    gym: identity.gym || 'minimes',
    customer: identity,
    product_name: 'Résiliation prélèvement (changement)',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  const sale = await dispatchOrder({
    order_id: baseId,
    action: 'sale',
    first_name: identity.first_name,
    last_name: identity.last_name,
    birthdate: identity.birthdate,
    phone: identity.phone,
    email: identity.email,
    gym: identity.gym || 'minimes',
    gender: identity.gender || 'M',
    address: identity.address || 'À compléter',
    postal_code: identity.postal_code || '31000',
    city: identity.city || 'Toulouse',
    customer: identity,
    product_id: product.id,
    product_name: product.name,
    deciplus_id: product.deciplus_id,
    price_cents: product.price_cents,
    requires_payment: true,
    requires_iban: false,
    sale_type: 'abonnement',
    payment_method: 'stripe',
    stripe_session_id: stripeSessionId,
    auto_badge: false,
  });

  await sendChangeConfirmationEmail(identity, product).catch(() => {});
  return { cancel, sale, order_id: baseId };
}

async function sendChangeConfirmationEmail(identity, product) {
  if (!identity?.email || !isConfigured()) return { sent: false };
  const html = `<p>Bonjour ${identity.first_name || ''},</p>
    <p>Votre demande de passage en <strong>${product.display_name || product.name}</strong> a bien été enregistrée.</p>
    <p>Le bot Boxing Center va couper votre prélèvement et activer le nouvel abonnement comptant.</p>
    <p>À bientôt au club.</p>`;
  try {
    await sendEmailViaBrevo({
      to: identity.email,
      subject: 'Changement d\'abonnement confirmé — Boxing Center',
      html,
    });
    logInfo('Email changement abo envoyé', { email: identity.email });
    return { sent: true };
  } catch (err) {
    logWarn('Email changement abo échoué', { error: err.message });
    return { sent: false };
  }
}

module.exports = {
  listComptantTargets,
  listCurrentPlans,
  enqueueCancelRequest,
  enqueueChangeAfterPayment,
};
