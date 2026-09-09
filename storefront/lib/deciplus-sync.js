/**
 * Sync catalogue Deciplus → boutique storefront (noms + prix live).
 */
const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir, loadJson } = require('../../lib/utils');
const { logInfo, logWarn } = require('../../lib/logger');
const { normalizeText, inferSaleType, buildDeciplusProductSearch } = require('../../lib/catalog-text');
const { getBadgeFeeNotice, isStorefrontProduct } = require('./storefront-copy');

const SYNC_FILE = path.join(ROOT, 'data', 'storefront', 'catalog-live.json');
const OVERRIDES_FILE = path.join(ROOT, 'storefront', 'products-overrides.json');
const VISIBLE_PRODUCTS_FILE = path.join(ROOT, 'config', 'storefront-visible-products.json');
const STATIC_FILE = path.join(ROOT, 'storefront', 'products.json');

/* Identifiants stables issus du dernier catalogue Deciplus complet.
   Ils permettent au catalogue statique de rester vendable si une synchro
   partielle (validation KO) est déposée dans catalog-live.json. */
const STATIC_DECIPLUS_IDS = {
  'offre-duo': 104,
  'offre-promo-9': 101,
  'offre-promo-adulte': 102,
  'offre-promo-etudiant': 103,
  'offre-saison': 106,
  'boxe-educative': 45,
  'baby-boxe': 93,
  'etudiants-4-semaines': 89,
  '44-99-4-semaines': 88,
  'comptant-12-mois': 22,
  'comptant-6-mois': 91,
  'comptant-3-mois': 92,
  'offre-ete': 105,
};

function loadVisibleDeciplusTitles() {
  try {
    const data = loadJson('config/storefront-visible-products.json', { optional: true });
    if (!data?.titles?.length) return null;
    return data.titles.map((t) => normalizeText(t));
  } catch {
    return null;
  }
}

/** Correspondance titre API ↔ liste visible Deciplus (grille coach) */
function isVisibleInDeciplusGrid(title) {
  const allowed = loadVisibleDeciplusTitles();
  if (!allowed) return true;
  const norm = normalizeText(title);
  return allowed.some(
    (entry) =>
      norm === entry ||
      norm.includes(entry) ||
      entry.includes(norm) ||
      (entry.length >= 12 && norm.startsWith(entry.slice(0, 12)))
  );
}

/** Produits Deciplus visibles sur capture coach — contrôle sync */
const REQUIRED_DECIPLUS_TITLES = loadVisibleDeciplusTitles()
  ? loadJson('config/storefront-visible-products.json').titles.slice(0, 5)
  : [
      'OFFRE A 29€',
      'OFFRE PROMO 9€',
      'OFFRE PROMO 12 MOIS',
      'OFFRE ETE 2026 - 3 MOIS ILLIMITÉS',
      'COMPTANT 3 MOIS',
    ];

function loadStaticProducts() {
  let products;
  try {
    products = require('../products.json');
  } catch {
    products = loadJson('storefront/products.json', { optional: true }) || [];
  }
  return products.map((product) => {
    const deciplusId = product.deciplus_id || STATIC_DECIPLUS_IDS[product.id];
    if (!deciplusId) return product;
    return {
      ...product,
      deciplus_id: deciplusId,
      deciplus_product_search:
        product.deciplus_product_search || buildDeciplusProductSearch(product.name, deciplusId),
      deciplus_price: product.deciplus_price ?? Number(product.price_cents || 0) / 100,
      type: product.type || 'abo',
      synced: false,
    };
  });
}

function slugify(title) {
  return normalizeText(title).replace(/\s+/g, '-').slice(0, 48) || 'produit';
}

