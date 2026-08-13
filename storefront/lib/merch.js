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
  addMaterielProduct,
} = require('./merch-persistence');
const {
  productSupportsBillingChoice,
  productSupportsInstallmentChoice,
} = require('../../lib/billing-plan');

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
    requires_payment: entry.requires_payment ?? true,
    sale_type: entry.sale_type || 'carte',
    manual: true,
    deciplus_product_name: entry.deciplus_product_name || (isEssai ? "SEANCE D'ESSAI" : null),
    deciplus_product_search: entry.deciplus_product_search || (isEssai ? 'essai' : null),
    paiement_comptant: entry.paiement_comptant ?? (isEssai ? true : undefined),
    ...entry,
    auto_badge: false,
  };
}

function isPromoActive(merchEntry) {
  if (!merchEntry?.promo_start && !merchEntry?.promo_end) return true;
  const now = new Date();
  if (merchEntry.promo_start && now < new Date(merchEntry.promo_start)) return false;
  if (merchEntry.promo_end && now > new Date(merchEntry.promo_end)) return false;
  return true;
}

let _staticProductMaps = null;
function loadStaticProductsByKey() {
  if (_staticProductMaps) return _staticProductMaps;
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '..', 'products.json');
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    const byId = new Map();
    const byName = new Map();
    for (const p of list) {
      if (p.id) byId.set(p.id, p);
      if (p.name) byName.set(String(p.name).toLowerCase().replace(/\s+/g, ' ').trim(), p);
    }
    _staticProductMaps = { byId, byName };
  } catch {
    _staticProductMaps = { byId: new Map(), byName: new Map() };
  }
  return _staticProductMaps;
}

