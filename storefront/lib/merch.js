/**
 * Catalogue matériel — import PrestaShop + merchandising
 */
const {
  MERCH_FILE,
  CATALOG_FILE,
  loadMerch,
  saveMerch,
  saveMerchAsync,
  loadMerchFresh,
  hydrateMerchOnce,
  resetMerchHydration,
  loadMaterielCatalogLocal,
  saveMaterielCatalog,
} = require('./merch-persistence');

function loadMaterielCatalog() {
  return loadMaterielCatalogLocal();
}

function applyMaterielOverrides(product, overrides = {}) {
  if (overrides.active === false) return null;
  const priceCents = overrides.price_cents ?? product.price_cents;
  return {
    ...product,
    ...overrides,
    display_name: overrides.display_name || product.name,
    price_cents: priceCents,
    price_label: overrides.price_label || product.price_label,
    tab: 'materiel',
    requires_iban: false,
    requires_payment: true,
    sale_type: 'materiel',
    pickup_only: true,
    manual: true,
  };
}

function getMaterielCategories() {
  const catalog = loadMaterielCatalog();
  return catalog.categories || [];
}

function getMaterielProducts(options = {}) {
  const { category, activeOnly = true, q } = options;
  const catalog = loadMaterielCatalog();
  const merch = loadMerch();
  const overrides = merch.materiel_overrides || {};

  let products = (catalog.products || [])
    .map((p) => {
      const patch = overrides[p.id] || {};
      return applyMaterielOverrides(p, patch);
    })
    .filter(Boolean);

  if (activeOnly) {
    products = products.filter((p) => p.active !== false);
  }

  if (category && category !== 'all') {
    products = products.filter((p) => p.category === category);
  }

  if (q) {
    const needle = String(q).toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.reference || '').toLowerCase().includes(needle)
    );
  }

  return products;
}

function findMaterielProduct(productId) {
  const catalog = loadMaterielCatalog();
  const merch = loadMerch();
  const raw = (catalog.products || []).find(
    (p) => p.id === productId || String(p.prestashop_id) === String(productId)
  );
  if (!raw) return null;
  const patch = merch.materiel_overrides?.[raw.id] || {};
  return applyMaterielOverrides(raw, patch);
}

