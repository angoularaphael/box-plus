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
  // Pas de « Prélèvement promo » — retiré volontairement
  return [
    { id: 'prelevement-adulte', label: 'Prélèvement adulte (sans engagement)' },
    { id: 'prelevement-etudiant', label: 'Prélèvement étudiant' },
    { id: 'autre', label: 'Autre / je ne sais pas' },
  ].filter((p) => !/promo/i.test(p.id) && !/promo/i.test(p.label));
}

const MANAGER_LABELS = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'St-Cyprien',
};

function getManagerContact(gym) {
  const id = String(gym || '').trim().toLowerCase();
  if (!MANAGER_LABELS[id]) return null;
  const envKey = `MANAGER_EMAIL_${id.replace(/-/g, '_').toUpperCase()}`;
  return {
    gym: id,
    label: MANAGER_LABELS[id],
    email:
      String(process.env[envKey] || process.env.MANAGER_EMAIL_DEFAULT || 'boxingcenter31@gmail.com').trim(),
  };
}

async function enqueueCancelRequest(body = {}) {
  const orderId = `CANCEL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const customer = {
    first_name: body.first_name,
    last_name: body.last_name,
    birthdate: body.birthdate,
    phone: body.phone,
    email: body.email,
    address: body.address,
    postal_code: body.postal_code,
    city: body.city,
  };
  const payload = {
    order_id: orderId,
    action: 'cancel',
    cancel_reason: body.reason || body.cancel_reason || 'resiliation_web',
    cancel_reason_detail: body.reason_detail || body.free_text || null,
    first_name: body.first_name,
    last_name: body.last_name,
    birthdate: body.birthdate,
    phone: body.phone,
    email: body.email,
    address: body.address,
    postal_code: body.postal_code,
    city: body.city,
    gym: body.gym || 'minimes',
    cancel_date: body.cancel_date,
    customer,
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
  const result = await dispatchOrder(payload);
  // Enregistrement statut pour le suivi front (spinner + mismatch en direct)
  try {
    const { saveOrderAsync } = require('./order-persistence');
    await saveOrderAsync({
      order_id: orderId,
      action: 'cancel',
      cancel_status: 'pending',
      customer,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logWarn('Statut résiliation non persisté', { order_id: orderId, error: err.message });
  }
  return { order_id: orderId, ...result };
}

const CANCEL_FIELD_LABELS = {
  last_name: 'Nom',
  first_name: 'Prénom',
  phone: 'Téléphone',
  birthdate: 'Date de naissance',
};

async function updateCancelStatus(orderId, { status, mismatch_fields, reason, cancelled_count } = {}) {
  const { loadOrder, saveOrderAsync } = require('./order-persistence');
  const record = (await loadOrder(orderId)) || { order_id: orderId, action: 'cancel' };
  record.cancel_status = status || record.cancel_status || 'pending';
  record.mismatch_fields = Array.isArray(mismatch_fields) ? mismatch_fields : record.mismatch_fields || [];
  record.cancel_status_reason = reason || record.cancel_status_reason || null;
  if (cancelled_count != null) record.cancelled_count = cancelled_count;
  record.cancel_status_at = new Date().toISOString();
  await saveOrderAsync(record);
  return record;
}

async function getCancelStatus(orderId) {
  const { loadOrder } = require('./order-persistence');
  const record = await loadOrder(orderId);
  if (!record) return null;
  return {
    order_id: orderId,
    status: record.cancel_status || 'pending',
    mismatch_fields: record.mismatch_fields || [],
    reason: record.cancel_status_reason || null,
    customer: record.customer || null,
  };
}

async function sendCancelMismatchEmail(identity = {}, mismatchFields = []) {
  if (!identity?.email || !isConfigured()) return { sent: false };
  const prenom = identity.first_name || '';
  const fields = (mismatchFields || [])
    .map((f) => CANCEL_FIELD_LABELS[f])
    .filter(Boolean);
  const fieldsHtml = fields.length
    ? `<p>Champ(s) en cause : <strong>${fields.join(', ')}</strong>.</p>`
    : '';
  const html = `<p>Bonjour ${prenom},</p>
    <p>Nous avons bien reçu votre demande de résiliation, mais <strong>les informations renseignées ne correspondent pas</strong> à celles enregistrées sur votre fiche adhérent Boxing Center.</p>
    <p>Pour des raisons de sécurité, une seule information incorrecte (nom, prénom, téléphone ou date de naissance) empêche le traitement automatique.</p>
    ${fieldsHtml}
    <p>Si vous souhaitez vraiment résilier, merci de <strong>vérifier que toutes les informations sont exactes</strong> — telles qu’elles figurent sur votre contrat / fiche adhérent — puis de renouveler la demande depuis <a href="https://box-plus.vercel.app/gerer-abonnement">Gérer mon abonnement</a>.</p>
    <p>En cas de doute, contactez votre manager de salle ou écrivez-nous à boxingcenter31@gmail.com.</p>
    <p>Sportivement,<br/>Boxing Center</p>`;
  try {
    await sendEmailViaBrevo({
      to: identity.email,
      subject: 'Résiliation — informations à vérifier — Boxing Center',
      html,
    });
    logInfo('Email mismatch résiliation envoyé', { email: identity.email });
    return { sent: true };
  } catch (err) {
    logWarn('Email mismatch résiliation échoué', { error: err.message });
    return { sent: false };
  }
}

async function enqueueChangeAfterPayment({ identity, targetProductId, stripeSessionId }) {
  const product = findEnrichedProduct(targetProductId);
  if (!product || !isComptantStyleProduct(product)) {
    throw new Error('Offre comptant cible invalide');
  }
  const baseId = `CHANGE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const today = new Date().toISOString().slice(0, 10);
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
    cancel_date: today,
    effective_date: today,
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
    sale_date: today,
    effective_date: today,
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
  getManagerContact,
  enqueueCancelRequest,
  enqueueChangeAfterPayment,
  sendCancelMismatchEmail,
  updateCancelStatus,
  getCancelStatus,
  CANCEL_FIELD_LABELS,
};