function enrichProduct(catalogProduct, merchEntry = {}) {
  const staticMaps = loadStaticProductsByKey();
  const staticP =
    staticMaps.byId.get(catalogProduct.legacy_id) ||
    staticMaps.byId.get(catalogProduct.id) ||
    staticMaps.byName.get(String(catalogProduct.name || '').toLowerCase().replace(/\s+/g, ' ').trim()) ||
    {};
  const subsection = merchEntry.subsection || inferSubsection(catalogProduct);
  const enriched = {
    ...staticP,
    ...catalogProduct,
    // Copie marketing prioritaire (merch / products.json) — jamais le jargon sync interne
    description: merchEntry.description || staticP.description || catalogProduct.description || null,
    tagline: merchEntry.tagline || staticP.tagline || catalogProduct.tagline || null,
    tab: merchEntry.tab || 'abonnements',
    subsection,
    display_name: merchEntry.display_name || catalogProduct.name,
    benefits: merchEntry.benefits || staticP.benefits || [],
    audience: merchEntry.audience || staticP.audience || null,
    duration_label: merchEntry.duration_label || staticP.duration_label || null,
    badge: merchEntry.badge || catalogProduct.badge || staticP.badge || null,
    featured: merchEntry.featured || false,
    sort_order: merchEntry.sort_order ?? 99,
    active: merchEntry.active !== false,
    marketing_price_label: merchEntry.marketing_price_label || null,
    price_was_label: merchEntry.price_was_label || staticP.price_was_label || null,
    price_was_cents: merchEntry.price_was_cents ?? staticP.price_was_cents ?? null,
    image: merchEntry.image || null,
    installments_note:
      merchEntry.installments_note || staticP.installments_note || catalogProduct.installments_note || null,
    supports_installment_choice:
      catalogProduct.supports_installment_choice === true ||
      staticP.supports_installment_choice === true ||
      merchEntry.supports_installment_choice === true,
  };
  // Notes internes Deciplus / sync — jamais affichées côté client
  enriched.deciplus_total_note = null;
  if (enriched.price_subtitle && /Deciplus|IBAN|\bCB\b/i.test(String(enriched.price_subtitle))) {
    enriched.price_subtitle = String(enriched.price_subtitle)
      .replace(/\s*—\s*1ère échéance CB/i, ' — première échéance')
      .replace(/\bCB\b/g, 'carte');
  }
  // Merch : prix & paiement prioritaires
  if (merchEntry.price_cents != null) {
    enriched.price_cents = Number(merchEntry.price_cents);
  }
  if (merchEntry.requires_payment !== undefined) {
    enriched.requires_payment = Boolean(merchEntry.requires_payment);
  }
  if (merchEntry.requires_iban !== undefined) {
    enriched.requires_iban = Boolean(merchEntry.requires_iban);
  }
  if (merchEntry.sale_type) {
    enriched.sale_type = merchEntry.sale_type;
  }
  if (merchEntry.marketing_price_label) {
    enriched.price_label = merchEntry.marketing_price_label;
    enriched.stripe_price_label = merchEntry.marketing_price_label;
    enriched.pay_today_label = merchEntry.marketing_price_label;
  }
  if (Number(enriched.price_cents || 0) <= 0) {
    enriched.price_cents = 0;
    enriched.requires_payment = false;
    enriched.requires_iban = false;
    enriched.sale_type = enriched.sale_type || 'none';
    const freeLabel = merchEntry.marketing_price_label || staticP.price_label || 'Gratuit';
    enriched.price_label = freeLabel;
    enriched.stripe_price_label = freeLabel;
    enriched.pay_today_label = freeLabel;
  }

  const isOffer29 =
    enriched.id === 'offre-duo' ||
    enriched.legacy_id === 'offre-duo' ||
    /offre\s*a\s*29/i.test(String(enriched.name || enriched.display_name || ''));
  // Garde-fou : l'offre 29 doit toujours rester à 29,99 € / 2999 cents,
  // même si la sync Deciplus remonte 29,00 côté paiement initial.
  if (isOffer29 && Number(staticP.price_cents) > 0) {
    enriched.price_cents = Number(staticP.price_cents);
  }
  if (Number(enriched.price_cents) === 2999) {
    enriched.price_label = '29,99 €';
    if (!enriched.stripe_price_label || enriched.stripe_price_label === '29,00 €') {
      enriched.stripe_price_label = '29,99 €';
    }
    if (!enriched.pay_today_label || enriched.pay_today_label === '29,00 €') {
      enriched.pay_today_label = '29,99 €';
    }
  }
  enriched.supports_billing_choice = productSupportsBillingChoice(enriched);
  enriched.supports_installment_choice = productSupportsInstallmentChoice(enriched);
  if (enriched.supports_installment_choice) {
    enriched.requires_iban = false;
    enriched.installments_note = 'En une fois ou en 4× sans frais';
  } else if (
    enriched.installments_note &&
    /Deciplus|Stripe|PayPlug|prélèvement IBAN|suite par prélèvement IBAN|ensuite|prélèvement automatique/i.test(
      String(enriched.installments_note)
    )
  ) {
    if (enriched.id === 'offre-duo' || /offre\s*a\s*29/i.test(String(enriched.name || ''))) {
      enriched.installments_note = '29,99 € / 4 semaines — 1ʳᵉ échéance CB puis prélèvement';
    } else {
      enriched.installments_note = '1ʳᵉ échéance par carte · prélèvement sans engagement';
    }
  } else if (enriched.installments_note) {
    enriched.installments_note = String(enriched.installments_note)
      .replace(/ensuite\s+/gi, '')
      .replace(/prélèvement automatique/gi, 'prélèvement sans engagement');
  }
  // Prix boutique (ex. 259 €) prioritaire sur le total Deciplus synchronisé (ex. 295 €)
  const overrideCents = merchEntry.price_cents ?? staticP.price_cents;
  if (
    enriched.supports_installment_choice &&
    overrideCents != null &&
    Number(overrideCents) > 0
  ) {
    const label =
      merchEntry.marketing_price_label ||
      staticP.price_label ||
      staticP.marketing_price_label ||
      `${(Number(overrideCents) / 100).toFixed(2).replace('.', ',')} €`;
    enriched.price_cents = Number(overrideCents);
    enriched.price_label = label;
    enriched.stripe_price_label = label;
    enriched.pay_today_label = label;
    enriched.price_subtitle = null;
  }
  return enriched;
}

function loadBundledMerchProducts() {
  try {
    return require('../storefront-merch.json').products || {};
  } catch {
    return {};
  }
}

/** Sur Vercel le merch remote peut être ancien — on réinjecte les packs manuels du bundle. */
function mergeManualBundledProducts(merch) {
  const bundled = loadBundledMerchProducts();
  const products = { ...(merch.products || {}) };
  for (const [id, entry] of Object.entries(bundled)) {
    if (!entry?.manual) continue;
    if (!products[id]) {
      products[id] = entry;
      continue;
    }
    if (!products[id].image && entry.image) {
      products[id] = { ...products[id], image: entry.image };
    }
  }
  return { ...merch, products };
}