function findMaterielVariant(productId, variantId) {
  const product = findMaterielProduct(productId);
  if (!product) return null;
  if (!variantId) {
    const def =
      product.combinations?.find((c) => c.id === product.default_variant_id) ||
      product.combinations?.[0];
    return { product, variant: def || null };
  }
  const variant = (product.combinations || []).find(
    (c) => String(c.id) === String(variantId)
  );
  return { product, variant: variant || null };
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
  const { getStoreProducts } = require('./deciplus-sync');
  const catalog = getStoreProducts();
  const merch = loadMerch();
  const results = [];
  const seen = new Set();

  for (const p of catalog.products || []) {
    const entry = merch.products?.[p.id] || (p.legacy_id ? merch.products?.[p.legacy_id] : null) || {};
    if (activeOnly && entry.active === false) continue;
    if (activeOnly && entry.subsection === 'promo' && !isPromoActive(entry)) continue;
    const enriched = enrichProduct(p, entry);
    if (tab && enriched.tab !== tab) continue;
    if (subsection && enriched.subsection !== subsection) continue;
    if (featured && !enriched.featured && !merch.featured_home?.includes(p.id) && !(p.legacy_id && merch.featured_home?.includes(p.legacy_id))) continue;
    results.push(enriched);
    seen.add(p.id);
    if (p.legacy_id) seen.add(p.legacy_id);
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
  const ids = (merch.featured_home || []).filter(Boolean).slice(0, limit);
  const all = getEnrichedProducts({ activeOnly: true });
  const byId = new Map();
  for (const p of all) {
    byId.set(p.id, p);
    if (p.legacy_id) byId.set(p.legacy_id, p);
  }

  let featured = ids.map((id) => byId.get(id)).filter(Boolean);

  if (!featured.length) {
    for (const p of all.filter((x) => x.featured)) {
      if (featured.length >= limit) break;
      if (!featured.find((f) => f.id === p.id)) featured.push(p);
    }
  }

  if (!featured.length) {
    featured = all.filter((p) => p.tab === 'abonnements' || p.tab === 'seance-essai').slice(0, limit);
  }
  if (!featured.length) {
    featured = all.slice(0, limit);
  }

  return featured.slice(0, limit);
}

function findEnrichedProduct(productId) {
  const all = getEnrichedProducts({ activeOnly: false });
  const match = all.find((p) => p.id === productId || p.legacy_id === productId);
  if (match) return match;
  return findMaterielProduct(productId);
}

function updateMerchProduct(productId, patch) {
  const merch = loadMerch();
  if (!merch.products) merch.products = {};
  merch.products[productId] = { ...(merch.products[productId] || {}), ...patch };
  return saveMerch(merch);
}

async function updateMerchProductAsync(productId, patch) {
  const merch = loadMerch();
  if (!merch.products) merch.products = {};
  merch.products[productId] = { ...(merch.products[productId] || {}), ...patch };
  return saveMerchAsync(merch);
}

function normalizeFeaturedIds(ids) {
  const all = getEnrichedProducts({ activeOnly: false });
  const canonical = new Map();
  for (const p of all) {
    canonical.set(p.id, p.id);
    if (p.legacy_id) canonical.set(p.legacy_id, p.id);
  }
  return [...new Set((ids || []).map((id) => canonical.get(id) || id).filter(Boolean))];
}

function setFeaturedHome(ids) {
  const merch = loadMerch();
  merch.featured_home = normalizeFeaturedIds(ids).slice(0, 3);
  return saveMerch(merch);
}

async function setFeaturedHomeAsync(ids) {
  const merch = loadMerch();
  merch.featured_home = normalizeFeaturedIds(ids).slice(0, 3);
  return saveMerchAsync(merch);
}

function slugifyOfferId(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function createManualOffer(entry = {}) {
  const merch = loadMerch();
  if (!merch.products) merch.products = {};

  const displayName = String(entry.display_name || '').trim();
  if (!displayName) throw new Error('Nom affiché requis');

  const id = String(entry.id || slugifyOfferId(displayName)).trim();
  if (!id) throw new Error('Identifiant offre invalide');
  if (merch.products[id] && !entry.overwrite) {
    throw new Error(`L'offre « ${id} » existe déjà`);
  }

  const priceCents = Math.max(0, Number(entry.price_cents) || 0);
  const priceLabel =
    entry.marketing_price_label ||
    (priceCents > 0 ? `${(priceCents / 100).toFixed(2).replace('.', ',')} €` : 'Gratuit');
  const subsection = entry.subsection || 'promo';
  const requiresIban =
    entry.requires_iban !== undefined
      ? Boolean(entry.requires_iban)
      : subsection === 'prelevement' || subsection === 'promo';

  merch.products[id] = {
    manual: true,
    active: entry.active !== false,
    tab: entry.tab || 'abonnements',
    subsection,
    display_name: displayName,
    price_cents: priceCents,
    marketing_price_label: priceLabel,
    requires_iban: requiresIban,
    requires_payment: entry.requires_payment !== undefined ? Boolean(entry.requires_payment) : priceCents > 0,
    sale_type: entry.sale_type || (requiresIban ? 'prelevement' : 'carte'),
    sort_order: Number(entry.sort_order) || 50,
    benefits: entry.benefits || [],
    audience: entry.audience || null,
    duration_label: entry.duration_label || null,
    badge: entry.badge || null,
    deciplus_product_search: entry.deciplus_product_search || null,
  };

  saveMerch(merch);
  return { id, product: merch.products[id] };
}

function updateMaterielProduct(productId, patch) {
  const catalog = loadMaterielCatalog();
  const idx = (catalog.products || []).findIndex((p) => p.id === productId);
  if (idx >= 0) {
    catalog.products[idx] = { ...catalog.products[idx], ...patch };
    saveMaterielCatalog(catalog);
    return catalog.products[idx];
  }
  const merch = loadMerch();
  if (!merch.materiel_overrides) merch.materiel_overrides = {};
  merch.materiel_overrides[productId] = {
    ...(merch.materiel_overrides[productId] || {}),
    ...patch,
  };
  saveMerch(merch);
  return merch.materiel_overrides[productId];
}

module.exports = {
  loadMerch,
  saveMerch,
  loadMaterielCatalog,
  saveMaterielCatalog,
  getMaterielCategories,
  getMaterielProducts,
  findMaterielProduct,
  findMaterielVariant,
  getEnrichedProducts,
  getFeaturedProducts,
  findEnrichedProduct,
  updateMerchProduct,
  updateMerchProductAsync,
  updateMaterielProduct,
  setFeaturedHome,
  setFeaturedHomeAsync,
  normalizeFeaturedIds,
  createManualOffer,
  loadMerchFresh,
  hydrateMerchOnce,
  saveMerchAsync,
  resetMerchHydration,
  MERCH_FILE,
  CATALOG_FILE,
};
