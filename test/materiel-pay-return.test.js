'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.STORE_DEMO_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.PAYPLUG_SECRET_KEY = '';
process.env.PAYPLUG_TEST_SECRET_KEY = '';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-mat-ret-insc-${Date.now()}`);
process.env.BOXPLUS_MATERIEL_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-mat-ret-${Date.now()}`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';
const emptyTestEnv = path.join(os.tmpdir(), `boxplus-mat-ret-env-${Date.now()}`);
fs.writeFileSync(emptyTestEnv, '');
process.env.BOXPLUS_TEST_ENV_FILE = emptyTestEnv;
require('../storefront/lib/test-env').resetTestFileCache();

const {
  shouldRedirectToInscription,
  isMaterielReturn,
} = require('../storefront/public/js/boot.js');
const { createMaterielOrderAsync, saveOrderAsync } = require('../storefront/lib/materiel-cart');
const { createApp } = require('../storefront/server');

function qs(obj) {
  return new URLSearchParams(obj);
}

test('retour PayPlug matériel : ne pas envoyer vers /inscription', () => {
  const materielQs = qs({
    order: 'MAT-1788000000000-abc123',
    type: 'materiel',
    payplug_return: '1',
    token: 'a'.repeat(48),
  });
  assert.equal(isMaterielReturn('/success.html', materielQs), true);
  assert.equal(shouldRedirectToInscription('/success.html', materielQs), false);
  assert.equal(shouldRedirectToInscription('/', materielQs), false);
  assert.equal(shouldRedirectToInscription('/inscription', materielQs), false);
});

test('retour Stripe abo : success.html avec product+order va vers /inscription', () => {
  const aboQs = qs({
    session_id: 'cs_test_123456',
    order: 'BC-1788000000000-abc123',
    product: 'offre-29',
  });
  assert.equal(isMaterielReturn('/success.html', aboQs), false);
  assert.equal(shouldRedirectToInscription('/success.html', aboQs), true);
});

test('lien reprise inscription : order+token hors tunnel → /inscription', () => {
  const resume = qs({
    order: 'BC-1788000000000-abc123',
    token: 'b'.repeat(48),
  });
  assert.equal(shouldRedirectToInscription('/', resume), true);
  assert.equal(shouldRedirectToInscription('/inscription', resume), false);
  assert.equal(shouldRedirectToInscription('/faq', resume), true);
});

test('confirm-payplug d’une commande MAT ne répond plus forbidden', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const order = await createMaterielOrderAsync({
    customer: {
      first_name: 'Brad',
      last_name: 'Test',
      email: 'brad.mat-return@example.com',
      phone: '0612345678',
      pickup_gym: 'Barrière de Paris - Minimes',
    },
    items: [
      {
        product_id: 'mat-blade-gold',
        variant_id: 'blade-12oz-noir',
        name: 'Gants Blade',
        qty: 1,
        unit_cents: 1790,
        line_total_cents: 1790,
      },
    ],
    total_cents: 1790,
    pickup_gym: 'Barrière de Paris - Minimes',
  });
  order.payment = {
    status: 'pending',
    method: 'payplug',
    payplug_payment_id: 'pay_testmateriel123',
  };
  await saveOrderAsync(order);

  const res = await fetch(`${base}/api/checkout/confirm-payplug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id: order.order_id,
      token: order.access_token,
      payment_id: 'pay_testmateriel123',
    }),
  });
  const data = await res.json().catch(() => ({}));
  assert.notEqual(res.status, 403, JSON.stringify(data));
  assert.notEqual(data.error, 'forbidden');
  assert.ok([400, 402, 202, 503].includes(res.status), `status ${res.status} ${JSON.stringify(data)}`);
});
