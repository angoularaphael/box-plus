#!/usr/bin/env node
/**
 * Test résiliation Deciplus :
 * 1) mismatch → email + manual_review
 * 2) match exact (membre de test) → cancel OK
 *
 * Usage: node scripts/test-cancel-resiliation.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-cancel-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-cancel-log-${runId}`);

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { guideRetention } = require('../storefront/lib/counselor-ai');

async function runJob(order) {
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

  console.log('=== Test counsel IA ===');
  const ai = await guideRetention({
    reasonId: 'money',
    reasonLabel: 'Raison financière',
    freeText: 'C’est trop cher pour moi en ce moment',
  });
  console.log('AI source:', ai.source);
  console.log('AI reply:', (ai.reply || '').slice(0, 220));

  console.log('\n=== Test mismatch identité ===');
  const mismatchOrder = {
    order_id: `CANCEL-MISMATCH-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_mismatch',
    gym: 'minimes',
    customer: {
      first_name: 'Faux',
      last_name: `Nom${String(runId).slice(-4)}`,
      birthdate: '1990-01-01',
      phone: '0699998877',
      email: process.env.CANCEL_TEST_EMAIL || 'angoularaphael05@gmail.com',
      address: '99 rue Inventee',
      postal_code: '31000',
      city: 'Toulouse',
    },
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
  const mismatch = await runJob(mismatchOrder);
  console.log(JSON.stringify({
    ok: mismatch?.ok,
    status: mismatch?.result?.status,
    mismatch: mismatch?.result?.mismatch,
    error: mismatch?.result?.error || mismatch?.error,
  }, null, 2));

  // Membre créé au test live précédent (sans engagement) — 21079 / Test Box4323
  const memberId = process.env.CANCEL_TEST_MEMBER_ID || '21079';
  console.log(`\n=== Test résiliation match (membre ${memberId}) ===`);
  const matchOrder = {
    order_id: `CANCEL-OK-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_ok',
    gym: 'minimes',
    deciplus_member_id: memberId,
    customer: {
      first_name: 'Test',
      last_name: 'Box4323',
      birthdate: '1990-01-01',
      phone: process.env.CANCEL_TEST_PHONE || '0643236989',
      email: 'live-sans-engagement-43236989@boxplus-test.local',
      address: '1 rue Test Automatique',
      postal_code: '31000',
      city: 'Toulouse',
    },
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };

  // Si on force member_id, le bot skip l'identity match — on teste aussi le match sans ID
  const matchByIdentity = {
    ...matchOrder,
    order_id: `CANCEL-ID-${runId}`,
    deciplus_member_id: null,
  };

  let identityResult;
  try {
    identityResult = await runJob(matchByIdentity);
    console.log('identity cancel:', JSON.stringify({
      ok: identityResult?.ok,
      status: identityResult?.result?.status,
      member: identityResult?.result?.deciplus_member_id,
      error: identityResult?.result?.error || identityResult?.error,
    }, null, 2));
  } catch (err) {
    console.error('identity cancel failed', err.message);
  }

  // Si identity a échoué (tél différent), tenter avec member_id forcé
  if (!identityResult?.ok || identityResult?.result?.status !== 'success') {
    console.log('\n=== Repli résiliation par member_id ===');
    const byId = await runJob(matchOrder);
    console.log(JSON.stringify({
      ok: byId?.ok,
      status: byId?.result?.status,
      member: byId?.result?.deciplus_member_id,
      error: byId?.result?.error || byId?.error,
    }, null, 2));
  }

  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }

  console.log('\nDone.');
})().catch(async (err) => {
  console.error(err);
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
