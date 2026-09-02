'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.BOXPLUS_QUEUE_DIR = path.join(os.tmpdir(), `boxplus-sale-requeue-${Date.now()}`);

const {
  orderNeedsDeciplusSale,
  deciplusSaleSettled,
  aventureDossierReady,
  shouldRedispatchMissingSale,
  reconcileMissingDeciplusSales,
  recentlyAttemptedDispatch,
} = require('../storefront/lib/deciplus-sale-reconcile');
const { enqueue, markProcessed, isProcessed, STATUS } = require('../lib/queue');
const { normalizeOrder } = require('../lib/normalize');

const paid29 = {
  order_id: 'BC-ATTAF',
  aventure: true,
  source: 'balma_retour',
  step: 7,
  customer_short: { first_name: 'Julien', last_name: 'Attaf', birthdate: '1990-01-01' },
  payment: { status: 'paid', paid_at: new Date().toISOString() },
  product_id: 'dp-104',
  product_snapshot: { name: 'OFFRE A 29€', price_cents: 2900, sale_type: 'abonnement' },
  dispatched_at: new Date().toISOString(),
  deciplus_sale_id: null,
};

const paid259 = {
  order_id: 'BC-BOUSQUET',
  gym: 'ramonville',
  step: 8,
  signature: { signed_at: new Date().toISOString() },
  customer_short: { first_name: 'Lucas', last_name: 'Bousquet', birthdate: '2006-11-10' },
  payment: { status: 'paid', paid_at: new Date().toISOString() },
  product_id: 'dp-100',
  product_snapshot: { name: 'OFFRE PROMO 12 MOIS', price_cents: 25900, sale_type: 'abonnement' },
  dispatched_at: new Date().toISOString(),
  bot_status: 'manual_review',
  deciplus_member_id: '18401',
  deciplus_sale_id: null,
};

test('payé + dossier Aventure sans vente Deciplus → à rattraper', () => {
  assert.equal(aventureDossierReady({ ...paid29, dispatched_at: null }), true);
  assert.equal(orderNeedsDeciplusSale(paid29), true);
  assert.equal(deciplusSaleSettled(paid29), false);
});

test('Aventure au paiement (étape dossier) n’est pas encore dispatchable', () => {
  assert.equal(
    aventureDossierReady({
      ...paid29,
      step: 6,
      ready_for_dispatch: false,
      signature: null,
    }),
    false
  );
  assert.equal(
    orderNeedsDeciplusSale({
      ...paid29,
      step: 6,
      ready_for_dispatch: false,
      signature: null,
    }),
    false
  );
});

test('migré à la main / skip_bot / sale_id → réglé', () => {
  assert.equal(deciplusSaleSettled({ ...paid29, manual_migration: true, skip_bot: true }), true);
  assert.equal(orderNeedsDeciplusSale({ ...paid29, manual_migration: true, skip_bot: true }), false);
  assert.equal(orderNeedsDeciplusSale({ ...paid259, deciplus_sale_id: '42677', bot_status: 'success' }), false);
});

test('259 € signé, bot manual_review, pas de sale_id → à rattraper', () => {
  assert.equal(orderNeedsDeciplusSale(paid259), true);
});

test('cooldown : pas de relance dans les 10 minutes', () => {
  const now = Date.parse(paid259.dispatched_at);
  assert.equal(recentlyAttemptedDispatch(paid259, now + 60 * 1000), true);
  assert.equal(shouldRedispatchMissingSale(paid259, now + 60 * 1000), false);
  assert.equal(shouldRedispatchMissingSale(paid259, now + 11 * 60 * 1000), true);
});

test('cron relance les commandes payées sans vente', async () => {
  const dispatched = [];
  const saved = [];
  const out = await reconcileMissingDeciplusSales({
    now: Date.parse(paid259.dispatched_at) + 11 * 60 * 1000,
    listOrders: async () => [paid29, paid259, { ...paid259, order_id: 'BC-OK', deciplus_sale_id: '1' }],
    loadOrder: async (id) => [paid29, paid259].find((o) => o.order_id === id),
    saveOrder: async (order) => saved.push({ ...order }),
    dispatchOrder: async (order) => {
      dispatched.push(order.order_id);
      return { queued: true, forwarded: true };
    },
  });
  assert.equal(out.missing, 2);
  assert.deepEqual(dispatched.sort(), ['BC-ATTAF', 'BC-BOUSQUET']);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].sale_reconcile_attempts, 1);
});