function extractRateFromTitle(title) {
  const m = String(title).match(/(\d+[,.]?\d*)\s*€/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function inferStripeEuros(item) {
  const title = item.title || '';
  const apiPrice = Number(item.price || 0);

  if (/coach staff/i.test(title)) return 0;
  if (/comptant/i.test(title)) return apiPrice;

  const fromTitle = extractRateFromTitle(title);
  if (fromTitle != null && fromTitle > 0 && fromTitle <= 300) return fromTitle;

  if (apiPrice > 0 && apiPrice <= 300) return apiPrice;
  return apiPrice;
}

function formatEuros(amount) {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

function mapDeciplusItem(item) {
  const stripeEuros = inferStripeEuros(item);
  const comptant = /comptant/i.test(item.title);
  const saleType = inferSaleType(item);
  const requiresIban = saleType !== 'none' && stripeEuros > 0 && !comptant && !/coach staff/i.test(item.title);
  const deciplusDisplayEuros = Number(item.price || 0);
  const hasContractTotal = deciplusDisplayEuros > stripeEuros + 0.5;

  const product = {
    id: `dp-${item.id}`,
    deciplus_id: item.id,
    category: item.categoryTitle || item.categoryId,
    name: item.title,
    price_cents: Math.round(stripeEuros * 100),
    /** Prix affiché grille — identique Deciplus (total contrat ou prix unique) */
    price_label: deciplusDisplayEuros > 0 ? formatEuros(deciplusDisplayEuros) : 'Gratuit',
    /** Montant débité aujourd'hui sur Stripe */
    stripe_price_label: stripeEuros === 0 ? 'Gratuit' : formatEuros(stripeEuros),
    pay_today_label: stripeEuros === 0 ? 'Gratuit' : formatEuros(stripeEuros),
    deciplus_price: deciplusDisplayEuros,
    price_subtitle: hasContractTotal ? `${formatEuros(stripeEuros)} — première échéance` : null,
    deciplus_total_note: hasContractTotal
      ? `Total contrat Deciplus : ${formatEuros(deciplusDisplayEuros)}`
      : null,
    installments_note: hasContractTotal
      ? '1ʳᵉ échéance par carte · prélèvement sans engagement'
      : null,
    sale_type: saleType,
    requires_iban: requiresIban,
    requires_payment: stripeEuros > 0,
    deciplus_product_search: buildDeciplusProductSearch(item.title, item.id),
    synced: true,
    reference: item.reference,
    type: item.type,
  };
  const badgeNotice = getBadgeFeeNotice(product);
  if (badgeNotice) product.badge_fee_notice = badgeNotice;
  return product;
}

function apiPriceDiffers(item, stripeEuros) {
  const p = Number(item.price || 0);
  return p > stripeEuros + 0.5;
}

function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_FILE)) {
      return loadJson('storefront/products-overrides.json');
    }
  } catch {
    /* ignore */
  }
  return [];
}

function attachLegacyIds(products) {
  let staticProducts = [];
  try {
    staticProducts = loadJson('storefront/products.json');
  } catch {
    return products;
  }
  const byName = new Map(staticProducts.map((p) => [normalizeText(p.name), p]));
  const inheritedKeys = ['description', 'tagline', 'audience', 'benefits', 'duration_label', 'badge'];
  for (const product of products) {
    const staticP = byName.get(normalizeText(product.name));
    if (!staticP) continue;
    if (staticP.id && staticP.id !== product.id) {
      product.legacy_id = staticP.id;
    }
    for (const key of inheritedKeys) {
      if (product[key] == null && staticP[key] != null) product[key] = staticP[key];
    }
  }
  return products;
}

function applyOverrides(products, overrides) {
  const allowedKeys = new Set(['deciplus_product_search', 'legacy_id', 'deciplus_id']);
  const byName = new Map(products.map((p) => [normalizeText(p.name), p]));
  for (const ov of overrides) {
    const key = normalizeText(ov.name || ov.match);
    const existing = byName.get(key);
    if (!existing) continue;
    for (const [k, v] of Object.entries(ov)) {
      if (allowedKeys.has(k)) existing[k] = v;
    }
  }
  return products;
}

function deciplusToStorefront(deciplusProducts, { includeCategories = ['abo'] } = {}) {
  const filtered = deciplusProducts.filter((p) => {
    if (/coach staff/i.test(p.title)) return false;
    const cat = p.categoryId || p.type;
    if (cat === 'decipass' || /^badge$/i.test(String(p.title || '').trim())) return false;
    if (includeCategories.includes('abo') && (cat === 'abo' || p.categoryId === 'abo')) return true;
    return includeCategories.length === 0;
  });

  let products = filtered
    .filter((p) => isVisibleInDeciplusGrid(p.title))
    .map(mapDeciplusItem)
    .filter(isStorefrontProduct);
  products = applyOverrides(products, loadOverrides());
  products = attachLegacyIds(products);

  products.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  logInfo('Catalogue filtré grille Deciplus visible', { count: products.length });
  return products;
}

