#!/usr/bin/env node
/**
 * Tests locaux (sans navigateur) :
 * - Prélèvement promo retiré
 * - Offre 259 : comptant / 4×, pas d'IBAN, description
 * - Validation infos bloquantes changement d'abo
 * - Job résiliation mismatch (infos bloquantes)
 *
 * Usage: node scripts/test-change-and-offers.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const { listCurrentPlans } = require('../storefront/lib/membership');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const {
  productSupportsInstallmentChoice,
  isComptantStyleProduct,
} = require('../lib/billing-plan');

function testPlans() {
  const plans = listCurrentPlans();
  assert.ok(plans.length >= 2, 'plans attendus');
  assert.ok(
    !plans.some((p) => /promo/i.test(p.id) || /promo/i.test(p.label)),
    'Prélèvement promo doit être absent'
  );
  console.log('OK listCurrentPlans — pas de Prélèvement promo', plans.map((p) => p.id));
}

function testOffre259() {
  const p = findEnrichedProduct('offre-saison');
  assert.ok(p, 'offre-saison introuvable');
  assert.equal(p.requires_iban, false, '259€ ne doit pas exiger IBAN');
  assert.equal(productSupportsInstallmentChoice(p), true, 'choix 1×/4× requis');
  assert.equal(isComptantStyleProduct(p), true, 'style comptant');
  assert.ok(String(p.description || '').length > 40, 'description manquante');
  const priceHay = [
    p.price_label,
    p.marketing_price_label,
    p.display_name,
    p.installments_note,
    p.description,
    String(p.price_cents || ''),
  ].join(' ');
  assert.ok(/259|25900/.test(priceHay), 'prix 259 attendu dans merch/description');
  console.log('OK offre 259', {
    id: p.id,
    requires_iban: p.requires_iban,
    supports_installment_choice: p.supports_installment_choice,
    description: String(p.description).slice(0, 80) + '…',
  });
}

function testDescriptions() {
  const ids = [
    'offre-saison',
    'comptant-3-mois',
    'comptant-6-mois',
    'comptant-12-mois',
    '44-99-4-semaines',
    'offre-duo',
  ];
  for (const id of ids) {
    const p = findEnrichedProduct(id);
    assert.ok(p, `${id} manquant`);
    assert.ok(String(p.description || '').trim().length > 20, `${id} sans description`);
  }
  console.log('OK descriptions offres clés');
}

async function testChangeValidation() {
  const { createApp } = require('../storefront/server');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/membership/change/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_product_id: 'comptant-3-mois',
        // infos bloquantes manquantes volontairement
        email: 'test@example.com',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 400, 'doit refuser sans identité');
    assert.ok(!data.ok);
    assert.match(String(data.error || ''), /prénom|naissance|téléphone|nom/i);
    console.log('OK change checkout — validation infos bloquantes');

    const opt = await fetch(`http://127.0.0.1:${port}/api/membership/options`);
    const optData = await opt.json();
    assert.ok(optData.ok);
    assert.ok(
      !(optData.current_plans || []).some((p) => /promo/i.test(p.label)),
      'API options ne doit pas exposer Prélèvement promo'
    );
    console.log('OK /api/membership/options');

    const paypalCheckout = await fetch(`http://127.0.0.1:${port}/api/membership/change/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_product_id: 'comptant-3-mois',
        first_name: 'Ada',
        last_name: 'Lovelace',
        birthdate: '1990-01-15',
        email: 'ada@example.com',
        gym: 'minimes',
        current_plan: 'prelevement-adulte',
        payment_method: 'paypal',
      }),
    });
    const paypalData = await paypalCheckout.json();
    // Sans credentials PayPal : 503 ; avec credentials : url paypal.
    if (paypalCheckout.status === 503) {
      assert.equal(paypalData.error, 'paypal_not_configured');
      console.log('OK change checkout paypal — non configuré (503 attendu en local)');
    } else if (paypalCheckout.ok && paypalData.ok) {
      assert.equal(paypalData.mode, 'paypal');
      assert.ok(paypalData.url || paypalData.paypal_order_id);
      console.log('OK change checkout paypal — url créée');
    } else {
      assert.fail(`paypal checkout inattendu: ${paypalCheckout.status} ${JSON.stringify(paypalData)}`);
    }

    const payplugCheckout = await fetch(`http://127.0.0.1:${port}/api/membership/change/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_product_id: 'comptant-3-mois',
        first_name: 'Ada',
        last_name: 'Lovelace',
        birthdate: '1990-01-15',
        email: 'ada@example.com',
        gym: 'minimes',
        current_plan: 'prelevement-adulte',
        payment_method: 'payplug',
      }),
    });
    const payplugData = await payplugCheckout.json();
    if (payplugCheckout.status === 503) {
      assert.equal(payplugData.error, 'payplug_not_configured');
      console.log('OK change checkout payplug — non configuré (503 attendu en local)');
    } else if (payplugCheckout.ok && payplugData.ok) {
      assert.equal(payplugData.mode, 'payplug');
      assert.ok(payplugData.url || payplugData.payment_id);
      console.log('OK change checkout payplug — url créée');
    } else {
      // Peut échouer si clé invalide : on accepte une erreur métier autre que validation 400
      assert.notEqual(payplugCheckout.status, 400, 'identité complète ne doit pas être rejetée');
      console.log('OK change checkout payplug — branche atteinte', payplugCheckout.status);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function testCancelMismatch() {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.log('SKIP mismatch live — session Deciplus absente');
    return;
  }
  const runId = Date.now();
  process.env.BOXPLUS_QUEUE_DIR =
    process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-change-q-${runId}`);
  process.env.BOXPLUS_LOG_DIR =
    process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-change-log-${runId}`);
  const { enqueue, listPending } = require('../lib/queue');
  const { processOneJob } = require('../bot/index');
  const { closeBrowser } = require('../bot/browser-pool');

  const order = {
    order_id: `CANCEL-MISMATCH-${runId}`,
    action: 'cancel',
    cancel_reason: 'test_mismatch_blocking',
    gym: 'minimes',
    customer: {
      first_name: 'Faux',
      last_name: `Nom${String(runId).slice(-4)}`,
      birthdate: '1990-01-01',
      phone: '0699988877',
      email: 'mismatch-test@boxplus-test.local',
    },
    product_name: 'Résiliation abonnement',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
  };
  enqueue(order);
  const job = listPending().find((j) => j.order_id === order.order_id);
  const result = await processOneJob(job);
  console.log(
    'mismatch result',
    JSON.stringify(
      {
        ok: result?.ok,
        status: result?.result?.status,
        mismatch: result?.result?.mismatch,
        error: result?.result?.error || result?.error,
      },
      null,
      2
    )
  );
  assert.ok(
    result?.result?.mismatch ||
      result?.result?.status === 'manual_review' ||
      /ne correspondent pas/i.test(String(result?.result?.error || '')),
    'mismatch identité attendu'
  );
  try {
    await closeBrowser();
  } catch {
    /* ignore */
  }
  console.log('OK résiliation — vérif infos bloquantes (mismatch)');
}

(async () => {
  testPlans();
  testOffre259();
  testDescriptions();
  await testChangeValidation();
  await testCancelMismatch();
  console.log('\nTous les checks OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
