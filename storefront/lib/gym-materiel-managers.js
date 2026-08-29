'use strict';

/**
 * WhatsApp ventes matériel : un manager par salle de retrait choisie.
 * Distinct des managers d’accueil (bc-knowledge) — ici c’est le responsable
 * destockage / retrait, comme Remus pour Blade.
 */
const { matchGymSlug } = require('../../lib/gym-slugs');
const { resolvePickupGym } = require('./gym-pickup');
const { sendWhatsAppMessage } = require('./whatsapp-bot');
const { isDemoCheckoutAllowed } = require('./security');
const { logInfo, logWarn } = require('../../lib/logger');

const GYM_MATERIEL_MANAGERS = {
  minimes: {
    slug: 'minimes',
    name: 'Remus',
    phone: '0767919166',
    label: 'Barrière de Paris - Minimes',
  },
  portet: {
    slug: 'portet',
    name: 'Tapia',
    phone: '0687900216',
    label: 'Portet-sur-Garonne',
  },
  'st-cyprien': {
    slug: 'st-cyprien',
    name: 'DaDi',
    phone: '0625745369',
    label: 'Toulouse St-Cyprien',
  },
  ramonville: {
    slug: 'ramonville',
    name: 'Pascal',
    phone: '0785907484',
    label: 'Ramonville',
  },
  'etats-unis': {
    slug: 'etats-unis',
    name: 'Sébastien',
    phone: '0760941608',
    label: 'États-Unis',
  },
};

function pickupGymSlug(raw) {
  const resolved = resolvePickupGym(raw);
  if (resolved?.id && GYM_MATERIEL_MANAGERS[resolved.id]) return resolved.id;
  return matchGymSlug(raw);
}

function resolveManagerForPickup(pickupGym) {
  const slug = pickupGymSlug(pickupGym);
  return (slug && GYM_MATERIEL_MANAGERS[slug]) || null;
}

function customerFromOrder(order) {
  const short = order?.customer_short || {};
  const full = order?.customer_full || {};
  const customer = order?.customer || {};
  return {
    first_name: short.first_name || full.first_name || customer.first_name || '',
    last_name: short.last_name || full.last_name || customer.last_name || '',
    phone: short.phone || full.phone || customer.phone || '',
  };
}

function money(cents) {
  const n = Number(cents || 0);
  return `${(n / 100).toFixed(2).replace('.', ',')} €`;
}

function saleLines(order, source) {
  if (source === 'upsell') {
    const addon = order?.addons?.blade;
    if (addon) {
      return [
        {
          name: addon.name || 'Gants Blade',
          variant: [addon.color_label, addon.size].filter(Boolean).join(' '),
          qty: 1,
          cents: addon.price_cents || 1790,
        },
      ];
    }
  }
  if (Array.isArray(order?.items) && order.items.length && order.order_type === 'materiel') {
    return order.items.map((item) => ({
      name: item.name || 'Article',
      variant: item.variant_label || '',
      qty: Math.max(1, Number(item.qty || 1)),
      cents: item.line_total_cents || item.unit_cents || 0,
    }));
  }
  const addon = order?.addons?.blade;
  if (addon && addon.status === 'paid') {
    return [
      {
        name: addon.name || 'Gants Blade',
        variant: [addon.color_label, addon.size].filter(Boolean).join(' '),
        qty: 1,
        cents: addon.price_cents || 1790,
      },
    ];
  }
  return [];
}

function pickupDelayLabel(order, source) {
  if (source === 'upsell' || (order?.addons?.blade?.status === 'paid' && order?.order_type !== 'materiel')) {
    return 'jour même';
  }
  const lines = Array.isArray(order?.items) ? order.items : [];
  try {
    const { findMaterielProduct } = require('./merch');
    const allSameDay =
      lines.length > 0 &&
      lines.every((item) => findMaterielProduct(item.product_id)?.pickup_same_day);
    return allSameDay ? 'jour même' : 'sous 48h';
  } catch {
    return 'sous 48h';
  }
}

function pickupGymFromOrder(order, source) {
  if (source === 'upsell' || (order?.addons?.blade && order?.order_type !== 'materiel')) {
    return order.addons?.blade?.pickup_gym || 'Barrière de Paris - Minimes';
  }
  return order?.pickup_gym || order?.customer?.pickup_gym || '';
}

function saleWhatsAppText(order, source) {
  const c = customerFromOrder(order);
  const lines = saleLines(order, source);
  const manager = resolveManagerForPickup(pickupGymFromOrder(order, source));
  const gymLabel = manager?.label || pickupGymFromOrder(order, source) || '—';
  const delay = pickupDelayLabel(order, source);
  const productBlock =
    lines.length === 1
      ? `${lines[0].name}${lines[0].variant ? ` ${lines[0].variant}` : ''}${
          lines[0].qty > 1 ? ` ×${lines[0].qty}` : ''
        } — ${money(lines[0].cents)}`
      : lines
          .map(
            (l) =>
              `- ${l.name}${l.variant ? ` ${l.variant}` : ''}${l.qty > 1 ? ` ×${l.qty}` : ''} — ${money(l.cents)}`
          )
          .join('\n');
  const headline =
    lines.length === 1
      ? `Vente matériel — ${lines[0].name}${lines[0].variant ? ` ${lines[0].variant}` : ''}`
      : `Vente matériel — ${lines.length} articles`;
  const ref = order?.order_id || '';
  return [
    headline,
    `Prénom : ${c.first_name || '—'}`,
    `Nom : ${c.last_name || '—'}`,
    `Tél : ${c.phone || '—'}`,
    `Produit : ${productBlock}`,
    `Retrait : ${gymLabel}, ${delay}`,
    `Réf. : ${ref}${source ? ` (${source})` : ''}`,
  ].join('\n');
}

function shouldSkipWhatsApp() {
  if (process.env.NODE_ENV === 'test') return true;
  return isDemoCheckoutAllowed();
}

async function notifyManager(manager, message) {
  if (!manager?.phone) return { sent: false, error: 'no_manager' };
  if (shouldSkipWhatsApp()) {
    logInfo('WhatsApp manager matériel ignoré (démo/test)', { manager: manager.name, gym: manager.slug });
    return { sent: false, skipped: 'demo', manager: manager.name, gym: manager.slug };
  }
  try {
    await sendWhatsAppMessage(manager.phone, message);
    return { sent: true, manager: manager.name, gym: manager.slug, phone: manager.phone };
  } catch (err) {
    logWarn('WhatsApp manager matériel', {
      manager: manager.name,
      gym: manager.slug,
      error: err.message,
    });
    return { sent: false, error: err.message, manager: manager.name, gym: manager.slug };
  }
}

async function notifyMaterielSale(order, { source = 'materiel' } = {}) {
  const gymRaw = pickupGymFromOrder(order, source);
  const manager = resolveManagerForPickup(gymRaw);
  if (!manager) {
    logWarn('WhatsApp manager matériel : salle sans responsable', { gym: gymRaw, order_id: order?.order_id });
    return { sent: false, error: 'unknown_gym', gym: gymRaw };
  }
  const message = saleWhatsAppText(order, source);
  const result = await notifyManager(manager, message);
  logInfo('Vente matériel notifiée', {
    order_id: order?.order_id,
    gym: manager.slug,
    manager: manager.name,
    source,
    sent: result.sent,
  });
  return { ...result, message };
}

module.exports = {
  GYM_MATERIEL_MANAGERS,
  pickupGymSlug,
  resolveManagerForPickup,
  saleWhatsAppText,
  pickupGymFromOrder,
  notifyManager,
  notifyMaterielSale,
};
