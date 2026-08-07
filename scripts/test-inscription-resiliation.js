#!/usr/bin/env node
/**
 * Test E2E : inscription (abo sans engagement + badge) puis résiliation par identité.
 * Usage: node scripts/test-inscription-resiliation.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-inscr-resil-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-inscr-resil-log-${runId}`);

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');

async function runJob(order) {
  enqueue(order);
  const job = listPending().find((j) => j.order_id === order.order_id);
  if (!job) throw new Error('job_not_queued');
  return processOneJob(job);
}

(async () => {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session Deciplus manquante — lance: npm run session:export');
    process.exit(1);
  }

  const customer = uniqueTestCustomer('inscr-resil');
  customer.gym = 'minimes';

  console.log('=== ÉTAPE 1 — INSCRIPTION (44,99€ sans engagement + badge) ===');
  console.log('Client:', {
    name: `${customer.first_name} ${customer.last_name}`,
    email: customer.email,
    phone: customer.phone,
    gym: customer.gym,
  });

  const saleOrderId = `INSCR-${runId}`;
  const sale = await runJob({
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

  const saleSummary = {
    ok: sale?.ok,
    status: sale?.result?.status,
    member_id: sale?.result?.deciplus_member_id,
    badge: sale?.result?.badge_action,
    error: sale?.error || sale?.result?.error,
  };
  console.log(JSON.stringify(saleSummary, null, 2));

  if (!sale?.ok || sale?.result?.status !== 'success' || !sale?.result?.deciplus_member_id) {
    throw new Error('Inscription échouée');
  }

  const memberId = sale.result.deciplus_member_id;

  console.log('\n=== ÉTAPE 2 — RÉSILIATION (identité web, sans member_id forcé) ===');
  const cancel = await runJob({
    order_id: `RESIL-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_inscription_resiliation',
    gym: 'minimes',
    // Pas de deciplus_member_id → comme le formulaire David
    first_name: customer.first_name,
    last_name: customer.last_name,
    birthdate: customer.birthdate,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    postal_code: customer.postal_code,
    city: customer.city,
    customer,
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });

  const cancelSummary = {
    ok: cancel?.ok,
    status: cancel?.result?.status,
    member_id: cancel?.result?.deciplus_member_id,
    cancelled_count: cancel?.result?.cancelled_count,
    details: cancel?.result?.details,
    mismatch: cancel?.result?.mismatch,
    error: cancel?.error || cancel?.result?.error,
  };
  console.log(JSON.stringify(cancelSummary, null, 2));

  const count = Number(cancel?.result?.cancelled_count || 0);
  const ok =
    cancel?.ok &&
    cancel?.result?.status === 'success' &&
    count >= 2 &&
    String(cancel?.result?.deciplus_member_id || '') === String(memberId);

  if (!ok) {
    console.error('\nÉCHEC');
    console.error(`Attendu: success, member ${memberId}, >= 2 ventes annulées`);
    console.error(`Obtenu: status=${cancel?.result?.status}, count=${count}, member=${cancel?.result?.deciplus_member_id}`);
    process.exit(1);
  }

  console.log(`\n✅ OK — Inscription membre ${memberId} puis résiliation ${count} contrats (abo + badge)`);
  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
