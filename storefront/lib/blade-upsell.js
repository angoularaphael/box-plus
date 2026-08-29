'use strict';

const { sendWhatsAppMessage } = require('./whatsapp-bot');
const { loadMerch, saveMerchAsync, loadMaterielCatalogLocal, saveMaterielCatalog } = require('./merch-persistence');
const { logInfo, logWarn } = require('../../lib/logger');

const BLADE_ID = 'mat-blade-gold';
const BLADE_SLUG = 'gants-boxe-blade-noir-blanc';
const BLADE_SLUG_LEGACY = 'gants-boxe-blade-gold-blanc-noir';
const BLADE_PRICE_CENTS = 1790;
const BLADE_WAS_CENTS = 4000;
const ALERT_AT = 10;
const REMUS_PHONE = '0767919166';
const MINIMES_PICKUP = 'Barrière de Paris - Minimes';
const PICKUP_HOURS =
  'Lundi–vendredi 12h–14h et 17h–21h ; samedi 15h–18h. Retrait le jour même de la commande uniquement.';
const PICKUP_NOTE = `Retrait uniquement à Boxing Center Toulouse Minimes. ${PICKUP_HOURS}`;

const BLADE_SIZES = ['10oz', '12oz', '14oz'];
const BLADE_COLORS = [
  {
    id: 'noir-blanc',
    label: 'Noir / Blanc',
    image: '/img/materiel/rentree/blade/blade-nb-01.jpg',
  },
  {
    id: 'blanc-or',
    label: 'Blanc / Or',
    image: '/img/materiel/rentree/blade/blade-or-01.jpg',
  },
];

function bladeCombinations() {
  return BLADE_COLORS.flatMap((color) =>
    BLADE_SIZES.map((size) => ({
      id: `blade-${color.id}-${size}`,
      label: `${color.label} — ${size}`,
      attributes: {
        Couleur: color.label,
        Taille: size,
        'Lieu retrait produits': MINIMES_PICKUP,
      },
      reference: color.id === 'noir-blanc' ? `MBGAN205N${size.replace('oz', '')}` : `MBGAN208W${size.replace('oz', '')}`,
      price_cents: BLADE_PRICE_CENTS,
      price_label: '17,90 €',
      stock: 10,
      image: color.image,
    }))
  );
}

const BLADE_PRODUCT = {
  id: BLADE_ID,
  slug: BLADE_SLUG,
  name: 'Gants de boxe Blade Noir et Blanc',
  display_name: 'Gants de boxe Blade Noir et Blanc',
  reference: 'MBGAN205',
  price_cents: BLADE_PRICE_CENTS,
  price_label: '17,90 €',
  price_was_cents: BLADE_WAS_CENTS,
  price_was_label: '40,00 €',
  stock: 60,
  category: 'destockage',
  category_label: 'Déstockage',
  category_id: 26,
  description_short:
    'Gants Blade destockage rentrée 2026 — coloris Noir/Blanc et Blanc/Or. Tailles 10, 12 et 14oz. 17,90 € au lieu de 40 €. Retrait Minimes le jour même.',
  description:
    'Gants de boxe Blade (Metal Boxe) en destockage rentrée 2026. Coloris Noir/Blanc et Blanc/Or. PU haute qualité, mousse EVA, velcro large, aération WindTec. Tailles 10oz, 12oz et 14oz.\n\n' +
    PICKUP_NOTE,
  image: '/img/materiel/rentree/blade/blade-nb-01.jpg',
  images: [
    '/img/materiel/rentree/blade/blade-nb-01.jpg',
    '/img/materiel/rentree/blade/blade-nb-02.jpg',
    '/img/materiel/rentree/blade/blade-or-01.jpg',
    '/img/materiel/rentree/blade/blade-or-02.jpg',
  ],
  combinations: bladeCombinations(),
  pickup_gyms: [MINIMES_PICKUP],
  pickup_locked: MINIMES_PICKUP,
  pickup_same_day: true,
  pickup_hours: PICKUP_HOURS,
  pickup_note: PICKUP_NOTE,
  size: '10oz / 12oz / 14oz',
  sort_order: 1,
  featured_first: true,
  destockage: true,
  active: true,
  pickup_only: true,
  manual: true,
  source: 'rentree-2026',
  default_variant_id: 'blade-noir-blanc-12oz',
  tab: 'materiel',
  requires_iban: false,
  requires_payment: true,
  sale_type: 'materiel',
};

function isBladeProductId(id) {
  const key = String(id || '').toLowerCase();
  return key === BLADE_ID || key === BLADE_SLUG || key === BLADE_SLUG_LEGACY;
}

function parseBladeChoice(input = {}) {
  const raw = String(input.variant_id || input.size || '').toLowerCase();
  const color =
    BLADE_COLORS.find((c) => c.id === input.color || raw.includes(c.id)) || BLADE_COLORS[0];
  const size = BLADE_SIZES.find((s) => s === input.size || raw.includes(s)) || '12oz';
  const variantId = `blade-${color.id}-${size}`;
  return { color: color.id, colorLabel: color.label, size, variantId, image: color.image };
}

