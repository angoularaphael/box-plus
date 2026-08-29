'use strict';

/**
 * WhatsApp ventes matériel : un manager par salle de retrait choisie.
 * Distinct des managers d’accueil (bc-knowledge) — ici c’est le responsable
 * destockage / retrait, comme Remus pour Blade.
 */
const { matchGymSlug } = require('../../lib/gym-slugs');
const { resolvePickupGym } = require('./gym-pickup');
const { sendWhatsAppMessage } = require('./whatsapp-bot');
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
  if (Array.isArray(order?.items) && order.items.length) {
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

function shouldSkipWhatsApp(order, env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'test') return true;
  const method = String(order?.payment?.method || order?.addons?.blade?.method || '');
  return method === 'demo';
}

const WA_FALLBACK_EMAIL = 'boxing31@gmail.com';

function managerEmail(manager) {
  if (manager?.email) return String(manager.email).trim();
  return WA_FALLBACK_EMAIL;
}

async function sendManagerSaleEmail(manager, message, order) {
  const to = WA_FALLBACK_EMAIL;
  const { sendEmailViaBrevo, isConfigured } = require('./brevo-send');
  if (!isConfigured()) return { sent: false, reason: 'brevo_not_configured', to };
  const ref = order?.order_id || '';
  const who = manager?.name || manager?.label || manager?.slug || 'manager';
  const result = await sendEmailViaBrevo({
    to,
    subject: `WhatsApp non parti — vente ${who} — ${ref}`.trim(),
    text: message,
    html: `<p style="font-family:Arial,sans-serif;color:#b45309"><strong>WhatsApp non envoyé</strong> — copie pour ${String(who)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}.</p>
<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;font-size:15px">${String(message || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`,
  });
  return { sent: Boolean(result), to };
}

function applyManagerNotify(order, result, source) {
  if (!order) return null;
  const payload = {
    sent: Boolean(result?.sent),
    via: result?.via || null,
    skipped: result?.skipped || null,
    error: result?.error || null,
    manager: result?.manager || null,
    gym: result?.gym || null,
    already: Boolean(result?.already),
    at: new Date().toISOString(),
    source: source || result?.source || 'materiel',
  };
  order.manager_notify = payload;
  if (order.addons?.blade) order.addons.blade.manager_notify = payload;
  return payload;
}

async function notifyManager(manager, message, order, hooks = {}) {
  if (!manager?.phone && !managerEmail(manager)) return { sent: false, error: 'no_manager' };
  if (!hooks.sendWa && !hooks.sendEmail && shouldSkipWhatsApp(order)) {
    logInfo('WhatsApp manager matériel ignoré (tests/démo)', {
      manager: manager.name,
      gym: manager.slug,
    });
    return { sent: false, skipped: 'demo', manager: manager.name, gym: manager.slug };
  }

  const sendWa =
    hooks.sendWa ||
    ((phone, text) => sendWhatsAppMessage(phone, text, { kind: 'transactional', timeoutMs: 4000 }));
  const sendEmail = hooks.sendEmail || sendManagerSaleEmail;

  let whatsapp = { sent: false };
  const { isAllWhatsAppPaused, isPromoWhatsAppPaused } = require('./whatsapp-outbound');
  const skipWa = isAllWhatsAppPaused() || isPromoWhatsAppPaused();
  if (!skipWa && manager.phone) {
    try {
      await sendWa(manager.phone, message);
      whatsapp = { sent: true };
    } catch (err) {
      whatsapp = { sent: false, error: err.message };
      logWarn('WhatsApp manager matériel', {
        manager: manager.name,
        gym: manager.slug,
        error: err.message,
      });
    }
  } else if (skipWa) {
    whatsapp = { sent: false, skipped: 'restricted' };
  }

  let email = { sent: false };
  if (!whatsapp.sent) {
    try {
      email = await sendEmail(manager, message, order);
    } catch (err) {
      email = { sent: false, error: err.message };
      logWarn('Email manager matériel', {
        manager: manager.name,
        gym: manager.slug,
        error: err.message,
      });
    }
  }

  const sent = Boolean(whatsapp.sent || email.sent);
  return {
    sent,
    via: whatsapp.sent ? 'whatsapp' : email.sent ? 'email' : null,
    whatsapp,
    email,
    error: sent ? null : email.error || whatsapp.error || 'not_sent',
    manager: manager.name,
    gym: manager.slug,
    phone: manager.phone,
  };
}

