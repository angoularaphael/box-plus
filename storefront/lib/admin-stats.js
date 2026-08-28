'use strict';

const { matchGymSlug, BOXING_CENTER_GYM_SLUGS } = require('../../lib/gym-slugs');

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

  for (const o of inscriptionOrders) {
    if (isAventureOrder(o)) {
      aventure.total += 1;
      if (o.payment?.status === 'paid') aventure.paid += 1;
      if (o.signature?.signed_at) aventure.signed += 1;
      if (o.dispatched_at) aventure.dispatched += 1;
      if (o.payment?.status === 'paid' && !aventureSaleRecorded(o)) aventure.missing_sale += 1;
    }
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

  for (const o of materielOrders) {
    if (o.payment?.status !== 'paid') continue;
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

  return {
    today: { day: today, count: today_count, revenue: today_revenue },
    lookup_day,
    best_day,
    top_products,
    daily_sales,
    by_gym,
    aventure,
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
};
