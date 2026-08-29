'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GYM_MATERIEL_MANAGERS,
  resolveManagerForPickup,
  saleWhatsAppText,
  pickupGymFromOrder,
  shouldSkipWhatsApp,
  materielSaleSummary,
  listMaterielSales,
} = require('../storefront/lib/gym-materiel-managers');

test('chaque salle de retrait a un manager et un numéro distinct', () => {
  assert.equal(GYM_MATERIEL_MANAGERS.minimes.name, 'Remus');
  assert.equal(GYM_MATERIEL_MANAGERS.minimes.phone, '0767919166');
  assert.equal(GYM_MATERIEL_MANAGERS.portet.name, 'Tapia');
  assert.equal(GYM_MATERIEL_MANAGERS.portet.phone, '0687900216');
  assert.equal(GYM_MATERIEL_MANAGERS['st-cyprien'].name, 'DaDi');
  assert.equal(GYM_MATERIEL_MANAGERS['st-cyprien'].phone, '0625745369');
  assert.equal(GYM_MATERIEL_MANAGERS.ramonville.name, 'Pascal');
  assert.equal(GYM_MATERIEL_MANAGERS.ramonville.phone, '0785907484');
  assert.equal(GYM_MATERIEL_MANAGERS['etats-unis'].name, 'Sébastien');
  assert.equal(GYM_MATERIEL_MANAGERS['etats-unis'].phone, '0760941608');

  const phones = Object.values(GYM_MATERIEL_MANAGERS).map((m) => m.phone);
  assert.equal(new Set(phones).size, phones.length, 'un numéro par manager');
});

test('la salle choisie détermine le manager — jamais un autre', () => {
  assert.equal(resolveManagerForPickup('Barrière de Paris - Minimes').name, 'Remus');
  assert.equal(resolveManagerForPickup('Minimes').name, 'Remus');
  assert.equal(resolveManagerForPickup('Portet-sur-Garonne').name, 'Tapia');
  assert.equal(resolveManagerForPickup('portet').name, 'Tapia');
  assert.equal(resolveManagerForPickup('Toulouse St-Cyprien').name, 'DaDi');
  assert.equal(resolveManagerForPickup('Ramonville').name, 'Pascal');
  assert.equal(resolveManagerForPickup('États-Unis').name, 'Sébastien');
  assert.equal(resolveManagerForPickup('etats-unis').name, 'Sébastien');
});

test('Pascal ne reçoit pas Minimes ; DaDi ne reçoit pas Ramonville', () => {
  assert.notEqual(resolveManagerForPickup('Minimes').name, 'Pascal');
  assert.notEqual(resolveManagerForPickup('Minimes').name, 'DaDi');
  assert.notEqual(resolveManagerForPickup('Ramonville').name, 'DaDi');
  assert.notEqual(resolveManagerForPickup('Ramonville').name, 'Remus');
  assert.notEqual(resolveManagerForPickup('Portet-sur-Garonne').name, 'Remus');
  assert.notEqual(resolveManagerForPickup('États-Unis').name, 'Pascal');
});

test('message vente : nom, prénom, tél, produit, salle choisie', () => {
  const order = {
    order_id: 'MAT-1',
    order_type: 'materiel',
    pickup_gym: 'Portet-sur-Garonne',
    customer: { first_name: 'Léa', last_name: 'Martin', phone: '0611223344' },
    items: [
      {
        product_id: 'mat-bandes-4m',
        name: 'Bandes 4m Rouge / Blanc / Bleu',
        variant_label: 'Rouge / Blanc / Bleu',
        qty: 1,
        unit_cents: 690,
        line_total_cents: 690,
      },
    ],
  };
  const text = saleWhatsAppText(order, 'materiel');
  assert.match(text, /Léa/);
  assert.match(text, /Martin/);
  assert.match(text, /0611223344/);
  assert.match(text, /Bandes 4m/);
  assert.match(text, /Portet/);
  assert.match(text, /sous 48h/);
  assert.equal(resolveManagerForPickup(order.pickup_gym).name, 'Tapia');
});

test('The SHELL à Ramonville → Pascal ; à États-Unis → Sébastien', () => {
  const base = {
    order_id: 'MAT-shell',
    order_type: 'materiel',
    customer: { first_name: 'Yan', last_name: 'K', phone: '0699999999' },
    items: [{ product_id: 'mat-shell-mma', name: 'Gants MMA The SHELL', variant_label: 'M', qty: 1, unit_cents: 1990 }],
  };
  const ramonville = saleWhatsAppText({ ...base, pickup_gym: 'Ramonville' }, 'materiel');
  const etats = saleWhatsAppText({ ...base, pickup_gym: 'États-Unis' }, 'materiel');
  assert.match(ramonville, /Ramonville/);
  assert.match(etats, /États-Unis/);
  assert.equal(resolveManagerForPickup('Ramonville').phone, '0785907484');
  assert.equal(resolveManagerForPickup('États-Unis').phone, '0760941608');
});

