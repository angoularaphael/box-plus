'use strict';

const crypto = require('crypto');

const GYM_SLUGS = new Set([
  'minimes',
  'ramonville',
  'portet',
  'etats-unis',
  'st-cyprien',
  'balma',
]);

function formatPriceLabel(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return '';
  const euros = n / 100;
  if (Number.isInteger(euros)) return `${euros} €`;
  return `${euros.toFixed(2).replace('.', ',')} €`;
}

function parsePriceCents(input = {}) {
  if (input.price_cents != null && input.price_cents !== '') {
    const cents = Math.round(Number(input.price_cents));
    if (Number.isFinite(cents) && cents > 0 && cents <= 500000) return cents;
  }
  const raw = String(input.price_euros ?? input.price ?? '').trim().replace(',', '.');
  const euros = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(euros) || euros <= 0 || euros > 5000) return null;
  return Math.round(euros * 100);
}

function normalizeMode(value) {
  const mode = String(value || '').toLowerCase().trim();
  if (mode === 'comptant') return 'comptant';
  if (mode === 'abonnement' || mode === 'prelevement' || mode === 'prélèvement' || mode === 'rib') {
    return 'abonnement';
  }
  return null;
}

function normalizeGym(value) {
  const gym = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  return GYM_SLUGS.has(gym) ? gym : null;
}

function normalizeCustomerShort(input = {}) {
  const first_name = String(input.first_name || '').trim();
  const last_name = String(input.last_name || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || input.telephone || '').trim();
  const birthdate = String(input.birthdate || '').trim();
  if (!first_name && !last_name && !email && !phone) return null;
  return { first_name, last_name, email, phone, birthdate };
}

function buildCustomOfferProduct(input = {}) {
  const cents = parsePriceCents(input);
  if (!cents) {
    const err = new Error('Indique un prix valide (ex. 39 ou 39,90)');
    err.status = 400;
    throw err;
  }
  const mode = normalizeMode(input.mode || input.payment_mode);
  if (!mode) {
    const err = new Error('Choisis comptant ou abonnement');
    err.status = 400;
    throw err;
  }
  const priceLabel = formatPriceLabel(cents);
  const customName = String(input.label || input.name || '').trim();
  const id = `custom-${crypto.randomBytes(4).toString('hex')}`;
  const comptant = mode === 'comptant';
  const name =
    customName ||
    (comptant ? `Offre personnalisée ${priceLabel} comptant` : `Offre personnalisée ${priceLabel} / 4 semaines`);
  return {
    id,
    name,
    display_name: name,
    description: comptant
      ? 'Offre négociée avec Boxing Center. Paiement comptant, puis dossier d’inscription.'
      : 'Offre négociée avec Boxing Center. 1ʳᵉ échéance CB, puis prélèvement toutes les 4 semaines, sans engagement.',
    price_cents: cents,
    price_label: priceLabel,
    stripe_price_label: priceLabel,
    requires_iban: !comptant,
    requires_payment: true,
    supports_billing_choice: false,
    supports_installment_choice: false,
    tab: 'abonnements',
    subsection: comptant ? 'comptant' : 'prelevement',
    duration_label: comptant ? 'Comptant' : 'Toutes les 4 semaines',
    badge: comptant ? 'Comptant' : 'Sans engagement',
    benefits: [
      'Accès aux 5 salles Boxing Center',
      'Cours illimités toutes disciplines',
      comptant ? `Paiement unique ${priceLabel}` : `${priceLabel} toutes les 4 semaines, sans engagement`,
    ],
    sale_type: 'custom',
  };
}

function prepareCustomOffer(input = {}) {
  const product = buildCustomOfferProduct(input);
  return {
    product_id: product.id,
    product,
    customer_short: normalizeCustomerShort(input),
    gym: normalizeGym(input.gym),
    source: 'custom_offer',
  };
}

function landingUrl(order, storeUrl) {
  const base = String(storeUrl || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({
    order: String(order?.order_id || ''),
    token: String(order?.access_token || ''),
  });
  return `${base}/offre-perso?${qs}`;
}

module.exports = {
  formatPriceLabel,
  parsePriceCents,
  normalizeMode,
  normalizeGym,
  normalizeCustomerShort,
  buildCustomOfferProduct,
  prepareCustomOffer,
  landingUrl,
};
