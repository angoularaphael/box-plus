'use strict';

const { matchGymSlug, BOXING_CENTER_GYM_SLUGS } = require('../../lib/gym-slugs');
const { orderNeedsDeciplusSale, deciplusSaleSettled } = require('./deciplus-sale-reconcile');

const PARIS_TZ = 'Europe/Paris';

const GYM_DISPLAY = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'Saint-Cyprien',
  balma: 'Balma',
  unknown: 'Sans salle',
};

function parisDayKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARIS_TZ }).format(d);
}

function parisTodayKey() {
  return parisDayKey(new Date().toISOString());
}

function isAventureOrder(order = {}) {
  const source = String(order.source || '').toLowerCase();
  return Boolean(
    order.aventure ||
      order.skip_dossier ||
      source.includes('balma')
  );
}

function aventureSaleRecorded(order = {}) {
  if (order.deciplus_sale_id) return true;
  if (order.manual_migration) return true;
  const st = String(order.bot_status || '').toLowerCase();
  return st === 'manual_ok' || st === 'manual_coach';
}

function isMembershipSale(order = {}) {
  if (order.action) return false;
  if (/^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(String(order.order_id || ''))) return false;
  return order.payment?.status === 'paid';
}

function membershipPaidAt(order = {}) {
  return order.payment?.paid_at || order.updated_at || order.created_at;
}

function membershipProductName(order = {}) {
  return (
    order.product_snapshot?.display_name ||
    order.product_snapshot?.name ||
    order.product_name ||
    order.product_id ||
    'Abonnement'
  );
}

function membershipProductId(order = {}) {
  return order.product_id || order.product_snapshot?.id || membershipProductName(order);
}

function membershipRevenueCents(order = {}) {
  return Number(order.product_snapshot?.price_cents || order.payment?.amount_cents || 0) || 0;
}

function foldProductText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/€/g, 'e')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PRODUCT_GROUP_BY_ID = {
  'offre-duo': 'offre-29',
  offre_29: 'offre-29',
  'dp-104': 'offre-29',
  'offre-saison': 'offre-12mois',
  offre_259: 'offre-12mois',
  'dp-100': 'offre-12mois',
  'seance-essai': 'seance-essai',
  seance_essai: 'seance-essai',
};

function canonicalProductKey({ id, name } = {}) {
  const rawId = String(id || '')
    .toLowerCase()
    .trim();
  if (PRODUCT_GROUP_BY_ID[rawId]) return PRODUCT_GROUP_BY_ID[rawId];
  const folded = foldProductText(name);
  if (/offre\s*(a|duo)?\s*29/.test(folded) || folded === '29') return 'offre-29';
  if (/offre promo 12 mois|offre 259|12 mois/.test(folded) && /259|promo 12|saison/.test(folded)) {
    return 'offre-12mois';
  }
  if (/seance d essai|seance essai/.test(folded)) return 'seance-essai';
  return folded || rawId || 'autre';
}

function nicerProductName(next, current) {
  const a = String(next || '').trim();
  const b = String(current || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (/^(dp-|offre[_-]|seance[_-])/i.test(b) && !/^(dp-|offre[_-]|seance[_-])/i.test(a)) return a;
  if (a.length > b.length) return a;
  return b;
}

function orderDisplayName(order = {}) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const cust = order.customer || {};
  const first = short.first_name || full.first_name || cust.first_name || '';
  const last = short.last_name || full.last_name || cust.last_name || '';
  const name = `${first} ${last}`.replace(/\s+/g, ' ').trim();
  return name || short.email || full.email || cust.email || '—';
}

function paidBladeAddon(order = {}) {
  const blade = order?.addons?.blade;
  if (!blade || String(blade.status || '').toLowerCase() !== 'paid') return null;
  return blade;
}

function inscriptionMaterielSale(order = {}) {
  const blade = paidBladeAddon(order);
  if (!blade) return null;
  const name = [blade.name || 'Gants Blade', blade.color_label, blade.size].filter(Boolean).join(' ');
  const revenue = Number(blade.price_cents || 1790) || 0;
  return {
    order_id: order.order_id,
    source: 'inscription',
    payment: { status: 'paid' },
    paid_at: blade.paid_at || membershipPaidAt(order),
    created_at: order.created_at,
    pickup_gym: blade.pickup_gym || order.pickup_gym,
    gym: order.gym || order.customer_full?.gym,
    customer: order.customer_short || order.customer,
    customer_full: order.customer_full,
    customer_short: order.customer_short,
    total_cents: revenue,
    items: [
      {
        product_id: blade.variant_id || blade.product_id || 'mat-blade-gold',
        name,
        qty: 1,
        line_total_cents: revenue,
      },
    ],
  };
}

