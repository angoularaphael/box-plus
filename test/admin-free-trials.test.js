'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  isFreeTrialOrder,
  buildFreeTrialRows,
} = require('../storefront/lib/admin-free-trials');

function trial(overrides = {}) {
  return {
    order_id: 'SO-1',
    product_id: 'seance-essai-offerte',
    product_name: 'SEANCE D ESSAI GRATUITE WEB',
    source: 'seance-offerte-web',
    created_at: '2026-09-01T10:00:00.000Z',
    customer: {
      first_name: 'Camille',
      last_name: 'Durand',
      email: 'camille@example.com',
      phone: '0612345678',
    },
    gym: 'minimes',
    payment: { amount: 0, status: 'paid' },
    ...overrides,
  };
}

test('classe les séances gratuites sans dépendre des accents ou d’un seul libellé', () => {
  assert.equal(isFreeTrialOrder(trial()), true);
  assert.equal(
    isFreeTrialOrder(
      trial({
        product_id: null,
        source: null,
        product_name: 'Séance offerte',
        product_snapshot: { price_cents: 0 },
        payment: { status: 'free' },
      })
    ),
    true
  );
  assert.equal(
    isFreeTrialOrder(
      trial({
        product_id: null,
        source: null,
        product_name: 'Séance gratuite web',
        payment: { amount_cents: 0, status: 'free' },
      })
    ),
    true
  );
});

test('exclut essai 10 €, coaching, commande test et produit gratuit sans essai', () => {
  assert.equal(
    isFreeTrialOrder(
      trial({
        product_id: 'seance-essai',
        product_name: "Séance d'essai 10 €",
        source: 'storefront-payplug',
        product_snapshot: { price_cents: 1000 },
        payment: { amount: 10, status: 'paid' },
      })
    ),
    false
  );
  assert.equal(isFreeTrialOrder(trial({ action: 'coaching_booking' })), false);
  assert.equal(isFreeTrialOrder(trial({ order_id: 'TEST-SO-1' })), false);
  assert.equal(
    isFreeTrialOrder(
      trial({ product_id: 'promo', product_name: 'Produit gratuit', source: 'promo-web' })
    ),
    false
  );
});

test('présente toutes les séances retenues de la plus récente à la plus ancienne', () => {
  const rows = buildFreeTrialRows([
    trial({ order_id: 'SO-OLD', created_at: '2026-08-01T10:00:00.000Z' }),
    trial({ order_id: 'SO-NEW', created_at: '2026-09-03T10:00:00.000Z' }),
    trial({
      order_id: 'SO-PAID',
      created_at: '2026-09-04T10:00:00.000Z',
      payment: { amount: 10, status: 'paid' },
    }),
  ]);
  assert.deepEqual(rows.map((row) => row.order_id), ['SO-NEW', 'SO-OLD']);
  assert.equal(rows[0].email, 'camille@example.com');
  assert.equal(rows[0].phone, '0612345678');
});

test('backoffice expose un onglet dédié et une API authentifiée paginée', () => {
  const root = path.join(__dirname, '..', 'storefront');
  const html = fs.readFileSync(path.join(root, 'public', 'admin', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const persistence = fs.readFileSync(path.join(root, 'lib', 'order-persistence.js'), 'utf8');

  assert.match(html, /data-tab="freeTrials">Séances d’essai gratuites/);
  assert.match(html, /id="freeTrialsBody"/);
  assert.match(html, /id="freeTrialsPager"/);
  assert.match(js, /\/api\/admin\/free-trials\?page=/);
  assert.match(server, /app\.get\('\/api\/admin\/free-trials'/);
  assert.match(server, /isAuthorizedAdmin\(req\)/);
  assert.match(persistence, /listFreeTrialCandidatesPage/);
  assert.match(persistence, /\.range\(from, from \+ safePageSize - 1\)/);
});
