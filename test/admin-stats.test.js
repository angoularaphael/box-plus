'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildAdminSalesExtras,
  buildMonthlySalesRows,
  buildMaterielStockRows,
  listInscriptionMaterielSales,
  isAventureOrder,
  parisDayKey,
} = require('../storefront/lib/admin-stats');

test('isAventureOrder détecte le retour Balma', () => {
  assert.equal(isAventureOrder({ aventure: true }), true);
  assert.equal(isAventureOrder({ source: 'balma_retour' }), true);
  assert.equal(isAventureOrder({ skip_dossier: true }), true);
  assert.equal(isAventureOrder({ source: 'boutique' }), false);
});

test('ventes du jour + plus vendu + aventure sans vente Deciplus', () => {
  const today = parisDayKey(new Date().toISOString());
  const extras = buildAdminSalesExtras({
    inscriptionOrders: [
      {
        order_id: 'BC-1',
        aventure: true,
        source: 'balma_retour',
        payment: { status: 'paid', paid_at: `${today}T10:00:00.000Z` },
        signature: { signed_at: `${today}T10:05:00.000Z` },
        dispatched_at: `${today}T10:06:00.000Z`,
        deciplus_sale_id: null,
        product_id: 'dp-104',
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
      {
        order_id: 'BC-2',
        gym: 'portet',
        payment: { status: 'paid', paid_at: `${today}T11:00:00.000Z` },
        product_id: 'dp-100',
        product_snapshot: { display_name: 'OFFRE 259€', price_cents: 25900 },
      },
      {
        order_id: 'BC-3',
        payment: { status: 'pending' },
        product_id: 'dp-104',
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
    ],
    materielOrders: [
      {
        payment: { status: 'paid' },
        paid_at: `${today}T12:00:00.000Z`,
        pickup_gym: 'minimes',
        total_cents: 2899,
        items: [{ product_id: 'gants', name: 'Gants', qty: 2, line_total_cents: 2899 }],
      },
    ],
  });

  assert.equal(extras.today.count, 3);
  assert.equal(extras.aventure.paid, 1);
  assert.equal(extras.aventure.missing_sale, 1);
  assert.equal(extras.missing_deciplus_sale, 1);
  assert.equal(extras.top_products[0].name, 'Gants');
  assert.equal(extras.top_products[0].qty, 2);
  const todayBar = extras.daily_sales.find((d) => d.day === today);
  assert.equal(todayBar.total, 3);
  assert.equal(todayBar.inscriptions, 2);
  assert.equal(todayBar.materiel, 1);
  assert.ok(extras.best_day);
  assert.equal(extras.best_day.total, 3);
  assert.equal(extras.best_day.day, today);
});

test('aventure migré à la main n’est pas une vente Deciplus manquante', () => {
  const extras = buildAdminSalesExtras({
    inscriptionOrders: [
      {
        order_id: 'BC-1787833279215-624967',
        aventure: true,
        source: 'balma_retour',
        payment: { status: 'paid', paid_at: '2026-08-27T12:22:24.010Z' },
        deciplus_member_id: '14238',
        bot_status: 'manual_ok',
        manual_migration: true,
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
    ],
  });
  assert.equal(extras.aventure.paid, 1);
  assert.equal(extras.aventure.missing_sale, 0);
  assert.equal(extras.missing_deciplus_sale, 0);
});

test('stats — ventes d’un jour choisi et meilleur jour', () => {
  const extras = buildAdminSalesExtras({
    inscriptionOrders: [
      {
        payment: { status: 'paid', paid_at: '2026-08-10T10:00:00.000Z' },
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
      {
        payment: { status: 'paid', paid_at: '2026-08-10T11:00:00.000Z' },
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
      {
        payment: { status: 'paid', paid_at: '2026-08-11T10:00:00.000Z' },
        product_snapshot: { display_name: 'OFFRE 259€', price_cents: 25900 },
      },
    ],
    materielOrders: [
      {
        payment: { status: 'paid' },
        paid_at: '2026-08-11T12:00:00.000Z',
        total_cents: 4500,
      },
      {
        payment: { status: 'paid' },
        paid_at: '2026-08-11T13:00:00.000Z',
        total_cents: 2000,
      },
    ],
    lookupDay: '2026-08-11',
  });
  assert.equal(extras.lookup_day.day, '2026-08-11');
  assert.equal(extras.lookup_day.inscriptions, 1);
  assert.equal(extras.lookup_day.materiel, 2);
  assert.equal(extras.lookup_day.total, 3);
  assert.equal(extras.best_day.day, '2026-08-11');
  assert.equal(extras.best_day.total, 3);
  const empty = buildAdminSalesExtras({ lookupDay: '2026-01-01' });
  assert.equal(empty.lookup_day.total, 0);
  assert.equal(empty.best_day, null);
});

test('chiffre d’affaires par salle — inscriptions + matériel, hors période ignoré', () => {
  const extras = buildAdminSalesExtras({
    inscriptionOrders: [
      {
        gym: 'portet',
        payment: { status: 'paid', paid_at: '2026-08-10T10:00:00.000Z' },
        product_snapshot: { display_name: 'OFFRE 259€', price_cents: 25900 },
      },
      {
        customer_full: { gym: 'ramonville' },
        payment: { status: 'paid', paid_at: '2026-08-11T10:00:00.000Z' },
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
      {
        gym: 'minimes',
        payment: { status: 'paid', paid_at: '2026-07-01T10:00:00.000Z' },
        product_snapshot: { display_name: 'OFFRE 259€', price_cents: 25900 },
      },
    ],
    materielOrders: [
      {
        payment: { status: 'paid' },
        paid_at: '2026-08-12T10:00:00.000Z',
        pickup_gym: 'portet',
        total_cents: 4500,
      },
    ],
    fromMonth: '2026-08',
    toMonth: '2026-08',
  });
  const byGym = Object.fromEntries(extras.by_gym.map((g) => [g.gym, g]));
  assert.equal(byGym.portet.orders, 2);
  assert.equal(byGym.portet.revenue, 30400);
  assert.equal(byGym.portet.inscription_orders, 1);
  assert.equal(byGym.portet.materiel_orders, 1);
  assert.equal(byGym.ramonville.inscription_revenue, 2900);
  assert.equal(byGym.minimes.orders, 0);
  assert.ok(extras.by_gym.some((g) => g.gym === 'st-cyprien' && g.orders === 0));
});

test('plus vendu fusionne la même offre sous des ids différents', () => {
  const extras = buildAdminSalesExtras({
    inscriptionOrders: [
      {
        payment: { status: 'paid', paid_at: '2026-08-01T10:00:00.000Z' },
        product_id: 'offre-duo',
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
      },
      {
        payment: { status: 'paid', paid_at: '2026-08-01T11:00:00.000Z' },
        product_id: 'dp-104',
        product_snapshot: { name: 'OFFRE A 29€', price_cents: 2999 },
      },
      {
        payment: { status: 'paid', paid_at: '2026-08-01T12:00:00.000Z' },
        product_id: 'offre-saison',
        product_snapshot: { display_name: 'OFFRE PROMO 12 MOIS', price_cents: 25900 },
      },
      {
        payment: { status: 'paid', paid_at: '2026-08-01T13:00:00.000Z' },
        product_id: 'dp-100',
        product_snapshot: { name: 'OFFRE PROMO 12 MOIS', price_cents: 25900 },
      },
    ],
    fromMonth: '2026-08',
    toMonth: '2026-08',
  });
  const byName = Object.fromEntries(extras.top_products.map((p) => [p.name, p]));
  assert.equal(byName['OFFRE A 29€'].qty, 2);
  assert.equal(byName['OFFRE PROMO 12 MOIS'].qty, 2);
  assert.equal(extras.top_products.filter((p) => /OFFRE A 29/.test(p.name)).length, 1);
  assert.equal(extras.top_products.filter((p) => /OFFRE PROMO 12/.test(p.name)).length, 1);
});

test('stats — gants Blade pris pendant l’inscription + stock', () => {
  const extras = buildAdminSalesExtras({
    inscriptionOrders: [
      {
        order_id: 'BC-BLADE-1',
        gym: 'minimes',
        payment: { status: 'paid', paid_at: '2026-09-02T10:00:00.000Z' },
        customer_short: { first_name: 'Léa', last_name: 'Martin' },
        product_snapshot: { display_name: 'OFFRE A 29€', price_cents: 2900 },
        addons: {
          blade: {
            status: 'paid',
            paid_at: '2026-09-02T10:02:00.000Z',
            name: 'Gants Blade',
            color_label: 'Noir / Blanc',
            size: '12oz',
            variant_id: 'blade-noir-blanc-12oz',
            price_cents: 1790,
            pickup_gym: 'Barrière de Paris - Minimes',
          },
        },
      },
    ],
    materielOrders: [
      {
        payment: { status: 'paid' },
        paid_at: '2026-09-02T11:00:00.000Z',
        pickup_gym: 'st-cyprien',
        total_cents: 4500,
        items: [{ product_id: 'gants-cuir', name: 'Gants cuir', qty: 1, line_total_cents: 4500 }],
      },
    ],
    fromMonth: '2026-09',
    toMonth: '2026-09',
  });
  const blade = extras.top_products.find((p) => /Blade/i.test(p.name));
  assert.ok(blade);
  assert.equal(blade.qty, 1);
  assert.equal(blade.kind, 'materiel');
  const byGym = Object.fromEntries(extras.by_gym.map((g) => [g.gym, g]));
  assert.equal(byGym.minimes.materiel_orders, 1);
  assert.equal(byGym.minimes.materiel_revenue, 1790);

  const monthly = buildMonthlySalesRows({
    inscriptionOrders: [
      {
        gym: 'minimes',
        payment: { status: 'paid', paid_at: '2026-09-02T10:00:00.000Z' },
        product_snapshot: { price_cents: 2900 },
        addons: { blade: { status: 'paid', paid_at: '2026-09-02T10:02:00.000Z', price_cents: 1790 } },
      },
    ],
    materielOrders: [],
    fromMonth: '2026-09',
    toMonth: '2026-09',
  });
  assert.equal(monthly.totals.inscription_orders, 1);
  assert.equal(monthly.totals.materiel_orders, 1);
  assert.equal(monthly.totals.materiel_revenue, 1790);

  const buyers = listInscriptionMaterielSales(
    [
      {
        order_id: 'BC-BLADE-1',
        gym: 'minimes',
        payment: { status: 'paid', paid_at: '2026-09-02T10:00:00.000Z' },
        customer_short: { first_name: 'Léa', last_name: 'Martin' },
        addons: {
          blade: {
            status: 'paid',
            paid_at: '2026-09-02T10:02:00.000Z',
            name: 'Gants Blade',
            color_label: 'Noir / Blanc',
            size: '12oz',
            price_cents: 1790,
            pickup_gym: 'Minimes',
          },
        },
      },
    ],
    { fromMonth: '2026-09', toMonth: '2026-09' }
  );
  assert.equal(buyers.length, 1);
  assert.equal(buyers[0].name, 'Léa Martin');

  const stocks = buildMaterielStockRows({
    catalogProducts: [{ id: 'mat-blade-gold', name: 'Gants de boxe Blade Noir et Blanc', stock: 22 }],
    inscriptionOrders: [
      {
        payment: { status: 'paid', paid_at: '2026-09-02T10:00:00.000Z' },
        addons: {
          blade: {
            status: 'paid',
            paid_at: '2026-09-02T10:02:00.000Z',
            name: 'Gants Blade',
            variant_id: 'blade-noir-blanc-12oz',
            price_cents: 1790,
          },
        },
      },
    ],
    materielOrders: [],
    fromMonth: '2026-09',
    toMonth: '2026-09',
  });
  const bladeStock = stocks.find((s) => /blade/i.test(s.id) || /Blade/i.test(s.name));
  assert.ok(bladeStock);
  assert.equal(bladeStock.sold_inscription, 1);
  assert.equal(bladeStock.stock, 22);
});

test('stats admin — plus vendu à la place de Stripe, ventes du jour', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'admin', 'index.html'),
    'utf8'
  );
  const js = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'public', 'js', 'admin.js'), 'utf8');
  assert.doesNotMatch(html, /Impayés abonnements CB \(Stripe\)/);
  assert.match(html, /Plus vendu/);
  assert.match(html, /Ventes par jour/);
  assert.match(html, /Ventes aujourd’hui/);
  assert.match(html, /Meilleur jour/);
  assert.match(html, /id="statsDay"/);
  assert.match(html, /Ventes du jour choisi/);
  assert.match(html, /Chiffre d’affaires par salle/);
  assert.match(html, /id="gymSalesBody"/);
  assert.match(html, /Matériel et stocks/);
  assert.match(html, /Matériel pris pendant l’inscription/);
  assert.match(html, /Fiches Deciplus manquantes/);
  assert.doesNotMatch(html, /Aventure Balma \(payées\)/);
  assert.doesNotMatch(html, /id="aventureStatsWrap"/);
  assert.match(js, /daily_sales/);
  assert.match(js, /top_products/);
  assert.match(js, /by_gym/);
  assert.match(js, /kpiTodaySales/);
  assert.match(js, /stock_rows/);
  assert.match(js, /inscription_materiel/);
});

test('API stats admin ne charge plus tout l’historique', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'server.js'),
    'utf8'
  );
  assert.match(server, /listPaidOrdersSinceAsync/);
  assert.match(server, /listMaterielOrdersCreatedSinceAsync/);
  assert.match(server, /\/api\/admin\/requeue-missing-fiches/);
  assert.match(server, /stock_rows/);
});