test('force_requeue + force_sale_retry reprend un SUCCESS sans sale_id', () => {
  const jobId = 'PS-SUCCESS-NO-SALE';
  markProcessed(jobId, { status: STATUS.SUCCESS, action: 'sale', deciplus_sale_id: null });
  const order = normalizeOrder({
    order_id: jobId,
    product_name: 'OFFRE PROMO 12 MOIS',
    gym: 'ramonville',
    customer: { first_name: 'Lucas', last_name: 'Bousquet', email: 'lucas@test.fr', phone: '0600000000' },
    payment: { amount: 259, status: 'paid' },
    force_requeue: true,
    force_sale_retry: true,
  });
  const replay = enqueue(order);
  assert.equal(replay.queued, true);
  assert.equal(isProcessed(jobId), false);
});

test('force_requeue remplace un job already_queued bloqué (ERROR)', () => {
  const order = normalizeOrder({
    order_id: 'PS-STUCK-QUEUE',
    product_name: 'OFFRE A 29€',
    gym: 'minimes',
    customer: { first_name: 'A', last_name: 'B', email: 'a@b.fr', phone: '0600000000' },
    payment: { amount: 29, status: 'paid', iban: 'FR7630001007941234567890185' },
  });
  const first = enqueue(order);
  assert.equal(first.queued, true);
  const file = first.file;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ...JSON.parse(fs.readFileSync(file, 'utf8')),
        status: STATUS.ERROR,
        attempts: 3,
        last_error: 'timeout',
        updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      },
      null,
      2
    )
  );
  const again = enqueue({ ...order, force_requeue: true, force_sale_retry: true });
  assert.equal(again.queued, true);
});

test('force_requeue remplace un job PENDING (Aventure already_queued)', () => {
  const order = normalizeOrder({
    order_id: 'PS-AVENTURE-PENDING',
    product_name: 'OFFRE A 29€',
    gym: 'minimes',
    customer: { first_name: 'Mohamed', last_name: 'Chamlal', email: 'a@b.fr', phone: '0600000000' },
    payment: { amount: 259, status: 'paid' },
    action: 'balma_switch',
  });
  const first = enqueue(order);
  assert.equal(first.queued, true);
  const again = enqueue({ ...order, force_requeue: true, force_sale_retry: true });
  assert.equal(again.queued, true);
});

test('payé depuis plus de 2 h sans signature → à rattraper', () => {
  const { paidUnsignedReady, orderNeedsDeciplusSale } = require('../storefront/lib/deciplus-sale-reconcile');
  const paidAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const unsigned = {
    order_id: 'BC-ETHANN',
    step: 7,
    signature: null,
    customer_short: { first_name: 'Ethann', last_name: 'Vérité', birthdate: '2006-02-15' },
    customer_full: { gym: 'st-cyprien' },
    payment: { status: 'paid', paid_at: paidAt },
    product_id: 'dp-104',
    product_snapshot: { name: 'OFFRE A 29€', price_cents: 2900, sale_type: 'abonnement' },
  };
  assert.equal(paidUnsignedReady(unsigned), true);
  assert.equal(orderNeedsDeciplusSale(unsigned), true);
  assert.equal(
    orderNeedsDeciplusSale({
      ...unsigned,
      payment: { status: 'paid', paid_at: new Date().toISOString() },
    }),
    false
  );
});

test('cron boutique relance les ventes Deciplus manquantes', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'server.js'), 'utf8');
  assert.match(server, /\/api\/cron\/deciplus-sale-reconcile/);
  assert.match(server, /runDeciplusSaleReconcile/);
  assert.match(server, /force_sale_retry/);
  const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');
  assert.match(vercel, /deciplus-sale-reconcile/);
  const bot = fs.readFileSync(path.join(__dirname, '..', 'bot', 'index.js'), 'utf8');
  assert.match(bot, /maybeTriggerDeciplusSaleReconcile/);
  assert.match(bot, /deciplus-sale-reconcile/);
});

test('dispatch Aventure ne s’arrête plus sur dispatched_at', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'lib', 'aventure-dispatch.js'),
    'utf8'
  );
  assert.doesNotMatch(src, /dispatched_at \|\| order\.dispatch_result/);
  assert.match(src, /deciplusSaleSettled/);
  assert.match(src, /aventureDossierReady/);
});

test('bot Aventure remonte deciplus_sale_id et ne valide pas une vente absente', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'aventure-clone.js'), 'utf8');
  assert.match(src, /deciplus_sale_id: sale\?\.sale_id/);
  assert.match(src, /saleFailed/);
});