function collectInscriptionMaterielOrders(inscriptionOrders = []) {
  return inscriptionOrders.map(inscriptionMaterielSale).filter(Boolean);
}

function monthKeyFromIso(dateStr) {
  const day = parisDayKey(dateStr);
  return day ? day.slice(0, 7) : null;
}

function monthInFilter(iso, fromMonth, toMonth) {
  const month = monthKeyFromIso(iso);
  if (!month) return false;
  if (fromMonth && month < fromMonth) return false;
  if (toMonth && month > toMonth) return false;
  return true;
}

function buildMonthlySalesRows({
  inscriptionOrders = [],
  materielOrders = [],
  fromMonth = '',
  toMonth = '',
} = {}) {
  const byMonth = {};
  function bump(month, patch) {
    if (!byMonth[month]) {
      byMonth[month] = {
        month,
        materiel_orders: 0,
        materiel_revenue: 0,
        inscription_orders: 0,
        inscription_revenue: 0,
      };
    }
    Object.assign(byMonth[month], {
      materiel_orders: byMonth[month].materiel_orders + (patch.materiel_orders || 0),
      materiel_revenue: byMonth[month].materiel_revenue + (patch.materiel_revenue || 0),
      inscription_orders: byMonth[month].inscription_orders + (patch.inscription_orders || 0),
      inscription_revenue: byMonth[month].inscription_revenue + (patch.inscription_revenue || 0),
    });
  }

  for (const o of inscriptionOrders) {
    if (!isMembershipSale(o)) continue;
    const paidAt = membershipPaidAt(o);
    if (!monthInFilter(paidAt, fromMonth, toMonth)) continue;
    bump(monthKeyFromIso(paidAt), {
      inscription_orders: 1,
      inscription_revenue: membershipRevenueCents(o),
    });
  }

  const materielPlusAddons = [...materielOrders, ...collectInscriptionMaterielOrders(inscriptionOrders)];
  for (const o of materielPlusAddons) {
    if (o.payment?.status && o.payment.status !== 'paid') continue;
    const paidAt = o.paid_at || o.created_at;
    if (!monthInFilter(paidAt, fromMonth, toMonth)) continue;
    bump(monthKeyFromIso(paidAt), {
      materiel_orders: 1,
      materiel_revenue: Number(o.total_cents || 0) || 0,
    });
  }

  const rows = Object.keys(byMonth)
    .sort()
    .map((m) => byMonth[m]);
  const totals = rows.reduce(
    (acc, r) => ({
      materiel_orders: acc.materiel_orders + r.materiel_orders,
      materiel_revenue: acc.materiel_revenue + r.materiel_revenue,
      inscription_orders: acc.inscription_orders + r.inscription_orders,
      inscription_revenue: acc.inscription_revenue + r.inscription_revenue,
    }),
    { materiel_orders: 0, materiel_revenue: 0, inscription_orders: 0, inscription_revenue: 0 }
  );
  totals.revenue = totals.materiel_revenue + totals.inscription_revenue;
  totals.orders = totals.materiel_orders + totals.inscription_orders;
  return { rows, totals };
}

function catalogMatchKey(product = {}) {
  return String(product.id || product.product_id || product.slug || product.name || '')
    .toLowerCase()
    .trim();
}

function isBladeLikeId(id) {
  const key = String(id || '').toLowerCase();
  return /blade|mat-blade|gants-boxe-blade/.test(key);
}