const ADULT_ABO_SUBSECTIONS = new Set(['comptant', 'prelevement', 'promo']);

function adultAboEligible(product) {
  const p = product || {};
  const tab = String(p.tab || '');
  const subsection = String(p.subsection || '');
  if (tab === 'coachings' || subsection === 'coaching') return false;
  if (subsection === 'enfants') return false;
  if (tab === 'seance-essai' || subsection === 'essai') return true;
  if (tab === 'abonnements') return true;
  // Snapshots d’avant le champ `tab` : un abo adulte a subsection comptant / prelevement / promo.
  if (ADULT_ABO_SUBSECTIONS.has(subsection)) return true;
  return false;
}

function addonState(order) {
  return order?.addons?.blade || null;
}

function isAddonPaid(order) {
  return addonState(order)?.status === 'paid';
}

function isAddonSkipped(order) {
  return addonState(order)?.status === 'skipped';
}

function isAddonResolved(order) {
  return isAddonPaid(order) || isAddonSkipped(order);
}

function shouldOfferUpsell(order) {
  if (!order) return false;
  const paid = order.payment?.status === 'paid' || order.payment?.status === 'free';
  if (!paid) return false;
  if (order.signature?.signed_at) return false;
  if (isAddonResolved(order)) return false;
  const product = order.product_snapshot || {};
  return adultAboEligible(product);
}

function publicProduct() {
  return {
    id: BLADE_ID,
    slug: BLADE_SLUG,
    name: BLADE_PRODUCT.name,
    price_cents: BLADE_PRICE_CENTS,
    price_label: BLADE_PRODUCT.price_label,
    price_was_label: BLADE_PRODUCT.price_was_label,
    sizes: BLADE_SIZES,
    colors: BLADE_COLORS.map((c) => ({ id: c.id, label: c.label, image: c.image })),
    default_size: '12oz',
    default_color: 'noir-blanc',
    image: BLADE_PRODUCT.image,
    pickup_note: PICKUP_NOTE,
    pickup_hours: PICKUP_HOURS,
    pickup_gym: MINIMES_PICKUP,
  };
}

function buildUpsellForOrder(order) {
  if (!shouldOfferUpsell(order)) {
    return {
      show: false,
      status: addonState(order)?.status || null,
      product: publicProduct(),
    };
  }
  return {
    show: true,
    status: addonState(order)?.status || 'pending',
    product: publicProduct(),
  };
}

function ensureAddon(order, choice = {}) {
  if (!order.addons) order.addons = {};
  const parsed = parseBladeChoice({
    size: choice.size || order.addons.blade?.size,
    color: choice.color || order.addons.blade?.color,
    variant_id: choice.variant_id || order.addons.blade?.variant_id,
  });
  if (!order.addons.blade) {
    order.addons.blade = {
      product_id: BLADE_ID,
      name: BLADE_PRODUCT.name,
      size: parsed.size,
      color: parsed.color,
      color_label: parsed.colorLabel,
      variant_id: parsed.variantId,
      price_cents: BLADE_PRICE_CENTS,
      pickup_gym: MINIMES_PICKUP,
      status: 'pending',
    };
  } else if (choice.size || choice.color || choice.variant_id) {
    order.addons.blade.size = parsed.size;
    order.addons.blade.color = parsed.color;
    order.addons.blade.color_label = parsed.colorLabel;
    order.addons.blade.variant_id = parsed.variantId;
  }
  return order.addons.blade;
}

function customerFromOrder(order) {
  const short = order?.customer_short || {};
  const full = order?.customer_full || {};
  const customer = order?.customer || {};
  return {
    first_name: short.first_name || full.first_name || customer.first_name || '',
    last_name: short.last_name || full.last_name || customer.last_name || '',
    phone: short.phone || full.phone || customer.phone || '',
    email: short.email || full.email || customer.email || '',
  };
}

function bladeChoiceFromOrder(order) {
  const addon = addonState(order);
  if (addon?.size || addon?.variant_id) {
    return parseBladeChoice(addon);
  }
  const item = (order.items || []).find((i) => isBladeProductId(i.product_id));
  if (item) return parseBladeChoice({ variant_id: item.variant_id, size: item.variant_label });
  return parseBladeChoice({});
}

function saleWhatsAppText(order, source) {
  const c = customerFromOrder(order);
  const choice = bladeChoiceFromOrder(order);
  const ref = order.order_id || '';
  return [
    `Vente matériel — Gants Blade ${choice.colorLabel} ${choice.size}`,
    `Prénom : ${c.first_name || '—'}`,
    `Nom : ${c.last_name || '—'}`,
    `Tél : ${c.phone || '—'}`,
    `Produit : Gants Blade ${choice.colorLabel} ${choice.size} — 17,90 €`,
    `Retrait : Minimes, jour même (${PICKUP_HOURS})`,
    `Réf. : ${ref}${source ? ` (${source})` : ''}`,
  ].join('\n');
}

function alertWhatsAppText(sold) {
  return `ALERTE STOCK — ${sold} paires de Gants Blade vendues (seuil ${ALERT_AT} atteint). Les ventes continuent. Merci de réapprovisionner.`;
}

