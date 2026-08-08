#!/usr/bin/env node
/**
 * Test live du flux Résilier (pas Annuler la vente).
 * Usage:
 *   node scripts/test-cancel-resilier-flow.js [memberId]
 *   node scripts/test-cancel-resilier-flow.js --create
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-resilier-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-resilier-log-${runId}`);

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
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const create = args.includes('--create');
  const memberArg = args.find((a) => !a.startsWith('--'));
  let memberId = memberArg || process.env.CANCEL_TEST_MEMBER_ID || null;

  if (!memberId && create) {
    console.log('=== Création abo sans engagement (+ badge) pour test résiliation ===');
    const customer = uniqueTestCustomer('resilier');
    customer.gym = 'minimes';
    const sale = await run({
      order_id: `LIVE-RESILIER-SALE-${runId}`,
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
    console.log(
      JSON.stringify(
        {
          ok: sale?.ok,
          status: sale?.result?.status,
          member: sale?.result?.deciplus_member_id,
          badge: sale?.result?.badge_action,
          error: sale?.error || sale?.result?.error,
        },
        null,
        2
      )
    );
    memberId = sale?.result?.deciplus_member_id;
    if (!memberId || sale?.result?.status !== 'success') {
      throw new Error('Création membre échouée');
    }
  }

  if (!memberId) {
    console.error('Usage: node scripts/test-cancel-resilier-flow.js <memberId>');
    console.error('   ou: node scripts/test-cancel-resilier-flow.js --create');
    process.exit(1);
  }

  console.log(`\n=== Résiliation Résilier (membre ${memberId}) ===`);
  const cancel = await run({
    order_id: `LIVE-RESILIER-CANCEL-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_resilier_flow',
    cancel_date: new Date().toISOString().slice(0, 10),
    gym: 'minimes',
    deciplus_member_id: memberId,
    customer: {
      first_name: 'Test',
      last_name: 'Resilier',
      birthdate: '1990-01-01',
      phone: '0600000000',
      email: 'live-resilier@boxplus-test.local',
    },
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });

  console.log(
    JSON.stringify(
      {
        ok: cancel?.ok,
        status: cancel?.result?.status,
        cancelled_count: cancel?.result?.cancelled_count,
        details: cancel?.result?.details,
        error: cancel?.error || cancel?.result?.error,
      },
      null,
      2
    )
  );

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  if (!cancel?.ok || cancel?.result?.status === 'error') {
    process.exit(1);
  }
  console.log('\nOK — flux Résilier validé');
})().catch(async (err) => {
  console.error(err);
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
