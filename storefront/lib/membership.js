'use strict';

const crypto = require('crypto');
const { dispatchOrder } = require('./orders');
const { findEnrichedProduct } = require('./merch');
const { isComptantStyleProduct } = require('../../lib/billing-plan');
const { sendEmailViaBrevo, isConfigured } = require('./brevo-send');
const { logInfo, logWarn } = require('../../lib/logger');

function listComptantTargets() {
  const { getEnrichedProducts } = require('./merch');
  const { productSupportsInstallmentChoice } = require('../../lib/billing-plan');
  return (getEnrichedProducts() || [])
    .filter((p) => isComptantStyleProduct(p) && /3|6|12|259|baby|educative|éducative/i.test(String(p.name || p.display_name || p.id || '')))
    .map((p) => ({
      id: p.id,
      name: p.display_name || p.name,
      price_label: p.price_label || p.stripe_price_label,
      price_cents: p.price_cents,
      supports_installment_choice: productSupportsInstallmentChoice(p),
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

const MANAGER_NAMES = {
  minimes: 'Mehdi',
  ramonville: 'Pascal',
  portet: 'Valentin',
  'etats-unis': 'Sébastien',
  'st-cyprien': 'Dadi',
};

function getManagerContact(gym) {
  const id = String(gym || '').trim().toLowerCase();
  if (!MANAGER_LABELS[id]) return null;
  const envKey = `MANAGER_EMAIL_${id.replace(/-/g, '_').toUpperCase()}`;
  return {
    gym: id,
    label: MANAGER_LABELS[id],
    manager: MANAGER_NAMES[id] || null,
    email:
      String(process.env[envKey] || process.env.MANAGER_EMAIL_DEFAULT || 'boxingcenter31@gmail.com').trim(),
  };
}

async function enqueueVerifyIdentity(body = {}) {
  const orderId = `VERIFY-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const customer = {
    first_name: body.first_name,
    last_name: body.last_name,
    birthdate: body.birthdate,
    phone: body.phone,
    email: body.email,
  };
  const payload = {
    order_id: orderId,
    action: 'verify_identity',
    // Par défaut = changement d’abo : nom + prénom + naissance
    verify_mode: body.verify_mode || 'change',
    first_name: body.first_name,
    last_name: body.last_name,
    birthdate: body.birthdate,
    phone: body.phone,
    email: body.email,
    gym: body.gym || 'minimes',
    customer,
    product_name: 'Vérification identité',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
  const result = await dispatchOrder(payload);
  try {
    const { saveOrderAsync } = require('./order-persistence');
    await saveOrderAsync({
      order_id: orderId,
      access_token: crypto.randomBytes(16).toString('hex'),
      action: 'verify_identity',
      cancel_status: 'pending',
      mismatch_fields: [],
      customer,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logWarn('Statut verify non persisté', { order_id: orderId, error: err.message });
  }
  return { order_id: orderId, ...result };
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
    cancel_date: body.cancel_date || new Date().toISOString().slice(0, 10),
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
    const accessToken = crypto.randomBytes(16).toString('hex');
    await saveOrderAsync({
      order_id: orderId,
      access_token: accessToken,
      action: 'cancel',
      cancel_status: 'pending',
      mismatch_fields: [],
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

async function updateCancelStatus(
  orderId,
  { status, mismatch_fields, reason, cancelled_count, deciplus_member_id } = {}
) {
  const { loadOrder, saveOrderAsync } = require('./order-persistence');
  const record = (await loadOrder(orderId)) || {
    order_id: orderId,
    action: 'cancel',
    access_token: `cancel-${orderId}`,
  };
  if (!record.access_token) record.access_token = `cancel-${orderId}`;
  if (!record.action) record.action = 'cancel';
  record.cancel_status = status || record.cancel_status || 'pending';
  record.mismatch_fields = Array.isArray(mismatch_fields) ? mismatch_fields : record.mismatch_fields || [];
  record.cancel_status_reason = reason || record.cancel_status_reason || null;
  if (cancelled_count != null) record.cancelled_count = cancelled_count;
  if (deciplus_member_id) record.deciplus_member_id = String(deciplus_member_id);
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
    <p>Si vous souhaitez vraiment résilier, merci de <strong>vérifier que toutes les informations sont exactes</strong> — telles qu’elles figurent sur votre contrat / fiche adhérent — puis de renouveler la demande depuis <a href="https://boutique.boxingcenter.fr/gerer-abonnement">Gérer mon abonnement</a>.</p>
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

function changeBaseIdFromPayment(paymentRef) {
  const ref = String(paymentRef || '').trim();
  if (!ref) return `CHANGE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const slug = ref.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 72);
  return `CHANGE-${slug}`;
}

async function resolveDeciplusMemberId(meta = {}, getCancelStatusFn) {
  let deciplusMemberId = meta.deciplus_member_id || null;
  if (deciplusMemberId || !meta.verify_order_id) return deciplusMemberId;
  try {
    const { loadOrder } = require('./order-persistence');
    const verified = await loadOrder(meta.verify_order_id);
    if (verified?.deciplus_member_id) return verified.deciplus_member_id;
    if (getCancelStatusFn) {
      const st = await getCancelStatusFn(meta.verify_order_id);
      if (st?.deciplus_member_id) return st.deciplus_member_id;
    }
  } catch {
    /* ignore */
  }
  return deciplusMemberId;
}

async function confirmMembershipChangeOnce({
  identity,
  targetProductId,
  stripeSessionId,
  deciplusMemberId = null,
}) {
  const baseId = changeBaseIdFromPayment(stripeSessionId);
  const lockId = `${baseId}-lock`;
  const { loadOrder, saveOrderAsync } = require('./order-persistence');
  const existing = await loadOrder(lockId);
  if (existing?.change_status === 'queued' || existing?.change_status === 'processing') {
    logInfo('Changement abo déjà en file (idempotent)', {
      payment_ref: stripeSessionId,
      order_id: existing.change_order_id || baseId,
    });
    return {
      already_processed: true,
      order_id: existing.change_order_id || baseId,
      cancel: existing.cancel_dispatch || { queued: false, reason: 'already_processed' },
      sale: existing.sale_dispatch || { queued: false, reason: 'already_processed' },
    };
  }

  await saveOrderAsync({
    order_id: lockId,
    access_token: `change-lock-${baseId}`,
    action: 'membership_change_lock',
    change_order_id: baseId,
    payment_ref: stripeSessionId,
    change_status: 'processing',
    customer: identity,
    created_at: new Date().toISOString(),
  });

  const result = await enqueueChangeAfterPayment({
    identity,
    targetProductId,
    stripeSessionId,
    deciplusMemberId,
    baseId,
  });

  await saveOrderAsync({
    order_id: lockId,
    access_token: `change-lock-${baseId}`,
    action: 'membership_change_lock',
    change_order_id: baseId,
    payment_ref: stripeSessionId,
    change_status: 'queued',
    customer: identity,
    cancel_dispatch: result.cancel,
    sale_dispatch: result.sale,
    updated_at: new Date().toISOString(),
  });

  return { already_processed: false, ...result };
}

async function enqueueChangeAfterPayment({
  identity,
  targetProductId,
  stripeSessionId,
  deciplusMemberId = null,
  baseId: baseIdIn = null,
}) {
  const product = findEnrichedProduct(targetProductId);
  if (!product || !isComptantStyleProduct(product)) {
    throw new Error('Offre comptant cible invalide');
  }
  const baseId = baseIdIn || changeBaseIdFromPayment(stripeSessionId);
  const today = new Date().toISOString().slice(0, 10);
  const memberId = deciplusMemberId || identity.deciplus_member_id || null;
  // member_id déjà vérifié → le bot saute la re-recherche identité (beaucoup plus rapide)
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
    deciplus_member_id: memberId || undefined,
    cancel_date: today,
    effective_date: today,
    product_name: 'Résiliation prélèvement (changement)',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  const amountEuros = Number(product.price_cents || 0) / 100;
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
    deciplus_member_id: memberId || undefined,
    product_id: product.id,
    product_name: product.name,
    deciplus_id: product.deciplus_id,
    deciplus_product_search: product.deciplus_product_search || null,
    price_cents: product.price_cents,
    requires_payment: true,
    requires_iban: false,
    sale_type: 'abonnement',
    payment_method: 'stripe',
    stripe_session_id: stripeSessionId,
    sale_date: today,
    effective_date: today,
    auto_badge: false,
    paiement_comptant: true,
    // Montant requis par validateOrder (sinon seule la résiliation partait)
    payment: {
      amount: amountEuros,
      method: 'stripe',
      status: 'paid',
      date: new Date().toISOString(),
      stripe_session_id: stripeSessionId,
    },
    // E-mail de confirmation envoyé par le bot à la fin du job (pas ici)
    notify_change_complete: true,
    change_product_name: product.display_name || product.name,
    source: 'storefront-change',
  });

  return { cancel, sale, order_id: baseId };
}

async function sendChangeConfirmationEmail(identity, product = {}) {
  if (!identity?.email || !isConfigured()) return { sent: false };
  const offer = product.display_name || product.name || product.change_product_name || 'abonnement comptant';
  const html = `<p>Bonjour ${identity.first_name || ''},</p>
    <p>Bonne nouvelle : votre passage en <strong>${offer}</strong> est <strong>bien enregistré et actif</strong>.</p>
    <p>Votre ancien prélèvement a été coupé et le nouvel abonnement comptant est en place. Il peut mettre <strong>quelques minutes</strong> à apparaître partout côté club.</p>
    <p>À bientôt sur le ring,<br/>Boxing Center</p>`;
  try {
    await sendEmailViaBrevo({
      to: identity.email,
      subject: 'Votre abonnement comptant est actif — Boxing Center',
      html,
    });
    logInfo('Email changement abo (fin de job) envoyé', { email: identity.email });
    return { sent: true };
  } catch (err) {
    logWarn('Email changement abo échoué', { error: err.message });
    return { sent: false };
  }
}

function changePendingId(paymentRef) {
  const safe = String(paymentRef || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  return `chgpend-${safe || 'unknown'}`;
}

async function saveMembershipChangePending(paymentRef, payload = {}) {
  const { saveOrderAsync } = require('./order-persistence');
  const orderId = changePendingId(paymentRef);
  await saveOrderAsync({
    order_id: orderId,
    access_token: `chgpend-${orderId}`,
    action: 'membership_change_pending',
    payment_ref: String(paymentRef || ''),
    created_at: new Date().toISOString(),
    ...payload,
  });
  return orderId;
}

async function loadMembershipChangePending(paymentRef) {
  const { loadOrder } = require('./order-persistence');
  return loadOrder(changePendingId(paymentRef));
}

module.exports = {
  listComptantTargets,
  listCurrentPlans,
  getManagerContact,
  enqueueCancelRequest,
  enqueueVerifyIdentity,
  enqueueChangeAfterPayment,
  confirmMembershipChangeOnce,
  resolveDeciplusMemberId,
  changeBaseIdFromPayment,
  sendCancelMismatchEmail,
  sendChangeConfirmationEmail,
  updateCancelStatus,
  getCancelStatus,
  saveMembershipChangePending,
  loadMembershipChangePending,
  changePendingId,
  CANCEL_FIELD_LABELS,
};
