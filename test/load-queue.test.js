#!/usr/bin/env node
/**
 * Test de charge — enqueue N commandes fictives et vérifie idempotence.
 * Usage: node test/load-queue.test.js
 */
require('dotenv').config();

const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.BOXPLUS_QUEUE_DIR = path.join(os.tmpdir(), `boxplus-load-test-${Date.now()}`);

const { enqueue, getQueueStats, markProcessed, isProcessed, STATUS } = require('../lib/queue');
const { normalizeOrder } = require('../lib/normalize');

const COUNT = Number(process.env.LOAD_TEST_COUNT || 20);

function makeOrder(i) {
  const products = ['OFFRE A 29€', 'OFFRE PROMO 12 MOIS', 'Séance essai'];
  const productName = products[i % 3];
  const amount = productName.includes('essai') ? 0 : 29;
  return normalizeOrder({
    order_id: `PS-LOAD-${i}`,
    product_name: productName,
    gym: ['minimes', 'ramonville', 'st-cyprien', 'portet', 'etats-unis'][i % 5],
    customer: {
      first_name: 'Load',
      last_name: `Test${i}`,
      email: `load.test+${i}@boxingcenter.fr`,
      phone: `060000${String(i).padStart(4, '0')}`,
    },
    payment: {
      amount,
      status: 'paid',
      method: 'card',
      iban: amount > 0 ? 'FR7630001007941234567890185' : null,
    },
  });
}

let enqueued = 0;
for (let i = 0; i < COUNT; i += 1) {
  const r = enqueue(makeOrder(i));
  if (r.queued) enqueued += 1;
}

const stats = getQueueStats();
assert.ok(stats.pending_jobs >= enqueued, 'des jobs doivent être en file');

const dup = enqueue(makeOrder(0));
assert.equal(dup.queued, false);

markProcessed('PS-LOAD-0', { status: STATUS.SUCCESS });
assert.equal(isProcessed('PS-LOAD-0'), true);

const dup2 = enqueue(makeOrder(0));
assert.equal(dup2.reason, 'already_processed');

console.log(`✅ Load test OK — ${enqueued}/${COUNT} enqueued, stats:`, stats.counts);