function buildMaterielStockRows({
  catalogProducts = [],
  inscriptionOrders = [],
  materielOrders = [],
  fromMonth = '',
  toMonth = '',
} = {}) {
  const sold = {};
  function bumpSold(id, name, { qty = 1, revenue = 0, source = 'boutique' } = {}) {
    const key = catalogMatchKey({ id, name }) || name || 'materiel';
    if (!sold[key]) {
      sold[key] = {
        id: key,
        name: String(name || id || 'Matériel').trim(),
        sold_boutique: 0,
        sold_inscription: 0,
        revenue: 0,
      };
    }
    if (source === 'inscription') sold[key].sold_inscription += qty;
    else sold[key].sold_boutique += qty;
    sold[key].revenue += revenue;
    if (name && String(name).length > String(sold[key].name).length) sold[key].name = name;
  }

  for (const o of materielOrders) {
    if (o.payment?.status && o.payment.status !== 'paid') continue;
    const paidAt = o.paid_at || o.created_at;
    if (!monthInFilter(paidAt, fromMonth, toMonth)) continue;
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) {
      bumpSold('materiel', 'Matériel', {
        qty: 1,
        revenue: Number(o.total_cents || 0) || 0,
        source: 'boutique',
      });
      continue;
    }
    for (const item of items) {
      bumpSold(item.product_id || item.name, item.name || 'Matériel', {
        qty: Number(item.qty || 1) || 1,
        revenue: Number(item.line_total_cents || 0) || 0,
        source: 'boutique',
      });
    }
  }

  for (const o of inscriptionOrders) {
    const sale = inscriptionMaterielSale(o);
    if (!sale) continue;
    if (!monthInFilter(sale.paid_at, fromMonth, toMonth)) continue;
    const item = sale.items[0];
    bumpSold(item.product_id, item.name, {
      qty: 1,
      revenue: item.line_total_cents,
      source: 'inscription',
    });
  }

  const catalogRows = (catalogProducts || []).map((p) => {
    const keys = [p.id, p.slug, p.name, ...(Array.isArray(p.combinations) ? p.combinations.map((c) => c.id) : [])]
      .map((k) => catalogMatchKey({ id: k }))
      .filter(Boolean);
    const matched = Object.values(sold).filter((s) => {
      if (keys.includes(s.id)) return true;
      if (isBladeLikeId(p.id) && isBladeLikeId(s.id)) return true;
      const foldedName = foldProductText(p.display_name || p.name);
      return foldedName && foldProductText(s.name).includes(foldedName.slice(0, 18));
    });
    const sold_boutique = matched.reduce((n, s) => n + s.sold_boutique, 0);
    const sold_inscription = matched.reduce((n, s) => n + s.sold_inscription, 0);
    const revenue = matched.reduce((n, s) => n + s.revenue, 0);
    matched.forEach((s) => {
      s._cataloged = true;
    });
    return {
      id: p.id,
      name: p.display_name || p.name || p.id,
      stock: Number(p.stock || 0) || 0,
      sold_boutique,
      sold_inscription,
      sold_qty: sold_boutique + sold_inscription,
      revenue,
      variants: (p.combinations || []).map((c) => ({
        id: c.id,
        label: c.label || c.size || '',
        stock: Number(c.stock || 0) || 0,
      })),
    };
  });

  const orphans = Object.values(sold)
    .filter((s) => !s._cataloged && s.sold_boutique + s.sold_inscription > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      stock: null,
      sold_boutique: s.sold_boutique,
      sold_inscription: s.sold_inscription,
      sold_qty: s.sold_boutique + s.sold_inscription,
      revenue: s.revenue,
      variants: [],
    }));

  return [...catalogRows, ...orphans]
    .filter((row) => row.sold_qty > 0 || Number(row.stock) > 0)
    .sort((a, b) => b.sold_qty - a.sold_qty || String(a.name).localeCompare(String(b.name), 'fr'));
}

