#!/usr/bin/env node
/**
 * E2E boutique → bot (formulaires exacts) :
 * 1) Créer un membre « sans engagement » (44,99 / 4 sem.)
 * 2) Formulaire changement d’abo → vérif identité + bascule comptant
 * 3) Formulaire résiliation : mauvaise date → mismatch birthdate
 * 4) Même formulaire : bonne date → résiliation OK
 *
 * Usage: node scripts/test-boutique-change-cancel-e2e.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-e2e-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-e2e-log-${runId}`);
// Ne pas spammer la boutique Vercel pendant le test local
process.env.BOXPLUS_STORE_URL = '';
process.env.STORE_URL = '';

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');
const { closeBrowser } = require('../bot/browser-pool');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { buildOrderPayload } = require('../storefront/lib/orders');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');
const { computeIdentityMismatches } = require('../bot/member');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runJob(order) {
  const normalized = normalizeOrder(order);
  const errors = validateOrder(normalized);
  if (errors.length) throw new Error(`Validation: ${errors.join(', ')}`);
  enqueue(normalized);
  const job = listPending().find((j) => j.order_id === normalized.order_id);
  if (!job) throw new Error('job_not_queued');
  return processOneJob(job);
}

function boutiqueCancelBody(customer, { birthdate, reason = 'test_e2e' } = {}) {
  // Même payload que le formulaire David / POST /api/membership/cancel — SANS member_id
  return {
    order_id: `CANCEL-E2E-${runId}-${Math.random().toString(16).slice(2, 8)}`,
    action: 'cancel',
    cancel_reason: reason,
    cancel_date: new Date().toISOString().slice(0, 10),
    gym: customer.gym || 'minimes',
    first_name: customer.first_name,
    last_name: customer.last_name,
    birthdate: birthdate || customer.birthdate,
    phone: customer.phone,
    email: customer.email,
    customer: {
      first_name: customer.first_name,
      last_name: customer.last_name,
      birthdate: birthdate || customer.birthdate,
      phone: customer.phone,
      email: customer.email,
    },
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
}

function boutiqueVerifyBody(customer, { birthdate } = {}) {
  return {
    order_id: `VERIFY-E2E-${runId}-${Math.random().toString(16).slice(2, 8)}`,
    action: 'verify_identity',
    gym: customer.gym || 'minimes',
    first_name: customer.first_name,
    last_name: customer.last_name,
    birthdate: birthdate || customer.birthdate,
    phone: customer.phone,
    email: customer.email,
    customer: {
      first_name: customer.first_name,
      last_name: customer.last_name,
      birthdate: birthdate || customer.birthdate,
      phone: customer.phone,
      email: customer.email,
    },
    product_name: 'Vérification identité',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
}

(async () => {
  // Sanity unitaire : coloriage = champs faux uniquement
  const unit = computeIdentityMismatches(
    {
      lastName: 'GODIR',
      firstName: 'godir',
      birth: '12/12/2012',
      phone: '012345678',
      foundViaPhone: true,
    },
    {
      last_name: 'godir',
      first_name: 'GODIR',
      birthdate: '2000-01-01',
      phone: '012345678',
    }
  );
  assert(
    unit.mismatchFields.length === 1 && unit.mismatchFields[0] === 'birthdate',
    `computeIdentityMismatches attendu [birthdate], got ${JSON.stringify(unit.mismatchFields)}`
  );
  console.log('OK unit: mismatch birthdate seul (casse ignorée sur nom/prénom)');

  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session manquante — npm run session:export');
    process.exit(1);
  }

  const prelevProduct =
    findEnrichedProduct('44-99-4-semaines') ||
    findEnrichedProduct('dp-88') ||
    findEnrichedProduct('44,99€/4 semaines');
  assert(prelevProduct, 'Produit sans engagement 44,99 introuvable');

  const comptantProduct =
    findEnrichedProduct('comptant-3-mois') ||
    findEnrichedProduct('comptant-6-mois') ||
    findEnrichedProduct('comptant-12-mois');
  assert(comptantProduct, 'Produit comptant cible introuvable');

  const customer = uniqueTestCustomer('e2echg');
  customer.gym = 'minimes';
  // Variante casse volontaire (comme un client qui tape en majuscules)
  const formNames = {
    first_name: customer.first_name.toUpperCase(),
    last_name: customer.last_name.toLowerCase(),
  };

  console.log('\n=== 1) CRÉATION SANS ENGAGEMENT (formulaire boutique) ===');
  console.log({
    product: prelevProduct.name,
    email: customer.email,
    phone: customer.phone,
    birthdate: customer.birthdate,
  });

  const salePayload = buildOrderPayload(
    {
      order_id: `LIVE-E2E-SALE-${runId}`,
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
      payment_method: 'card',
      billing_plan: 'rib',
      iban: VALID_TEST_IBAN,
    },
    prelevProduct
  );
  salePayload.payment = {
    ...(salePayload.payment || {}),
    amount: (prelevProduct.price_cents || 4499) / 100,
    status: 'paid',
    method: 'card',
    billing_plan: 'prelevement',
    iban: VALID_TEST_IBAN,
  };

  const sale = await runJob(salePayload);
  const memberId = sale?.result?.deciplus_member_id;
  console.log('Création:', {
    ok: sale?.ok,
    status: sale?.result?.status,
    member: memberId,
    error: sale?.error || sale?.result?.error,
  });
  assert(memberId && sale?.result?.status === 'success', 'Création sans engagement échouée');

  console.log('\n=== 2) CHANGEMENT D’ABO — vérif identité (mauvaise date → rouge) ===');
  const verifyBad = await runJob(
    boutiqueVerifyBody(
      { ...customer, first_name: formNames.first_name, last_name: formNames.last_name },
      { birthdate: '2000-01-01' }
    )
  );
  console.log('Verify bad birth:', {
    status: verifyBad?.result?.status,
    mismatch: verifyBad?.result?.mismatch_fields,
    error: verifyBad?.error || verifyBad?.result?.error,
  });
  assert(verifyBad?.result?.mismatch === true, 'Verify mauvaise date doit mismatch');
  assert(
    (verifyBad?.result?.mismatch_fields || []).includes('birthdate'),
    `Attendus mismatch_fields contenant birthdate (pour colorier en rouge), got ${JSON.stringify(verifyBad?.result?.mismatch_fields)}`
  );

  console.log('\n=== 3) CHANGEMENT D’ABO — vérif OK puis bascule comptant ===');
  const verifyOk = await runJob(
    boutiqueVerifyBody({
      ...customer,
      first_name: formNames.first_name,
      last_name: formNames.last_name,
    })
  );
  console.log('Verify OK:', {
    status: verifyOk?.result?.status,
    member: verifyOk?.result?.deciplus_member_id,
    verified: verifyOk?.result?.verified,
  });
  assert(
    verifyOk?.result?.status === 'success' && verifyOk?.result?.verified,
    'Verify bonne identité doit réussir'
  );

  // Exactement enqueueChangeAfterPayment : cancel prélèvement + vente comptant (sans Stripe)
  const today = new Date().toISOString().slice(0, 10);
  const changeBase = `CHANGE-E2E-${runId}`;
  const changeCancel = await runJob({
    order_id: `${changeBase}-cancel`,
    action: 'cancel',
    cancel_reason: 'change_to_comptant',
    cancel_date: today,
    gym: 'minimes',
    first_name: formNames.first_name,
    last_name: formNames.last_name,
    birthdate: customer.birthdate,
    phone: customer.phone,
    email: customer.email,
    customer: {
      first_name: formNames.first_name,
      last_name: formNames.last_name,
      birthdate: customer.birthdate,
      phone: customer.phone,
      email: customer.email,
    },
    product_name: 'Résiliation prélèvement (changement)',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  });
  console.log('Change cancel:', {
    status: changeCancel?.result?.status,
    cancelled: changeCancel?.result?.cancelled_count,
    error: changeCancel?.error || changeCancel?.result?.error,
  });
  assert(
    changeCancel?.result?.status === 'success' &&
      Number(changeCancel?.result?.cancelled_count || 0) >= 1,
    'Résiliation prélèvement (changement) échouée'
  );

  const changeSalePayload = buildOrderPayload(
    {
      order_id: changeBase,
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
      payment_method: 'stripe',
      payment_plan: 'once',
    },
    comptantProduct
  );
  changeSalePayload.deciplus_member_id = memberId;
  changeSalePayload.payment = {
    ...(changeSalePayload.payment || {}),
    amount: (comptantProduct.price_cents || 0) / 100,
    status: 'paid',
    method: 'card',
  };
  changeSalePayload.auto_badge = false;

  const changeSale = await runJob(changeSalePayload);
  console.log('Change sale comptant:', {
    status: changeSale?.result?.status,
    member: changeSale?.result?.deciplus_member_id,
    error: changeSale?.error || changeSale?.result?.error,
  });
  assert(changeSale?.result?.status === 'success', 'Activation comptant (changement) échouée');

  console.log('\n=== 4) RÉSILIATION — mauvaise date (doit colorier Naissance) ===');
  const cancelBad = await runJob(
    boutiqueCancelBody(
      { ...customer, first_name: formNames.first_name, last_name: formNames.last_name },
      { birthdate: '2001-01-01', reason: 'test_e2e_bad_birth' }
    )
  );
  console.log('Cancel bad birth:', {
    status: cancelBad?.result?.status,
    mismatch: cancelBad?.result?.mismatch_fields,
    error: cancelBad?.error || cancelBad?.result?.error,
  });
  assert(cancelBad?.result?.mismatch === true, 'Résiliation mauvaise date doit mismatch');
  assert(
    (cancelBad?.result?.mismatch_fields || []).includes('birthdate'),
    `Champs à colorier en rouge doivent inclure birthdate, got ${JSON.stringify(cancelBad?.result?.mismatch_fields)}`
  );
  assert(
    !(cancelBad?.result?.mismatch_fields || []).includes('last_name'),
    'Ne doit PAS signaler le nom comme faux'
  );
  assert(
    !(cancelBad?.result?.mismatch_fields || []).includes('first_name'),
    'Ne doit PAS signaler le prénom comme faux'
  );

  console.log('\n=== 5) RÉSILIATION — bonne date (succès) ===');
  const cancelOk = await runJob(
    boutiqueCancelBody(
      { ...customer, first_name: formNames.first_name, last_name: formNames.last_name },
      { reason: 'test_e2e_ok' }
    )
  );
  console.log('Cancel OK:', {
    status: cancelOk?.result?.status,
    cancelled: cancelOk?.result?.cancelled_count,
    error: cancelOk?.error || cancelOk?.result?.error,
  });
  assert(
    cancelOk?.result?.status === 'success' && Number(cancelOk?.result?.cancelled_count || 0) >= 1,
    'Résiliation avec bonne date doit réussir'
  );

  console.log('\n=== RÉSUMÉ E2E OK ===');
  console.log(
    JSON.stringify(
      {
        ok: true,
        member_id: memberId,
        prelevement: prelevProduct.name,
        comptant: comptantProduct.name,
        verify_bad_fields: verifyBad.result.mismatch_fields,
        cancel_bad_fields: cancelBad.result.mismatch_fields,
        message: 'Identité OK — mauvaise date coloriée (birthdate) — résiliation réussie',
      },
      null,
      2
    )
  );

  await closeBrowser().catch(() => {});
  process.exit(0);
})().catch(async (err) => {
  console.error('\nFATAL E2E:', err.message);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
