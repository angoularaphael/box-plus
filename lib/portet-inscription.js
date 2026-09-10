'use strict';

const { isChildOfferProduct } = require('./billing-plan');

function isPortetGym(gym) {
  return String(gym || '')
    .trim()
    .toLowerCase() === 'portet';
}

function orderGym(order = {}) {
  return (
    order.customer_full?.gym ||
    order.gym ||
    order.customer?.gym ||
    order.payment?.gym ||
    ''
  );
}

function isPortetKidsFlow(gym, product) {
  return isPortetGym(gym) && isChildOfferProduct(product);
}

function isPortetKidsOrder(order = {}) {
  const product =
    order.product_snapshot || {
      id: order.product_id,
      name: order.product_name || order.offer,
      subsection: order.subsection,
    };
  return isPortetKidsFlow(orderGym(order), product);
}

function normalizeGuardian(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const first_name = String(raw.first_name || raw.prenom || '').trim();
  const last_name = String(raw.last_name || raw.nom || '').trim();
  const phone = String(raw.phone || raw.telephone || '').trim();
  const email = String(raw.email || '')
    .trim()
    .toLowerCase();
  if (!first_name && !last_name && !phone && !email) return null;
  return { first_name, last_name, phone, email };
}

function validateGuardian(guardian) {
  const g = normalizeGuardian(guardian);
  const errors = [];
  if (!g?.first_name) errors.push('Prénom du responsable légal requis');
  if (!g?.last_name) errors.push('Nom du responsable légal requis');
  if (!g?.phone) errors.push('Téléphone du responsable légal requis');
  if (!g?.email) errors.push('E-mail du responsable légal requis');
  return errors;
}

function guardianDisplayName(guardian) {
  const g = normalizeGuardian(guardian);
  if (!g) return '';
  return [g.first_name, g.last_name].filter(Boolean).join(' ').trim();
}

function guardianAdminNote(guardian) {
  const g = normalizeGuardian(guardian);
  if (!g) return '';
  const bits = [`Tuteur : ${guardianDisplayName(g) || '—'}`];
  if (g.phone) bits.push(`tél ${g.phone}`);
  if (g.email) bits.push(g.email);
  return bits.join(' · ');
}

function guardianEmergencyContact(guardian) {
  const g = normalizeGuardian(guardian);
  if (!g) return null;
  const name = guardianDisplayName(g);
  return [name, g.phone].filter(Boolean).join(' — ') || null;
}

/** Portet 4× carte CAWL (1/4) puis RIB — pas PayPal, pas Oney. */
function isPortetCawl4xRib({ gym, paymentPlan, billingPlan, payMethod, preferredCheckout } = {}) {
  if (!isPortetGym(gym)) return false;
  if (String(paymentPlan || '').toLowerCase() !== '4x') return false;
  const method = String(payMethod || preferredCheckout || '').toLowerCase();
  if (method === 'paypal') return false;
  if (method === 'cawl' || method === 'card') return true;
  return String(billingPlan || '').toLowerCase() === 'rib';
}

function hasMemberPhoto(order = {}) {
  const docs = order.documents || {};
  return Boolean(docs.photo || docs.photo_url || docs.photo_filename || docs.has_photo || docs.photo_base64);
}

function hasIdDocument(order = {}) {
  const docs = order.documents || {};
  return Boolean(
    docs.id_document ||
      docs.id_document_url ||
      docs.id_document_filename ||
      docs.has_id_document
  );
}

function dossierStatus(order = {}) {
  if (!isPortetKidsOrder(order)) return null;
  const full = order.customer_full || {};
  const guardian = normalizeGuardian(full.guardian);
  const missing = [];
  if (!guardian?.first_name || !guardian?.last_name || !guardian?.phone || !guardian?.email) {
    missing.push('tuteur');
  }
  if (!full.address || !full.postal_code || !full.city) missing.push('adresse');
  if (!hasMemberPhoto(order)) missing.push('photo');
  if (!hasIdDocument(order)) missing.push('piece_identite');
  if (!['paid', 'free'].includes(String(order.payment?.status || ''))) missing.push('paiement');
  return {
    complete: missing.length === 0,
    missing,
    label: missing.length === 0 ? 'complet' : 'incomplet',
  };
}

module.exports = {
  isPortetGym,
  orderGym,
  isPortetKidsFlow,
  isPortetKidsOrder,
  normalizeGuardian,
  validateGuardian,
  guardianDisplayName,
  guardianAdminNote,
  guardianEmergencyContact,
  isPortetCawl4xRib,
  hasMemberPhoto,
  hasIdDocument,
  dossierStatus,
};