function listInscriptionMaterielSales(inscriptionOrders = [], { fromMonth = '', toMonth = '' } = {}) {
  return inscriptionOrders
    .map((o) => {
      const sale = inscriptionMaterielSale(o);
      if (!sale) return null;
      if (!monthInFilter(sale.paid_at, fromMonth, toMonth)) return null;
      const item = sale.items[0];
      return {
        order_id: o.order_id,
        name: orderDisplayName(o),
        product: item.name,
        gym: gymSlugFromOrder(o),
        pickup: sale.pickup_gym || '',
        paid_at: sale.paid_at,
        revenue: item.line_total_cents,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.paid_at || 0) - Date.parse(a.paid_at || 0));
}

function hasDeciplusFiche(order = {}) {
  if (order.deciplus_member_id || order.deciplus_sale_id) return true;
  return deciplusSaleSettled(order);
}

function dispatchInProgress(order = {}, now = Date.now()) {
  const dr = order.dispatch_result || {};
  if (dr.synced_from_bot) return false;
  if (dr.queued === false && dr.reason) return false;
  const at = Date.parse(order.dispatched_at || '');
  return Number.isFinite(at) && now - at < 20 * 60 * 1000;
}

function missingFicheReason(order = {}, { inProgress = false } = {}) {
  if (inProgress) return 'en_cours';
  const st = String(order.bot_status || '').toLowerCase();
  if (order.bot_error || st === 'manual_review' || st === 'error') return 'bot_error';
  if (order.dispatch_result?.reason === 'already_processed') return 'envoye_sans_retour';
  if (order.dispatched_at) return 'envoye_sans_retour';
  return 'jamais_envoye';
}

function missingFicheRows(
  inscriptionOrders = [],
  { fromMonth = '', toMonth = '', now = Date.now() } = {}
) {
  const rows = [];
  for (const o of inscriptionOrders) {
    if (!isMembershipSale(o)) continue;
    if (o.manual_migration || o.skip_bot) continue;
    if (hasDeciplusFiche(o)) continue;
    const paidAt = membershipPaidAt(o);
    if ((fromMonth || toMonth) && !monthInFilter(paidAt, fromMonth, toMonth)) continue;
    const inProgress = dispatchInProgress(o, now);
    rows.push({
      order_id: o.order_id,
      name: orderDisplayName(o),
      gym: gymSlugFromOrder(o),
      paid_at: paidAt,
      signed: Boolean(o.signature?.signed_at),
      ready: !inProgress && orderNeedsDeciplusSale(o, now),
      dispatched: Boolean(o.dispatched_at),
      in_progress: inProgress,
      bot_status: o.bot_status || null,
      bot_error: o.bot_error ? String(o.bot_error).slice(0, 140) : null,
      reason: missingFicheReason(o, { inProgress }),
    });
  }
  return rows.sort((a, b) => Date.parse(b.paid_at || 0) - Date.parse(a.paid_at || 0));
}

function bumpProduct(map, { id, name, kind, qty = 1, revenue = 0 }) {
  const key = canonicalProductKey({ id, name });
  if (!map[key]) {
    map[key] = { id: key, name: String(name || id || 'Produit').trim(), kind, qty: 0, revenue: 0 };
  } else {
    map[key].name = nicerProductName(name, map[key].name);
  }
  map[key].qty += qty;
  map[key].revenue += revenue;
}

function gymSlugFromOrder(order = {}) {
  const candidates = [
    order.gym,
    order.customer_full?.gym,
    order.customer?.gym,
    order.pickup_gym,
    order.customer?.pickup_gym,
  ];
  for (const raw of candidates) {
    const slug = matchGymSlug(raw);
    if (slug) return slug;
  }
  if (isAventureOrder(order)) return 'balma';
  return 'unknown';
}

function emptyGymRow(gym) {
  return {
    gym,
    label: GYM_DISPLAY[gym] || gym,
    orders: 0,
    revenue: 0,
    inscription_orders: 0,
    inscription_revenue: 0,
    materiel_orders: 0,
    materiel_revenue: 0,
  };
}

function bumpGym(map, gym, { kind, revenue = 0 } = {}) {
  if (!map[gym]) map[gym] = emptyGymRow(gym);
  const cents = Number(revenue) || 0;
  map[gym].orders += 1;
  map[gym].revenue += cents;
  if (kind === 'materiel') {
    map[gym].materiel_orders += 1;
    map[gym].materiel_revenue += cents;
  } else {
    map[gym].inscription_orders += 1;
    map[gym].inscription_revenue += cents;
  }
}

function lastNDayKeys(n = 14) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000);
    keys.push(parisDayKey(d.toISOString()));
  }
  return keys;
}

/**
 * Agrège ventes payées (abos + matériel) pour le tableau de bord admin.
 */
