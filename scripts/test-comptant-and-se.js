#!/usr/bin/env node
/**
 * Test live Deciplus : 3 offres comptant + 1 sans engagement (jusqu'au badge).
 * Usage: node scripts/test-comptant-and-se.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-live-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-live-log-${runId}`);

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');

const OFFERS = [
  {
    key: 'comptant-12',
    product_name: 'COMPTANT 12 MOIS',
    offer: 'dp-22',
    product_reference: '000022',
    amount: 400,
    requires_iban: false,
    billing_plan: 'comptant',
  },
  {
    key: 'comptant-6',
    product_name: 'COMPTANT 6 MOIS',
    offer: 'dp-91',
    amount: 250,
    requires_iban: false,
    billing_plan: 'comptant',
  },
  {
    key: 'comptant-3',
    product_name: 'COMPTANT 3 MOIS',
    offer: 'dp-92',
    amount: 150,
    requires_iban: false,
    billing_plan: 'comptant',
  },
  {
    key: 'sans-engagement',
    product_name: '44,99€/4 semaines Sans Engagement',
    offer: 'dp-88',
    amount: 44.99,
    requires_iban: true,
    billing_plan: 'prelevement',
  },
];

function buildOrder(offer, idx) {
  const customer = uniqueTestCustomer(`live-${offer.key}`);
  customer.gym = 'minimes';
  const orderId = `LIVE-${offer.key}-${runId}-${idx}`;
  return {
    order_id: orderId,
    product_name: offer.product_name,
    offer: offer.offer,
    product_reference: offer.product_reference || null,
    gym: 'minimes',
    customer,
    payment: {
      amount: offer.amount,
      status: 'paid',
      method: 'card',
      billing_plan: offer.billing_plan,
      ...(offer.requires_iban ? { iban: VALID_TEST_IBAN } : {}),
    },
  };
}

(async () => {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session Deciplus manquante:', session);
    console.error('Lance d’abord: npm run session:export');
    process.exit(1);
  }

  console.log('Queue:', process.env.BOXPLUS_QUEUE_DIR);
  console.log(`=== Live test ${OFFERS.length} offres (session locale) ===\n`);

  const results = [];

  for (let i = 0; i < OFFERS.length; i += 1) {
    const offer = OFFERS[i];
    const order = buildOrder(offer, i);
    console.log(`\n--- ${offer.key} · ${offer.product_name} ---`);
    console.log('order_id:', order.order_id);
    console.log('email:', order.customer.email);

    enqueue(order);
    const job = listPending().find((j) => j.order_id === order.order_id);
    if (!job) {
      results.push({ key: offer.key, ok: false, error: 'job_not_queued' });
      continue;
    }

    try {
      const outcome = await processOneJob(job);
      const ok = Boolean(outcome?.ok && outcome?.result?.status === 'success');
      results.push({
        key: offer.key,
        ok,
        status: outcome?.result?.status || null,
        member_id: outcome?.result?.deciplus_member_id || null,
        sale_id: outcome?.result?.deciplus_sale_id || null,
        badge: outcome?.result?.badge_action || null,
        error: outcome?.error || outcome?.result?.error || null,
      });
      console.log(JSON.stringify(results[results.length - 1], null, 2));
    } catch (err) {
      results.push({ key: offer.key, ok: false, error: err.message });
      console.error(err.message);
    }
  }

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  console.log('\n=== RÉSUMÉ ===');
  for (const r of results) {
    console.log(`${r.ok ? 'OK' : 'FAIL'}  ${r.key}${r.member_id ? ` · membre ${r.member_id}` : ''}${r.error ? ` · ${r.error}` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
