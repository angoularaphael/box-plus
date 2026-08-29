'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GYM_MATERIEL_MANAGERS,
  resolveManagerForPickup,
  saleWhatsAppText,
  pickupGymFromOrder,
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
