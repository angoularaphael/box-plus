#!/usr/bin/env node
/**
 * Crée un abo sans engagement (+ badge), puis résilie TOUT (abo + badge).
 * Usage: node scripts/test-cancel-both.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-cancel-both-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-cancel-both-log-${runId}`);

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');

async function run(order) {
  enqueue(order);
  const job = listPending().find((j) => j.order_id === order.order_id);
  if (!job) throw new Error('job_not_queued');
  return processOneJob(job);
}

(async () => {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session manquante');
    process.exit(1);
  }

  const customer = uniqueTestCustomer('cancel-both');
  customer.gym = 'minimes';
  const saleOrderId = `LIVE-CANCELBOTH-SALE-${runId}`;

  console.log('=== 1) Création abo + badge ===');
  const sale = await run({
    order_id: saleOrderId,
    product_name: '44,99€/4 semaines Sans Engagement',
    offer: 'dp-88',
    gym: 'minimes',
    customer,
    payment: {
      amount: 44.99,
      status: 'paid',
      method: 'card',
      billing_plan: 'prelevement',
      iban: VALID_TEST_IBAN,
    },
  });
  console.log(JSON.stringify({
    ok: sale?.ok,
    status: sale?.result?.status,
    member: sale?.result?.deciplus_member_id,
    badge: sale?.result?.badge_action,
    error: sale?.error || sale?.result?.error,
  }, null, 2));

  const memberId = sale?.result?.deciplus_member_id;
  if (!memberId || sale?.result?.status !== 'success') {
    throw new Error('Création abo+badge échouée — impossible de tester la résiliation');
  }

  console.log('\n=== 2) Résiliation complète (abo + badge) ===');
  const cancel = await run({
    order_id: `LIVE-CANCELBOTH-CANCEL-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_cancel_both',
    gym: 'minimes',
    deciplus_member_id: memberId,
    customer,
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });

  console.log(JSON.stringify({
    ok: cancel?.ok,
    status: cancel?.result?.status,
    cancelled_count: cancel?.result?.cancelled_count,
    details: cancel?.result?.details,
    error: cancel?.error || cancel?.result?.error,
  }, null, 2));

  const count = Number(cancel?.result?.cancelled_count || 0);
  if (!cancel?.ok || cancel?.result?.status !== 'success' || count < 2) {
    console.error(`ÉCHEC — attendu >= 2 ventes annulées, got ${count}`);
    process.exit(1);
  }

  console.log(`\nOK — ${count} ventes résiliées (abo + badge)`);
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
})().catch(async (err) => {
  console.error(err);
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
