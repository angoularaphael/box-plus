'use strict';

/** Déduction Pass Sport sur Baby Boxe (250 € -> 200 €) et Boxe enfants / éducative (295 € -> 245 €). */
const PASS_SPORT_CENTS = 5000;
const CLUB_EMAIL = 'boxingcenter31@gmail.com';
const PORTET_EMAIL = 'boxingcenterportet@gmail.com';

function productSupportsPassSport(product = {}) {
  if (!product) return false;
  const id = String(product.id || product.product_id || '').toLowerCase();
  const legacy = String(product.legacy_id || '').toLowerCase();
  const title = String(product.name || product.display_name || product.product_name || '');
  if (id === 'baby-boxe' || legacy === 'baby-boxe' || id === 'dp-93') return true;
  if (id === 'boxe-educative' || legacy === 'boxe-educative' || id === 'dp-45') return true;
  if (/BABY\s*BOXE/i.test(title)) return true;
  if (/BOXE\s*[EÉ]DUCATIVE/i.test(title)) return true;
  return false;
}

function passSportChargeCents(product) {
  const list = Number(product?.price_cents || 0);
  if (!productSupportsPassSport(product) || !Number.isFinite(list) || list <= 0) return list;
  return Math.max(0, list - PASS_SPORT_CENTS);
}

function formatEuroLabel(cents) {
  return `${(Number(cents) / 100).toFixed(2).replace('.', ',')} €`;
}

function passSportEmailForGym(gym) {
  const g = String(gym || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (g === 'portet' || g.includes('portet')) return PORTET_EMAIL;
  return CLUB_EMAIL;
}

function wantsPassSport(body = {}) {
  const v = body.pass_sport;
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

function orderHasPassSportPhoto(order = {}) {
  const docs = order.documents || {};
  return Boolean(docs.pass_sport_url || docs.pass_sport || docs.pass_sport_filename);
}

module.exports = {
  PASS_SPORT_CENTS,
  CLUB_EMAIL,
  PORTET_EMAIL,
  productSupportsPassSport,
  passSportChargeCents,
  formatEuroLabel,
  passSportEmailForGym,
  wantsPassSport,
  orderHasPassSportPhoto,
};
