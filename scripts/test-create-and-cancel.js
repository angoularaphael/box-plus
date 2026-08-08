#!/usr/bin/env node
/**
 * 1) Crée un client COMPTANT
 * 2) Crée un client à échéances (sans engagement + badge)
 * 3) Résilie les deux via le flux « Résilier » (pas Annuler la vente)
 *
 * Usage: node scripts/test-create-and-cancel.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-create-cancel-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-create-cancel-log-${runId}`);

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

function summarize(label, result) {
  const out = {
    label,
    ok: result?.ok,
    status: result?.result?.status,
    member: result?.result?.deciplus_member_id,
    cancelled_count: result?.result?.cancelled_count,
    badge: result?.result?.badge_action,
    details: result?.result?.details,
    error: result?.error || result?.result?.error,
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

(async () => {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session manquante — génère-la d’abord (npm run session:export)');
    process.exit(1);
  }

  const results = [];

  console.log('=== 1) Client COMPTANT 3 MOIS ===');
  const cCust = uniqueTestCustomer('cancel-comptant');
  cCust.gym = 'minimes';
  const comptant = await run({
    order_id: `LIVE-CC-COMPTANT-${runId}`,
    product_name: 'COMPTANT 3 MOIS',
    offer: 'dp-92',
    gym: 'minimes',
    customer: cCust,
    payment: {
      amount: 150,
      status: 'paid',
      method: 'card',
      billing_plan: 'comptant',
    },
    paiement_comptant: true,
  });
  const cSum = summarize('comptant', comptant);
  results.push(cSum);
  if (!cSum.member || cSum.status !== 'success') {
    throw new Error('Création comptant échouée');
  }

  console.log('\n=== 2) Client ÉCHÉANCES (sans engagement + badge) ===');
  const eCust = uniqueTestCustomer('cancel-echeance');
  eCust.gym = 'minimes';
  const echeance = await run({
    order_id: `LIVE-CC-ECHEANCE-${runId}`,
    product_name: '44,99€/4 semaines Sans Engagement',
    offer: 'dp-88',
    gym: 'minimes',
    customer: eCust,
    payment: {
      amount: 44.99,
      status: 'paid',
      method: 'card',
      billing_plan: 'prelevement',
      iban: VALID_TEST_IBAN,
    },
  });
  const eSum = summarize('echeance', echeance);
  results.push(eSum);
  if (!eSum.member || eSum.status !== 'success') {
    throw new Error('Création échéances échouée');
  }

  console.log(`\n=== 3) Résiliation COMPTANT (membre ${cSum.member}) ===`);
  const cancelC = await run({
    order_id: `LIVE-CC-CANCEL-C-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_create_and_cancel_comptant',
    cancel_date: new Date().toISOString().slice(0, 10),
    gym: 'minimes',
    deciplus_member_id: cSum.member,
    customer: cCust,
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  results.push(summarize('cancel_comptant', cancelC));

  console.log(`\n=== 4) Résiliation ÉCHÉANCES (membre ${eSum.member}) ===`);
  const cancelE = await run({
    order_id: `LIVE-CC-CANCEL-E-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_create_and_cancel_echeance',
    cancel_date: new Date().toISOString().slice(0, 10),
    gym: 'minimes',
    deciplus_member_id: eSum.member,
    customer: eCust,
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  results.push(summarize('cancel_echeance', cancelE));

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  const cancelOk =
    cancelC?.ok &&
    cancelC?.result?.status !== 'error' &&
    (cancelC?.result?.cancelled_count || 0) > 0 &&
    cancelE?.ok &&
    cancelE?.result?.status !== 'error' &&
    (cancelE?.result?.cancelled_count || 0) > 0;

  console.log('\n=== RÉSUMÉ ===');
  console.log(
    JSON.stringify(
      {
        comptant_member: cSum.member,
        echeance_member: eSum.member,
        cancel_comptant_count: cancelC?.result?.cancelled_count,
        cancel_echeance_count: cancelE?.result?.cancelled_count,
        cancel_ok: cancelOk,
      },
      null,
      2
    )
  );

  if (!cancelOk) process.exit(1);
  console.log('\nOK — création + résiliation des 2 clients');
})().catch(async (err) => {
  console.error(err);
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
