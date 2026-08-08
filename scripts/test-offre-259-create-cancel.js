#!/usr/bin/env node
/**
 * Live Deciplus : crée un membre OFFRE PROMO 12 MOIS (259 € comptant 1×), puis résilie.
 * Usage: node scripts/test-offre-259-create-cancel.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-259-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-259-log-${runId}`);

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { buildOrderPayload } = require('../storefront/lib/orders');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { uniqueTestCustomer } = require('../lib/test-fixtures');

async function runJob(order) {
  const normalized = normalizeOrder(order);
  const errors = validateOrder(normalized);
  if (errors.length) throw new Error(`Validation: ${errors.join(', ')}`);
  enqueue(normalized);
  const job = listPending().find((j) => j.order_id === normalized.order_id);
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
    console.error('Session manquante — npm run session:export');
    process.exit(1);
  }

  const product =
    findEnrichedProduct('offre-saison') || findEnrichedProduct('dp-100');
  if (!product) throw new Error('offre-saison introuvable');

  console.log('Produit boutique:', {
    id: product.id,
    legacy_id: product.legacy_id,
    name: product.name,
    price_cents: product.price_cents,
    requires_iban: product.requires_iban,
    supports_installment_choice: product.supports_installment_choice,
    subsection: product.subsection,
  });

  if (product.price_cents !== 25900) {
    throw new Error(`Prix attendu 25900, got ${product.price_cents}`);
  }
  if (product.requires_iban !== false) {
    throw new Error('Offre 259 doit être sans IBAN');
  }

  const customer = uniqueTestCustomer('offre259');
  customer.gym = 'minimes';

  console.log('\n=== 1) CRÉATION OFFRE 259 € (comptant 1×) ===');
  console.log('Client:', {
    name: `${customer.first_name} ${customer.last_name}`,
    email: customer.email,
    phone: customer.phone,
  });

  const payload = buildOrderPayload(
    {
      order_id: `LIVE-259-${runId}`,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone: customer.phone,
      birthdate: customer.birthdate,
      gender: customer.gender || 'M',
      gym: 'minimes',
      address: customer.address,
      postal_code: customer.postal_code,
      city: customer.city,
      payment_plan: 'once',
      payment_method: 'stripe',
    },
    product
  );

  console.log('Payload:', {
    product_name: payload.product_name,
    requires_iban: payload.requires_iban,
    payment_plan: payload.payment_plan,
    paiement_comptant: payload.paiement_comptant,
    amount: payload.payment.amount,
    iban: payload.payment.iban,
  });

  const sale = await runJob(payload);
  const saleSum = summarize('create_259', sale);
  if (!saleSum.member || saleSum.status !== 'success') {
    throw new Error(`Création 259 échouée: ${saleSum.error || saleSum.status}`);
  }

  console.log(`\n=== 2) RÉSILIATION (membre ${saleSum.member}) ===`);
  const cancel = await runJob({
    order_id: `LIVE-259-CANCEL-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_offre_259_create_cancel',
    cancel_date: new Date().toISOString().slice(0, 10),
    gym: 'minimes',
    deciplus_member_id: saleSum.member,
    customer,
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  const cancelSum = summarize('cancel_259', cancel);

  const ok =
    saleSum.status === 'success' &&
    cancelSum.status === 'success' &&
    Number(cancelSum.cancelled_count || 0) >= 1;

  console.log('\n=== RÉSUMÉ ===');
  console.log(
    JSON.stringify(
      {
        ok,
        member_id: saleSum.member,
        create: saleSum.status,
        cancel: cancelSum.status,
        cancelled_count: cancelSum.cancelled_count,
      },
      null,
      2
    )
  );

  await closeBrowser().catch(() => {});
  process.exit(ok ? 0 : 1);
})().catch(async (err) => {
  console.error('FATAL:', err.message);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
