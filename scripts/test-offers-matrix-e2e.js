#!/usr/bin/env node
/**
 * Matrice live Deciplus — vérifie config + jobs réels.
 *
 * Usage (depuis BOXPLUS, session locale requise) :
 *   node scripts/test-offers-matrix-e2e.js
 *   node scripts/test-offers-matrix-e2e.js --only=29,essai,4x
 *   node scripts/test-offers-matrix-e2e.js --dry   # config seulement
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? new Set(
      onlyArg
        .slice(7)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null;
const dry = process.argv.includes('--dry');

const runId = Date.now();
process.env.BOXPLUS_QUEUE_DIR =
  process.env.BOXPLUS_QUEUE_DIR || path.join(os.tmpdir(), `boxplus-matrix-q-${runId}`);
process.env.BOXPLUS_LOG_DIR =
  process.env.BOXPLUS_LOG_DIR || path.join(os.tmpdir(), `boxplus-matrix-log-${runId}`);

const { buildProductConfig } = require('../lib/catalog-sale');
const { buildFourXInfoComptaNote } = require('../lib/info-compta-note');
const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');

const OFFERS = [
  {
    key: '29',
    product_name: 'OFFRE DUO',
    offer: 'offre-duo',
    matched: { id: 104, title: 'OFFRE DUO', price: 29 },
    amount: 29,
    method: 'payplug',
    billing_plan: 'rib',
    expect: { comptant: false, badge: true, iban: true },
  },
  {
    key: '34.99',
    product_name: 'OFFRE PROMO 34.99€ ETUDIANTS',
    offer: 'offre-promo-etudiant',
    matched: { id: 87, title: 'OFFRE PROMO 34.99€ ETUDIANTS', price: 34.99 },
    amount: 34.99,
    method: 'payplug',
    billing_plan: 'rib',
    expect: { comptant: false, badge: true, iban: true },
  },
  {
    key: '44.99',
    product_name: '44,99€/4 semaines',
    offer: '44-99-4-semaines',
    matched: { id: 88, title: '44,99€/4 semaines', price: 44.99 },
    amount: 44.99,
    method: 'payplug',
    billing_plan: 'rib',
    expect: { comptant: false, badge: true, iban: true },
  },
  {
    key: '36.99',
    product_name: 'Etudiants 36,99€',
    offer: 'etudiants-4-semaines',
    matched: { id: 89, title: 'Etudiants 36,99€', price: 36.99 },
    amount: 36.99,
    method: 'payplug',
    billing_plan: 'rib',
    expect: { comptant: false, badge: true, iban: true },
  },
  {
    key: 'comptant',
    product_name: 'COMPTANT 12 MOIS',
    offer: 'dp-22',
    matched: { id: 22, title: 'COMPTANT 12 MOIS', price: 400 },
    amount: 400,
    method: 'payplug',
    payment_plan: 'once',
    expect: { comptant: true, badge: false, iban: false, noFourXNote: true },
  },
  {
    key: '4x',
    product_name: 'OFFRE PROMO 12 MOIS',
    offer: 'offre-saison',
    matched: { id: 200, title: 'OFFRE PROMO 12 MOIS', price: 259 },
    amount: 259,
    method: 'payplug',
    payment_plan: '4x',
    expect: { comptant: true, badge: false, iban: false, fourXNote: true },
  },
  {
    key: 'essai',
    product_name: "Séance d'essai gratuite",
    offer: 'seance-essai',
    matched: null,
    amount: 0,
    method: 'free',
    expect: { trial: true },
  },
];

function buildOrder(offer, idx) {
  const customer = uniqueTestCustomer(`mx-${offer.key}`);
  customer.gym = 'minimes';
  return {
    order_id: `MX-${offer.key}-${runId}-${idx}`,
    product_name: offer.product_name,
    offer: offer.offer,
    gym: 'minimes',
    customer,
    payment: {
      amount: offer.amount,
      status: 'paid',
      method: offer.method,
      billing_plan: offer.billing_plan || null,
      payment_plan: offer.payment_plan || null,
      ...(offer.expect.iban ? { iban: VALID_TEST_IBAN } : {}),
    },
  };
}

function assertConfig(offer) {
  const order = buildOrder(offer, 0);
  if (offer.expect.trial) {
    const cfg = buildProductConfig(order, null);
    if (cfg.sale_type !== 'none') throw new Error(`essai sale_type=${cfg.sale_type}`);
    return { ok: true, cfg };
  }
  const cfg = buildProductConfig(order, offer.matched);
  if (Boolean(cfg.paiement_comptant) !== offer.expect.comptant) {
    throw new Error(`comptant got ${cfg.paiement_comptant} want ${offer.expect.comptant}`);
  }
  if (Boolean(cfg.auto_badge) !== offer.expect.badge) {
    throw new Error(`auto_badge got ${cfg.auto_badge} want ${offer.expect.badge}`);
  }
  if (offer.expect.iban && !cfg.requires_iban) throw new Error('requires_iban false');
  const note = buildFourXInfoComptaNote(order, cfg);
  if (offer.expect.fourXNote && !note.includes('4× sans frais')) {
    throw new Error('missing 4× note');
  }
  if (offer.expect.noFourXNote && note) throw new Error('unexpected 4× note on comptant');
  return { ok: true, cfg, note: note.slice(0, 80) };
}

async function runLive(selected) {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session Deciplus manquante:', session);
    console.error('Lance: npm run session:export');
    process.exit(1);
  }

  const { enqueue, listPending } = require('../lib/queue');
  const { processOneJob } = require('../bot/index');
  const { closeBrowser } = require('../bot/browser-pool');

  const results = [];
  for (let i = 0; i < selected.length; i += 1) {
    const offer = selected[i];
    const order = buildOrder(offer, i);
    console.log(`\n=== LIVE ${offer.key} · ${offer.product_name} ===`);
    console.log(order.order_id, order.customer.email);

    enqueue(order);
    const job = listPending().find((j) => j.order_id === order.order_id);
    if (!job) {
      results.push({ key: offer.key, ok: false, error: 'not_queued' });
      continue;
    }
    try {
      const outcome = await processOneJob(job);
      const ok = Boolean(outcome?.ok && (outcome?.result?.status === 'success' || offer.key === 'essai'));
      results.push({
        key: offer.key,
        ok: outcome?.ok !== false && !outcome?.impossible,
        status: outcome?.result?.status || outcome?.error || null,
        member_id: outcome?.result?.deciplus_member_id || null,
        badge: outcome?.result?.badge_action || null,
        sale_id: outcome?.result?.deciplus_sale_id || null,
      });
      console.log(JSON.stringify(results[results.length - 1], null, 2));
    } catch (err) {
      results.push({ key: offer.key, ok: false, error: err.message });
      console.error(err.message);
    }
  }

  await closeBrowser().catch(() => {});
  return results;
}

(async () => {
  const selected = OFFERS.filter((o) => !only || only.has(o.key));
  console.log('=== Config asserts ===');
  for (const offer of selected) {
    try {
      const r = assertConfig(offer);
      console.log(`OK config ${offer.key}`, r.cfg ? { comptant: r.cfg.paiement_comptant, badge: r.cfg.auto_badge, sale_type: r.cfg.sale_type } : {}, r.note || '');
    } catch (err) {
      console.error(`FAIL config ${offer.key}:`, err.message);
      process.exit(1);
    }
  }

  if (dry) {
    console.log('\n--dry : stop avant Deciplus live');
    process.exit(0);
  }

  console.log('\n=== Live Deciplus ===');
  const results = await runLive(selected);
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