function getEnrichedProducts(options = {}) {
  const { tab, subsection, featured, activeOnly = true } = options;
  const { getStoreProducts } = require('./deciplus-sync');
  const catalog = getStoreProducts();
  const merch = mergeManualBundledProducts(loadMerch());
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
  if (!ids.length) return [];

  const all = getEnrichedProducts({ activeOnly: true });
  const byId = new Map();
  for (const p of all) {
    byId.set(p.id, p);
    if (p.legacy_id) byId.set(p.legacy_id, p);
  }

  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, limit)
    .map((p) => ({ ...p, featured_home: true }));
}

function findEnrichedProduct(productId) {
  const all = getEnrichedProducts({ activeOnly: false });
  const match = all.find((p) => p.id === productId || p.legacy_id === productId);
  if (match) return match;
  // Repli catalogue statique (ids legacy type offre-saison / comptant-3-mois)
  const staticMaps = loadStaticProductsByKey();
  const staticP = staticMaps.byId.get(productId);
  if (staticP) {
    const merch = loadMerch();
    const entry = merch.products?.[productId] || {};
    return enrichProduct(staticP, entry);
  }
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
  // Drop orphans that don't resolve to a real product
  return [...new Set((ids || []).map((id) => canonical.get(id)).filter(Boolean))];
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

/* ====================================================================
   L'OFFRE DE RENTRÉE — les places, pilotées par le patron.

   Le compteur « plus que N places » affiché sur les quatre sites du club
   vient d'ICI. Ce n'est pas un nombre calculé dans le vide : c'est une
   décision commerciale, celle du patron, qui décide combien de places il
   ouvre à ce prix et où en est le compte. Il le règle depuis le panneau
   d'administration ; les sites ne font que l'afficher.

   `restantes` est ce qu'il a saisi la dernière fois. `ancre_ventes`
   mémorise combien d'inscriptions en ligne étaient déjà payées à cet
   instant : les ventes qui arrivent ENSUITE décrémentent le compteur
   toutes seules, sans qu'il ait à y revenir. Il peut réajuster à tout
   moment — une place vendue au comptoir n'existe nulle part ailleurs.

   Rangé dans le magasin `merch` parce que celui-ci sait déjà écrire dans
   un fichier en local ET dans Supabase sur Vercel. Un fichier JSON posé
   à côté serait effacé à chaque déploiement.
   ==================================================================== */
const OFFRE_DEFAUT = { quota: 0, restantes: 0, fin: '', ancre_ventes: 0, maj: null };

function getOffreRentree() {
  const merch = loadMerch();
  return { ...OFFRE_DEFAUT, ...(merch.offre_rentree || {}) };
}

async function setOffreRentreeAsync(patch, ventesEnLigne = 0) {
  const merch = loadMerch();
  const actuel = { ...OFFRE_DEFAUT, ...(merch.offre_rentree || {}) };
  const entier = (v, repli) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : repli;
  };
  const neuf = {
    quota: entier(patch.quota, actuel.quota),
    restantes: entier(patch.restantes, actuel.restantes),
    /* Une date vide efface l'échéance : c'est la façon d'éteindre le
       compte à rebours sans avoir à toucher au reste. */
    fin: patch.fin === undefined ? actuel.fin : String(patch.fin || '').slice(0, 10),
    /* On repose l'ancre à chaque réglage : le patron vient de dire ce qui
       reste AUJOURD'HUI, les ventes d'hier sont déjà dans son chiffre. */
    ancre_ventes: entier(ventesEnLigne, 0),
    maj: new Date().toISOString(),
  };
  if (neuf.restantes > neuf.quota && neuf.quota > 0) neuf.restantes = neuf.quota;
  merch.offre_rentree = neuf;
  await saveMerchAsync(merch);
  return neuf;
}

/** Ce que les sites doivent afficher, ventes en ligne déduites. */
function placesRestantes(ventesEnLigne = 0) {
  const o = getOffreRentree();
  const depuisLeReglage = Math.max(0, ventesEnLigne - (o.ancre_ventes || 0));
  return { ...o, restantes: Math.max(0, o.restantes - depuisLeReglage) };
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
  addMaterielProduct,
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
  getOffreRentree,
  setOffreRentreeAsync,
  placesRestantes,
  normalizeFeaturedIds,
  createManualOffer,
  loadMerchFresh,
  hydrateMerchOnce,
  saveMerchAsync,
  resetMerchHydration,
  MERCH_FILE,
  CATALOG_FILE,
};