function saveSyncedCatalog(products, meta = {}) {
  ensureDir(path.dirname(SYNC_FILE));
  const payload = {
    synced_at: new Date().toISOString(),
    count: products.length,
    ...meta,
    products,
  };
  fs.writeFileSync(SYNC_FILE, JSON.stringify(payload, null, 2), 'utf8');
  logInfo('Catalogue boutique synchronisé Deciplus', { count: products.length, file: SYNC_FILE });
  return payload;
}

function loadSyncedCatalog() {
  if (!fs.existsSync(SYNC_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
  } catch (err) {
    logWarn('Catalogue live illisible', { error: err.message, file: SYNC_FILE });
    return null;
  }
}

let runtimeCatalog = null;

function setRuntimeCatalog(payload) {
  runtimeCatalog = payload;
  return payload;
}

function ingestCatalogPayload(payload) {
  if (!payload?.products?.length) {
    throw new Error('Payload catalogue invalide');
  }
  const normalized = {
    synced_at: payload.synced_at || new Date().toISOString(),
    count: payload.products.length,
    products: payload.products,
    source: payload.source || 'ingest',
    validation: payload.validation || null,
  };
  if (process.env.VERCEL !== '1') {
    saveSyncedCatalog(normalized.products, {
      deciplus_count: payload.deciplus_count,
      validation: payload.validation,
      synced_by: payload.synced_by || 'ingest',
    });
  }
  setRuntimeCatalog(normalized);
  logInfo('Catalogue ingéré', { count: normalized.products.length, source: normalized.source });
  return normalized;
}

function enrichStorefrontProducts(products) {
  return products
    .filter(isStorefrontProduct)
    .filter((p) => isVisibleInDeciplusGrid(p.name))
    .map((product) => {
      const badgeNotice = getBadgeFeeNotice(product);
      if (!badgeNotice) return product;
      return { ...product, badge_fee_notice: badgeNotice };
    });
}

function getStoreProducts({ preferLive = true } = {}) {
  const wrap = (catalog) => {
    const products = enrichStorefrontProducts(catalog.products || []);
    return { ...catalog, products, count: products.length };
  };

  if (preferLive && runtimeCatalog?.products?.length) {
    const runtime = wrap(runtimeCatalog);
    if (validateSync(runtime.products).ok) return runtime;
    logWarn('Catalogue runtime incomplet — repli statique', {
      count: runtime.count,
      missing: validateSync(runtime.products).missing,
    });
  }
  if (preferLive) {
    const live = loadSyncedCatalog();
    if (live?.products?.length) {
      const wrapped = wrap(live);
      const validation = validateSync(wrapped.products);
      if (validation.ok) return wrapped;
      logWarn('Catalogue live incomplet — repli statique', {
        count: wrapped.count,
        missing: validation.missing,
      });
    }
  }
  const staticProducts = enrichStorefrontProducts(loadStaticProducts());
  if (!staticProducts.length && process.env.VERCEL) {
    logWarn('Catalogue statique indisponible sur Vercel — ingest bot requis');
  }
  return {
    synced_at: null,
    products: staticProducts,
    count: staticProducts.length,
    source: 'static',
  };
}

function validateSync(products) {
  const requiredList =
    loadJson('config/storefront-visible-products.json', { optional: true })?.titles ||
    REQUIRED_DECIPLUS_TITLES;
  const titles = new Set(products.map((p) => normalizeText(p.name)));
  const missing = requiredList.filter(
    (t) => !titles.has(normalizeText(t)) && !products.some((p) => normalizeText(p.name).includes(normalizeText(t)))
  );
  return { ok: missing.length === 0, missing, count: products.length };
}

function compareWithStatic(liveProducts) {
  const staticProducts = loadJson('storefront/products.json');
  const liveNames = new Set(liveProducts.map((p) => normalizeText(p.name)));
  const staticNames = new Set(staticProducts.map((p) => normalizeText(p.name)));
  const onlyLive = liveProducts.filter((p) => !staticNames.has(normalizeText(p.name))).map((p) => p.name);
  const onlyStatic = staticProducts.filter((p) => !liveNames.has(normalizeText(p.name))).map((p) => p.name);
  return { onlyLive, onlyStatic };
}

module.exports = {
  deciplusToStorefront,
  saveSyncedCatalog,
  loadSyncedCatalog,
  setRuntimeCatalog,
  ingestCatalogPayload,
  getStoreProducts,
  validateSync,
  compareWithStatic,
  inferStripeEuros,
  mapDeciplusItem,
  REQUIRED_DECIPLUS_TITLES,
  isVisibleInDeciplusGrid,
  loadVisibleDeciplusTitles,
  SYNC_FILE,
};
