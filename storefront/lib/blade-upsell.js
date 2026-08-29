'use strict';

const { sendWhatsAppMessage } = require('./whatsapp-bot');
const { loadMerch, saveMerchAsync } = require('./merch-persistence');
const { logInfo, logWarn } = require('../../lib/logger');

const BLADE_ID = 'mat-blade-gold';
const BLADE_SLUG = 'gants-boxe-blade-gold-blanc-noir';
const BLADE_PRICE_CENTS = 1790;
const BLADE_WAS_CENTS = 4000;
const ALERT_AT = 30;
const REMUS_PHONE = '0767919166';
const MINIMES_PICKUP = 'Barrière de Paris - Minimes';
const PICKUP_HOURS =
  'Lundi–vendredi 12h–14h et 17h–21h15 ; samedi 15h–18h. Retrait le jour même de la commande uniquement.';
const PICKUP_NOTE = `Retrait uniquement à Boxing Center Toulouse Minimes. ${PICKUP_HOURS}`;

const BLADE_PRODUCT = {
  id: BLADE_ID,
  slug: BLADE_SLUG,
  name: 'Gants de boxe Blade Gold Blanc Noir',
  display_name: 'Gants de boxe Blade Gold Blanc Noir',
  reference: 'BC-BLADE-GOLD-14OZ',
  price_cents: BLADE_PRICE_CENTS,
  price_label: '17,90 €',
  price_was_cents: BLADE_WAS_CENTS,
  price_was_label: '40,00 €',
  stock: 99,
  category: 'destockage',
  category_label: 'Déstockage',
  category_id: 26,
  description_short:
    'Gants Blade 14oz — destockage rentrée 2026. PU haute qualité, mousse EVA, velcro large, aération WindTec. Taille unique 14oz. 17,90 € au lieu de 40 €.',
  description:
    'Découvrez les gants de boxe Blade (coloris noir / blanc / gold). Fabriqués en PU haute qualité avec mousse EVA injectée haute densité. Large bande velcro, maintien du pouce, mesh WindTec à la paume. Taille 14oz uniquement. Idéal sac, pattes d’ours, sparring léger et boxe fitness.\n\nRetrait uniquement à Boxing Center Toulouse Minimes, le jour même de la commande : lundi–vendredi 12h–14h et 17h–21h15 ; samedi 15h–18h.',
  image: '/img/materiel/blade/blade-01.jpg',
  images: [
    '/img/materiel/blade/blade-01.jpg',
    '/img/materiel/blade/blade-02.jpg',
    '/img/materiel/blade/blade-03.jpg',
    '/img/materiel/blade/blade-04.jpg',
  ],
  combinations: [
    {
      id: 'blade-14oz',
      label: '14oz — Noir / Blanc / Gold',
      attributes: {
        Taille: '14oz',
        Couleur: 'Noir Blanc Gold',
        'Lieu retrait produits': MINIMES_PICKUP,
      },
      reference: 'BC-BLADE-GOLD-14OZ',
      price_cents: BLADE_PRICE_CENTS,
      price_label: '17,90 €',
      stock: 99,
      image: '/img/materiel/blade/blade-01.jpg',
    },
  ],
  pickup_gyms: [MINIMES_PICKUP],
  pickup_locked: MINIMES_PICKUP,
  pickup_same_day: true,
  pickup_hours: PICKUP_HOURS,
  pickup_note: PICKUP_NOTE,
  size: '14oz',
  featured_first: true,
  destockage: true,
  active: true,
  pickup_only: true,
  manual: true,
  source: 'blade-rentree-2026',
  default_variant_id: 'blade-14oz',
  tab: 'materiel',
  requires_iban: false,
  requires_payment: true,
  sale_type: 'materiel',
};

function isBladeProductId(id) {
  return String(id || '') === BLADE_ID || String(id || '') === BLADE_SLUG;
}

function adultAboEligible(product) {
  const p = product || {};
  const tab = String(p.tab || '');
  const subsection = String(p.subsection || '');
  if (tab === 'coachings' || subsection === 'coaching') return false;
  if (subsection === 'enfants') return false;
  if (tab === 'seance-essai' || subsection === 'essai') return true;
  if (tab === 'abonnements') return true;
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
    size: '14oz',
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

function ensureAddon(order) {
  if (!order.addons) order.addons = {};
  if (!order.addons.blade) {
    order.addons.blade = {
      product_id: BLADE_ID,
      name: BLADE_PRODUCT.name,
      size: '14oz',
      price_cents: BLADE_PRICE_CENTS,
      pickup_gym: MINIMES_PICKUP,
      status: 'pending',
    };
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

function saleWhatsAppText(order, source) {
  const c = customerFromOrder(order);
  const ref = order.order_id || '';
  return [
    'Vente matériel — Gants Blade Gold Blanc Noir 14oz',
    `Prénom : ${c.first_name || '—'}`,
    `Nom : ${c.last_name || '—'}`,
    `Tél : ${c.phone || '—'}`,
    `Produit : Gants Blade 14oz — 17,90 €`,
    `Retrait : Minimes, jour même (${PICKUP_HOURS})`,
    `Réf. : ${ref}${source ? ` (${source})` : ''}`,
  ].join('\n');
}

function alertWhatsAppText(sold) {
  return `ALERTE STOCK — ${sold} paires de Gants Blade Gold Blanc Noir vendues (seuil ${ALERT_AT} atteint). Les ventes continuent. Merci de réapprovisionner.`;
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

function mergeBladeIntoList(products) {
  const list = Array.isArray(products) ? [...products] : [];
  const idx = list.findIndex((p) => isBladeProductId(p.id) || p.slug === BLADE_SLUG);
  const blade = {
    ...BLADE_PRODUCT,
    tab: 'materiel',
    requires_iban: false,
    requires_payment: true,
    sale_type: 'materiel',
    pickup_only: true,
    manual: true,
  };
  if (idx >= 0) {
    list[idx] = { ...blade, ...list[idx], featured_first: true, destockage: true };
  } else {
    list.unshift(blade);
  }
  list.sort((a, b) => {
    const af = a.featured_first || isBladeProductId(a.id) ? 0 : 1;
    const bf = b.featured_first || isBladeProductId(b.id) ? 0 : 1;
    return af - bf;
  });
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
  await recordBladeSale(order, { source: paymentMeta.source || 'upsell' });
  return { order, already: false };
}

module.exports = {
  BLADE_ID,
  BLADE_SLUG,
  BLADE_PRICE_CENTS,
  BLADE_PRODUCT,
  MINIMES_PICKUP,
  PICKUP_HOURS,
  PICKUP_NOTE,
  ALERT_AT,
  REMUS_PHONE,
  isBladeProductId,
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
  skipBladeAddon,
  markBladeAddonPaid,
};
