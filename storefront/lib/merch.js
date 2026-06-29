/**
 * Fusion catalogue Deciplus + merchandising boutique
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { getStoreProducts } = require('./deciplus-sync');

const MERCH_FILE = path.join(ROOT, 'storefront', 'storefront-merch.json');

function loadMerch() {
  try {
    return JSON.parse(fs.readFileSync(MERCH_FILE, 'utf8'));
  } catch {
    return { featured_home: [], products: {}, materiel: [] };
  }
}

function saveMerch(data) {
  fs.writeFileSync(MERCH_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function inferSubsection(product) {
  const name = String(product.name || '').toUpperCase();
  if (/BABY|EDUCATIVE|ENFANT/i.test(name)) return 'enfants';
  if (/COMPTANT/i.test(name)) return 'comptant';
  if (/PROMO|OFFRE|ÉTÉ|ETE|DUO/i.test(name)) return 'promo';
  if (/ETUDIANT|36|44|SEMAINE/i.test(name)) return 'prelevement';
  return 'prelevement';
}

function buildManualProduct(id, merch, entry) {
  const isEssai = id === 'seance-essai';
  return {
    id,
    name: entry.display_name || id,
    category: entry.tab === 'coachings' ? 'Coachings' : 'Essai',
    price_cents: entry.price_cents ?? (isEssai ? 1000 : 0),
    price_label: entry.marketing_price_label || (isEssai ? '10,00 €' : '—'),
    stripe_price_label: entry.marketing_price_label || (isEssai ? '10,00 €' : '—'),
    pay_today_label: entry.marketing_price_label || (isEssai ? '10,00 €' : '—'),
    requires_iban: entry.requires_iban ?? false,
    requires_payment: entry.requires_payment ?? (isEssai ? true : false),
    sale_type: entry.sale_type || (isEssai ? 'none' : 'carte'),
    manual: true,
    deciplus_product_search: isEssai ? 'essai' : null,
    ...entry,
  };
}

function isPromoActive(merchEntry) {
  if (!merchEntry?.promo_start && !merchEntry?.promo_end) return true;
  const now = new Date();
  if (merchEntry.promo_start && now < new Date(merchEntry.promo_start)) return false;
  if (merchEntry.promo_end && now > new Date(merchEntry.promo_end)) return false;
  return true;
}

function enrichProduct(catalogProduct, merchEntry = {}) {
  const subsection = merchEntry.subsection || inferSubsection(catalogProduct);
  return {
    ...catalogProduct,
    tab: merchEntry.tab || 'abonnements',
    subsection,
    display_name: merchEntry.display_name || catalogProduct.name,
    benefits: merchEntry.benefits || [],
    audience: merchEntry.audience || null,
    duration_label: merchEntry.duration_label || null,
    badge: merchEntry.badge || catalogProduct.badge || null,
    featured: merchEntry.featured || false,
    sort_order: merchEntry.sort_order ?? 99,
    active: merchEntry.active !== false,
    marketing_price_label: merchEntry.marketing_price_label || null,
    image: merchEntry.image || null,
  };
}

function getEnrichedProducts(options = {}) {
  const { tab, subsection, featured, activeOnly = true } = options;
  const catalog = getStoreProducts();
  const merch = loadMerch();
  const results = [];
  const seen = new Set();

  for (const p of catalog.products || []) {
    const entry = merch.products?.[p.id] || {};
    if (activeOnly && entry.active === false) continue;
    if (activeOnly && entry.subsection === 'promo' && !isPromoActive(entry)) continue;
    const enriched = enrichProduct(p, entry);
    if (tab && enriched.tab !== tab) continue;
    if (subsection && enriched.subsection !== subsection) continue;
    if (featured && !enriched.featured && !merch.featured_home?.includes(p.id)) continue;
    results.push(enriched);
    seen.add(p.id);
  }

  for (const [id, entry] of Object.entries(merch.products || {})) {
    if (seen.has(id) || entry.active === false) continue;
    if (!entry.manual && !id.startsWith('coaching') && id !== 'seance-essai') continue;
    const manual = buildManualProduct(id, merch, entry);
    const enriched = enrichProduct(manual, entry);
    if (tab && enriched.tab !== tab) continue;
    if (subsection && enriched.subsection !== subsection) continue;
    if (featured && !enriched.featured && !merch.featured_home?.includes(id)) continue;
    results.push(enriched);
  }

  results.sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  return results;
}

function getFeaturedProducts(limit = 3) {
  const merch = loadMerch();
  const ids = (merch.featured_home || []).slice(0, limit);
  const all = getEnrichedProducts({ activeOnly: true });
  const byId = Object.fromEntries(all.map((p) => [p.id, p]));
  const featured = ids.map((id) => byId[id]).filter(Boolean);
  if (featured.length < limit) {
    for (const p of all.filter((x) => x.featured && !featured.find((f) => f.id === x.id))) {
      if (featured.length >= limit) break;
      featured.push(p);
    }
  }
  return featured.slice(0, limit);
}

function getMaterielProducts() {
  const merch = loadMerch();
  return (merch.materiel || []).filter((m) => m.active !== false);
}

function findEnrichedProduct(productId) {
  const all = getEnrichedProducts({ activeOnly: false });
  const match = all.find((p) => p.id === productId || p.legacy_id === productId);
  if (match) return match;
  const merch = loadMerch();
  const mat = (merch.materiel || []).find((m) => m.id === productId);
  if (mat) {
    return {
      ...mat,
      tab: 'materiel',
      display_name: mat.name,
      requires_iban: false,
      requires_payment: true,
      sale_type: 'carte',
      manual: true,
    };
  }
  return null;
}

function updateMerchProduct(productId, patch) {
  const merch = loadMerch();
  if (!merch.products) merch.products = {};
  merch.products[productId] = { ...(merch.products[productId] || {}), ...patch };
  return saveMerch(merch);
}

function setFeaturedHome(ids) {
  const merch = loadMerch();
  merch.featured_home = ids.slice(0, 3);
  return saveMerch(merch);
}

module.exports = {
  loadMerch,
  saveMerch,
  getEnrichedProducts,
  getFeaturedProducts,
  getMaterielProducts,
  findEnrichedProduct,
  updateMerchProduct,
  setFeaturedHome,
  MERCH_FILE,
};
