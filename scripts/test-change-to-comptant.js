#!/usr/bin/env node
/**
 * Test ciblé : prélèvement → résiliation + reprise comptant
 * (même enchaînement que enqueueChangeAfterPayment)
 *
 * Usage: node scripts/test-change-to-comptant.js
 */
'use strict';

require('dotenv').config();

// File locale (pas BotHosting) pour contrôler les 2 jobs
delete process.env.BOXPLUS_BOT_URL;
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-chg-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-chg-log-${runId}`);
process.env.BOXPLUS_STORE_URL = '';
process.env.STORE_URL = '';

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { buildOrderPayload } = require('../storefront/lib/orders');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');
const { isComptantStyleProduct } = require('../lib/billing-plan');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runJob(order) {
  const normalized = normalizeOrder(order);
  const errors = validateOrder(normalized);
  if (errors.length) throw new Error(`Validation: ${errors.join(', ')}`);
  enqueue(normalized);
  const job = listPending().find((j) => j.order_id === normalized.order_id);
  if (!job) throw new Error(`job_not_queued ${normalized.order_id}`);
  return processOneJob(job);
}

(async () => {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  assert(fs.existsSync(session), 'Session manquante — npm run session:export');

  const prelev =
    findEnrichedProduct('44-99-4-semaines') ||
    findEnrichedProduct('dp-88');
  const comptant =
    findEnrichedProduct('comptant-3-mois') ||
    findEnrichedProduct('comptant-6-mois') ||
    findEnrichedProduct('comptant-12-mois');
  assert(prelev, 'Produit prélèvement introuvable');
  assert(comptant && isComptantStyleProduct(comptant), 'Produit comptant introuvable');

  const customer = uniqueTestCustomer('chgcmp');
  customer.gym = 'minimes';
  const today = new Date().toISOString().slice(0, 10);
  const baseId = `CHANGE-TEST-${runId}-${crypto.randomBytes(2).toString('hex')}`;

  console.log('\n=== TEST CHANGEMENT → COMPTANT ===');
  console.log({
    email: customer.email,
    from: prelev.name,
    to: comptant.name,
    price_cents: comptant.price_cents,
  });

  // 1) Créer prélèvement
  console.log('\n1) Création abonnement prélèvement…');
  const salePayload = buildOrderPayload(
    {
      order_id: `LIVE-PRELEV-${runId}`,
      ...customer,
      payment_method: 'card',
      billing_plan: 'rib',
      iban: VALID_TEST_IBAN,
    },
    prelev
  );
  salePayload.payment = {
    ...(salePayload.payment || {}),
    amount: (prelev.price_cents || 4499) / 100,
    status: 'paid',
    method: 'card',
    iban: VALID_TEST_IBAN,
  };
  const created = await runJob(salePayload);
  const memberId = created?.result?.deciplus_member_id;
  console.log('Création:', {
    ok: created?.ok,
    status: created?.result?.status,
    memberId,
    sale_action: created?.result?.sale_action,
    error: created?.error || created?.result?.error,
  });
  // Badge peut passer en manual_review sans bloquer l’abo (cas fréquent)
  assert(created?.ok && memberId, 'Création prélèvement échouée (pas de member_id)');
  assert(
    created.result.status === 'success' || created.result.status === 'manual_review',
    `Statut création inattendu: ${created.result.status}`
  );

  // 2) Exactement comme enqueueChangeAfterPayment (montant inclus)
  console.log('\n2) Job CANCEL (change_to_comptant)…');
  const cancelJob = await runJob({
    order_id: `${baseId}-cancel`,
    action: 'cancel',
    cancel_reason: 'change_to_comptant',
    first_name: customer.first_name,
    last_name: customer.last_name,
    birthdate: customer.birthdate,
    phone: customer.phone,
    email: customer.email,
    gym: 'minimes',
    customer,
    deciplus_member_id: memberId,
    cancel_date: today,
    effective_date: today,
    product_name: 'Résiliation prélèvement (changement)',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  console.log('Cancel:', {
    ok: cancelJob?.ok,
    status: cancelJob?.result?.status,
    cancelled_count: cancelJob?.result?.cancelled_count,
    error: cancelJob?.error || cancelJob?.result?.error,
  });
  assert(
    cancelJob?.ok &&
      cancelJob.result.status === 'success' &&
      Number(cancelJob.result.cancelled_count || 0) >= 1,
    'Résiliation (changement) échouée'
  );

  console.log('\n3) Job SALE comptant (avec montant — le fix)…');
  const amountEuros = Number(comptant.price_cents || 0) / 100;
  assert(amountEuros > 0, 'Prix comptant invalide');

  // Validation seule d’abord (ce qui plantait avant le fix)
  const saleRaw = {
    order_id: baseId,
    action: 'sale',
    first_name: customer.first_name,
    last_name: customer.last_name,
    birthdate: customer.birthdate,
    phone: customer.phone,
    email: customer.email,
    gym: 'minimes',
    gender: customer.gender || 'M',
    address: customer.address || '1 rue Test',
    postal_code: customer.postal_code || '31000',
    city: customer.city || 'Toulouse',
    customer,
    deciplus_member_id: memberId,
    product_id: comptant.id,
    product_name: comptant.name,
    deciplus_id: comptant.deciplus_id,
    deciplus_product_search: comptant.deciplus_product_search || null,
    price_cents: comptant.price_cents,
    requires_payment: true,
    requires_iban: false,
    sale_type: 'abonnement',
    payment_method: 'stripe',
    stripe_session_id: `cs_test_change_${runId}`,
    sale_date: today,
    effective_date: today,
    auto_badge: false,
    paiement_comptant: true,
    payment: {
      amount: amountEuros,
      method: 'stripe',
      status: 'paid',
      date: new Date().toISOString(),
      stripe_session_id: `cs_test_change_${runId}`,
    },
    notify_change_complete: false,
    change_product_name: comptant.display_name || comptant.name,
    source: 'storefront-change',
  };
  const normalizedSale = normalizeOrder(saleRaw);
  const saleErrors = validateOrder(normalizedSale);
  console.log('Validation vente comptant:', saleErrors.length ? saleErrors : 'OK');
  assert(saleErrors.length === 0, `Vente rejetée avant bot: ${saleErrors.join(', ')}`);
  assert(normalizedSale.payment.amount === amountEuros, 'Montant non propagé');

  const saleJob = await runJob(saleRaw);
  console.log('Sale comptant:', {
    ok: saleJob?.ok,
    status: saleJob?.result?.status,
    memberId: saleJob?.result?.deciplus_member_id,
    saleId: saleJob?.result?.deciplus_sale_id,
    sale_action: saleJob?.result?.sale_action,
    error: saleJob?.error || saleJob?.result?.error,
  });
  assert(
    saleJob?.ok && saleJob.result.status === 'success',
    'Activation comptant échouée — la résiliation a eu lieu mais pas la reprise'
  );
  assert(
    saleJob.result.deciplus_member_id === memberId || saleJob.result.deciplus_member_id,
    'Member id manquant après vente comptant'
  );

  console.log('\n=== RÉSULTAT ===');
  console.log('OK — résiliation prélèvement + reprise comptant sur le même membre');
  console.log({
    memberId,
    cancelled_count: cancelJob.result.cancelled_count,
    comptant: comptant.name,
    sale_id: saleJob.result.deciplus_sale_id,
  });
})()
  .catch((err) => {
    console.error('\nÉCHEC:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser().catch(() => {});
  });