function buildAdminSalesExtras({
  inscriptionOrders = [],
  materielOrders = [],
  fromMonth = '',
  toMonth = '',
  dayCount = 14,
  lookupDay = '',
} = {}) {
  function monthInRange(iso) {
    const key = parisDayKey(iso);
    if (!key) return false;
    const month = key.slice(0, 7);
    if (fromMonth && month < fromMonth) return false;
    if (toMonth && month > toMonth) return false;
    return true;
  }

  const products = {};
  const byDay = {};
  const byGym = {};
  for (const slug of BOXING_CENTER_GYM_SLUGS) {
    byGym[slug] = emptyGymRow(slug);
  }
  const today = parisTodayKey();
  let today_count = 0;
  let today_revenue = 0;
  const materielWithAddons = [...materielOrders, ...collectInscriptionMaterielOrders(inscriptionOrders)];

  function dayTotal(row) {
    return (row.inscriptions || 0) + (row.materiel || 0);
  }

  function snapshotDay(day) {
    const row = byDay[day] || { day, inscriptions: 0, materiel: 0, revenue: 0 };
    return {
      day,
      inscriptions: row.inscriptions || 0,
      materiel: row.materiel || 0,
      total: dayTotal(row),
      revenue: row.revenue || 0,
    };
  }

  const aventure = {
    total: 0,
    paid: 0,
    signed: 0,
    dispatched: 0,
    missing_sale: 0,
  };
  let missing_deciplus_sale = 0;

  for (const o of inscriptionOrders) {
    if (isAventureOrder(o)) {
      aventure.total += 1;
      if (o.payment?.status === 'paid') aventure.paid += 1;
      if (o.signature?.signed_at) aventure.signed += 1;
      if (o.dispatched_at) aventure.dispatched += 1;
      if (o.payment?.status === 'paid' && !aventureSaleRecorded(o)) aventure.missing_sale += 1;
    }
    if (orderNeedsDeciplusSale(o)) missing_deciplus_sale += 1;
    if (!isMembershipSale(o)) continue;
    const paidAt = membershipPaidAt(o);
    const day = parisDayKey(paidAt);
    if (day === today) {
      today_count += 1;
      today_revenue += membershipRevenueCents(o);
    }
    if (day) {
      if (!byDay[day]) byDay[day] = { day, inscriptions: 0, materiel: 0, revenue: 0 };
      byDay[day].inscriptions += 1;
      byDay[day].revenue += membershipRevenueCents(o);
    }
    if (!monthInRange(paidAt)) continue;
    const membershipRevenue = membershipRevenueCents(o);
    bumpGym(byGym, gymSlugFromOrder(o), {
      kind: isAventureOrder(o) ? 'aventure' : 'abonnement',
      revenue: membershipRevenue,
    });
    bumpProduct(products, {
      id: membershipProductId(o),
      name: membershipProductName(o),
      kind: isAventureOrder(o) ? 'aventure' : 'abonnement',
      qty: 1,
      revenue: membershipRevenue,
    });
  }

  for (const o of materielWithAddons) {
    if (o.payment?.status && o.payment.status !== 'paid') continue;
    const paidAt = o.paid_at || o.created_at;
    const day = parisDayKey(paidAt);
    const revenue = Number(o.total_cents || 0) || 0;
    if (day === today) {
      today_count += 1;
      today_revenue += revenue;
    }
    if (day) {
      if (!byDay[day]) byDay[day] = { day, inscriptions: 0, materiel: 0, revenue: 0 };
      byDay[day].materiel += 1;
      byDay[day].revenue += revenue;
    }
    if (!monthInRange(paidAt)) continue;
    bumpGym(byGym, gymSlugFromOrder(o), { kind: 'materiel', revenue });
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) {
      bumpProduct(products, {
        id: 'materiel',
        name: 'Matériel',
        kind: 'materiel',
        qty: 1,
        revenue,
      });
    } else {
      for (const item of items) {
        bumpProduct(products, {
          id: item.product_id || item.name,
          name: item.name || 'Matériel',
          kind: 'materiel',
          qty: Number(item.qty || 1) || 1,
          revenue: Number(item.line_total_cents || 0) || 0,
        });
      }
    }
  }

  const top_products = Object.values(products)
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 8);

  const daily_sales = lastNDayKeys(dayCount).map((day) => ({
    day,
    inscriptions: byDay[day]?.inscriptions || 0,
    materiel: byDay[day]?.materiel || 0,
    total: (byDay[day]?.inscriptions || 0) + (byDay[day]?.materiel || 0),
    revenue: byDay[day]?.revenue || 0,
  }));

  let best_day = null;
  for (const row of Object.values(byDay)) {
    const snap = snapshotDay(row.day);
    if (!best_day || snap.total > best_day.total || (snap.total === best_day.total && snap.revenue > best_day.revenue)) {
      best_day = snap;
    }
  }

  const lookup_day = lookupDay ? snapshotDay(lookupDay) : null;

  const by_gym = Object.values(byGym)
    .filter((row) => BOXING_CENTER_GYM_SLUGS.includes(row.gym) || row.orders > 0)
    .sort((a, b) => {
      if (a.gym === 'unknown') return 1;
      if (b.gym === 'unknown') return -1;
      return b.revenue - a.revenue || String(a.label).localeCompare(String(b.label), 'fr');
    });

  const missing_fiches = missingFicheRows(inscriptionOrders, {
    fromMonth,
    toMonth,
  });

  return {
    today: { day: today, count: today_count, revenue: today_revenue },
    lookup_day,
    best_day,
    top_products,
    daily_sales,
    by_gym,
    aventure,
    missing_deciplus_sale,
    missing_fiches,
    missing_fiches_count: missing_fiches.filter((row) => !row.in_progress).length,
  };
}

module.exports = {
  parisDayKey,
  parisTodayKey,
  isAventureOrder,
  aventureSaleRecorded,
  isMembershipSale,
  gymSlugFromOrder,
  buildAdminSalesExtras,
  buildMonthlySalesRows,
  buildMaterielStockRows,
  listInscriptionMaterielSales,
  collectInscriptionMaterielOrders,
  missingFicheRows,
  missingFicheReason,
  hasDeciplusFiche,
  dispatchInProgress,
  orderDisplayName,
};