test('upsell Blade → toujours Remus / Minimes, pas la salle d’inscription', () => {
  const order = {
    order_id: 'BC-abo',
    gym: 'portet',
    customer_full: { first_name: 'Paul', last_name: 'Durand', phone: '0600000000', gym: 'portet' },
    addons: {
      blade: {
        status: 'paid',
        name: 'Gants de boxe Blade Noir et Blanc',
        color_label: 'Noir / Blanc',
        size: '12oz',
        price_cents: 1790,
        pickup_gym: 'Barrière de Paris - Minimes',
      },
    },
  };
  assert.equal(pickupGymFromOrder(order, 'upsell'), 'Barrière de Paris - Minimes');
  assert.equal(resolveManagerForPickup(pickupGymFromOrder(order, 'upsell')).name, 'Remus');
  const text = saleWhatsAppText(order, 'upsell');
  assert.match(text, /Blade/);
  assert.match(text, /Minimes/);
  assert.doesNotMatch(text, /Portet/);
  assert.match(text, /jour même/);
});

test('live (production) envoie bien au manager — la démo seule est ignorée', () => {
  assert.equal(shouldSkipWhatsApp({ payment: { method: 'payplug' } }, { NODE_ENV: 'production' }), false);
  assert.equal(shouldSkipWhatsApp({ payment: { method: 'payplug' } }, { NODE_ENV: 'test' }), true);
  assert.equal(shouldSkipWhatsApp({ payment: { method: 'demo' } }, { NODE_ENV: 'production' }), true);
  assert.equal(
    shouldSkipWhatsApp(
      { addons: { blade: { method: 'paypal' } } },
      { NODE_ENV: 'production', STORE_DEMO_ENABLED: 'true' }
    ),
    false
  );
});

test('récap vente : manager de la salle choisie + statut WhatsApp', () => {
  const order = {
    order_id: 'MAT-live',
    order_type: 'materiel',
    created_at: '2026-08-29T15:00:00.000Z',
    paid_at: '2026-08-29T15:01:00.000Z',
    payment: { status: 'paid', method: 'payplug' },
    total_cents: 1370,
    pickup_gym: 'Portet-sur-Garonne',
    customer: { first_name: 'Brad', last_name: 'Mbosseu', phone: '0600000000' },
    items: [{ name: 'Gants', variant_label: '12oz', qty: 1, line_total_cents: 1370 }],
    manager_notify: { sent: true, manager: 'Tapia', gym: 'portet' },
  };
  const row = materielSaleSummary(order, 'materiel');
  assert.equal(row.manager_name, 'Tapia');
  assert.equal(row.pickup_label, 'Portet-sur-Garonne');
  assert.equal(row.total_cents, 1370);
  assert.equal(row.manager_notify.sent, true);
  const listed = listMaterielSales([order], []);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].order_id, 'MAT-live');
});

test('les brouillons impayés n’apparaissent pas dans les ventes', () => {
  const unpaid = {
    order_id: 'MAT-draft',
    order_type: 'materiel',
    created_at: '2026-08-29T15:00:00.000Z',
    payment: { status: 'pending' },
    total_cents: 2500,
    customer: { first_name: 'Test', last_name: 'Impayé' },
    items: [{ name: 'Gants', qty: 1, line_total_cents: 2500 }],
  };
  const paid = {
    order_id: 'MAT-paid',
    payment: { status: 'paid' },
    paid_at: '2026-08-29T15:01:00.000Z',
    total_cents: 1370,
    customer: { first_name: 'Brad' },
    items: [{ name: 'Gants Blade', variant_label: '12oz', qty: 1, line_total_cents: 1370 }],
  };
  const listed = listMaterielSales([unpaid, paid], []);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].order_id, 'MAT-paid');
  const all = listMaterielSales([unpaid, paid], [], { paidOnly: false });
  assert.equal(all.length, 2);
});

test('le produit s’affiche même sans order_type (payload slim)', () => {
  const row = materielSaleSummary(
    {
      order_id: 'MAT-slim',
      payment: { status: 'paid' },
      total_cents: 690,
      customer: { first_name: 'Léa', pickup_gym: 'Portet-sur-Garonne' },
      items: [{ name: 'Bandes 4m', variant_label: 'Rouge', qty: 1, line_total_cents: 690 }],
    },
    'materiel'
  );
  assert.match(row.product, /Bandes 4m/);
  assert.equal(row.manager_name, 'Tapia');
});
