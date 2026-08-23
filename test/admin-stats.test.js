'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildAdminSalesExtras,
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
        total_cents: 2899,
        items: [{ product_id: 'gants', name: 'Gants', qty: 2, line_total_cents: 2899 }],
      },
    ],
  });

  assert.equal(extras.today.count, 3);
  assert.equal(extras.aventure.paid, 1);
  assert.equal(extras.aventure.missing_sale, 1);
  assert.equal(extras.top_products[0].name, 'Gants');
  assert.equal(extras.top_products[0].qty, 2);
  const todayBar = extras.daily_sales.find((d) => d.day === today);
  assert.equal(todayBar.total, 3);
  assert.equal(todayBar.inscriptions, 2);
  assert.equal(todayBar.materiel, 1);
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
  assert.match(js, /daily_sales/);
  assert.match(js, /top_products/);
  assert.match(js, /kpiTodaySales/);
});