async function notifyRemus(message) {
  try {
    await sendWhatsAppMessage(REMUS_PHONE, message);
    return { sent: true };
  } catch (err) {
    logWarn('WhatsApp Remus (Blade)', { error: err.message });
    return { sent: false, error: err.message };
  }
}

async function recordBladeSale(order, { source = 'upsell' } = {}) {
  const merch = loadMerch();
  const state = { sold: 0, alert_at: ALERT_AT, alert_sent: false, ...(merch.blade_rentree || {}) };
  state.sold = Number(state.sold || 0) + 1;
  const hitAlert = state.sold >= ALERT_AT && !state.alert_sent;
  if (hitAlert) {
    state.alert_sent_at = new Date().toISOString();
    state.alert_sent = true;
  }
  merch.blade_rentree = state;
  await saveMerchAsync(merch);

  const saleNotify = await notifyRemus(saleWhatsAppText(order, source));
  let alertNotify = { sent: false, skipped: true };
  if (hitAlert) {
    alertNotify = await notifyRemus(alertWhatsAppText(state.sold));
  }
  logInfo('Vente Gants Blade', {
    order_id: order?.order_id,
    sold: state.sold,
    alert: hitAlert,
    source,
  });
  return { sold: state.sold, alert: hitAlert, saleNotify, alertNotify };
}

function overlayBladeStock(product) {
  const catalog = loadMaterielCatalogLocal();
  const raw = (catalog.products || []).find((p) => p.id === BLADE_ID);
  if (!raw?.combinations?.length) return product;
  const combinations = (product.combinations || []).map((c) => {
    const live = raw.combinations.find((x) => String(x.id) === String(c.id));
    return live && live.stock != null ? { ...c, stock: live.stock } : { ...c };
  });
  return {
    ...product,
    combinations,
    stock: combinations.reduce((sum, c) => sum + Number(c.stock || 0), 0),
  };
}

function decrementBladeCatalogStock(variantId) {
  const catalog = loadMaterielCatalogLocal();
  const product = (catalog.products || []).find((p) => p.id === BLADE_ID);
  if (!product) return;
  const combo = (product.combinations || []).find((c) => String(c.id) === String(variantId));
  if (combo && Number(combo.stock) > 0) combo.stock -= 1;
  product.stock = (product.combinations || []).reduce((sum, c) => sum + Number(c.stock || 0), 0);
  saveMaterielCatalog(catalog);
}

function mergeBladeIntoList(products) {
  const list = Array.isArray(products) ? [...products] : [];
  const idx = list.findIndex(
    (p) => isBladeProductId(p.id) || isBladeProductId(p.slug) || p.slug === BLADE_SLUG_LEGACY
  );
  const blade = overlayBladeStock({
    ...BLADE_PRODUCT,
    tab: 'materiel',
    requires_iban: false,
    requires_payment: true,
    sale_type: 'materiel',
    pickup_only: true,
    manual: true,
  });
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...blade, featured_first: true, destockage: true, sort_order: 1 };
  } else {
    list.unshift(blade);
  }
  list.sort((a, b) => (Number(a.sort_order) || 99) - (Number(b.sort_order) || 99));
  return list;
}

async function skipBladeAddon(order) {
  const addon = ensureAddon(order);
  addon.status = 'skipped';
  addon.skipped_at = new Date().toISOString();
  const { saveOrderAsync } = require('./order-lifecycle');
  await saveOrderAsync(order);
  return order;
}

async function markBladeAddonPaid(order, paymentMeta = {}) {
  const addon = ensureAddon(order);
  if (addon.status === 'paid') return { order, already: true };
  addon.status = 'paid';
  addon.paid_at = new Date().toISOString();
  addon.method = paymentMeta.method || addon.method || null;
  if (paymentMeta.payplug_payment_id) addon.payplug_payment_id = paymentMeta.payplug_payment_id;
  if (paymentMeta.paypal_order_id) addon.paypal_order_id = paymentMeta.paypal_order_id;
  const { saveOrderAsync } = require('./order-lifecycle');
  await saveOrderAsync(order);
  decrementBladeCatalogStock(parseBladeChoice(addon).variantId);
  await recordBladeSale(order, { source: paymentMeta.source || 'upsell' });
  return { order, already: false };
}

module.exports = {
  BLADE_ID,
  BLADE_SLUG,
  BLADE_SLUG_LEGACY,
  BLADE_PRICE_CENTS,
  BLADE_PRODUCT,
  BLADE_SIZES,
  BLADE_COLORS,
  MINIMES_PICKUP,
  PICKUP_HOURS,
  PICKUP_NOTE,
  ALERT_AT,
  REMUS_PHONE,
  isBladeProductId,
  parseBladeChoice,
  adultAboEligible,
  shouldOfferUpsell,
  isAddonPaid,
  isAddonSkipped,
  isAddonResolved,
  buildUpsellForOrder,
  ensureAddon,
  publicProduct,
  customerFromOrder,
  recordBladeSale,
  mergeBladeIntoList,
  overlayBladeStock,
  skipBladeAddon,
  markBladeAddonPaid,
};