async function notifyMaterielSale(order, { source = 'materiel', force = false, ...hooks } = {}) {
  const existing = order?.manager_notify || order?.addons?.blade?.manager_notify;
  if (!force && existing?.sent) {
    return { ...existing, already: true, sent: true };
  }
  const gymRaw = pickupGymFromOrder(order, source);
  const manager = resolveManagerForPickup(gymRaw);
  if (!manager) {
    logWarn('WhatsApp manager matériel : salle sans responsable', { gym: gymRaw, order_id: order?.order_id });
    return { sent: false, error: 'unknown_gym', gym: gymRaw };
  }
  const message = saleWhatsAppText(order, source);
  const result = await notifyManager(manager, message, order, hooks);
  logInfo('Vente matériel notifiée', {
    order_id: order?.order_id,
    gym: manager.slug,
    manager: manager.name,
    source,
    sent: result.sent,
    via: result.via || null,
    skipped: result.skipped || null,
    error: result.error || null,
  });
  return { ...result, message };
}

function materielSaleSummary(order, source) {
  const src = source || (order?.order_type === 'materiel' ? 'materiel' : 'upsell');
  const lines = saleLines(order, src);
  const customer = customerFromOrder(order);
  const gymRaw = pickupGymFromOrder(order, src);
  const manager = resolveManagerForPickup(gymRaw);
  const notify = order?.manager_notify || order?.addons?.blade?.manager_notify || null;
  const paid =
    src === 'upsell'
      ? order?.addons?.blade?.status === 'paid'
      : order?.payment?.status === 'paid';
  const total =
    src === 'upsell'
      ? Number(order?.addons?.blade?.price_cents || 0)
      : Number(order?.total_cents || 0);
  return {
    order_id: order?.order_id,
    source: src,
    created_at: order?.created_at || null,
    paid_at: order?.paid_at || order?.addons?.blade?.paid_at || order?.payment?.paid_at || null,
    payment_status: paid ? 'paid' : order?.payment?.status || 'pending',
    payment_method: order?.payment?.method || order?.addons?.blade?.method || null,
    total_cents: total,
    product:
      lines.map((l) => [l.name, l.variant].filter(Boolean).join(' ')).join(', ') || '—',
    items: lines,
    customer,
    pickup_gym: gymRaw,
    pickup_label: manager?.label || gymRaw || '—',
    manager_name: manager?.name || null,
    manager_phone: manager?.phone || null,
    manager_notify: notify,
    email_sent: Boolean(order?.email_sent),
  };
}

function listMaterielSales(materielOrders = [], inscriptionOrders = [], { paidOnly = true } = {}) {
  const rows = [];
  for (const order of materielOrders) {
    rows.push(materielSaleSummary(order, 'materiel'));
  }
  for (const order of inscriptionOrders) {
    if (order?.addons?.blade?.status === 'paid') {
      rows.push(materielSaleSummary(order, 'upsell'));
    }
  }
  rows.sort(
    (a, b) =>
      new Date(b.paid_at || b.created_at || 0).getTime() -
      new Date(a.paid_at || a.created_at || 0).getTime()
  );
  if (!paidOnly) return rows;
  return rows.filter((row) => row.payment_status === 'paid');
}

module.exports = {
  GYM_MATERIEL_MANAGERS,
  pickupGymSlug,
  resolveManagerForPickup,
  saleWhatsAppText,
  pickupGymFromOrder,
  shouldSkipWhatsApp,
  applyManagerNotify,
  notifyManager,
  notifyMaterielSale,
  sendManagerSaleEmail,
  managerEmail,
  WA_FALLBACK_EMAIL,
  materielSaleSummary,
  listMaterielSales,
};
