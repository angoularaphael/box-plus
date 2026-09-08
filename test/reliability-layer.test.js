'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATES,
  canTransition,
  advanceOrder,
  isMemberOrSaleEligible,
} = require('../lib/job-lifecycle');
const { CLASSIFICATION, classifyError, backoffMs } = require('../lib/retry-policy');
const { CATEGORY, categoriesForOrder, reconcileOrders } = require('../lib/reliability-reconcile');
const idempotency = require('../lib/persistent-idempotency');
const { resumeDecision } = idempotency;

test('state machine accepte uniquement les transitions légales', () => {
  assert.equal(canTransition(STATES.PAID, STATES.DOSSIER_COMPLETE), true);
  assert.equal(canTransition(STATES.PAID, STATES.MEMBER_CREATED), false);
  assert.equal(canTransition(STATES.SIGNED, STATES.MEMBER_CREATED), true);
  assert.equal(canTransition(STATES.MEMBER_CREATED, STATES.SALE_CREATED), false);
});

test('advanceOrder persiste les checkpoints canoniques', () => {
  const order = { payment: { status: 'paid' } };
  advanceOrder(order, STATES.SIGNED);
  assert.equal(order.reliability.state, STATES.SIGNED);
  assert.deepEqual(order.reliability.history.map((row) => row.to), [
    STATES.DOSSIER_COMPLETE,
    STATES.SIGNED,
  ]);
});

test('une commande non signée reste inéligible aux écritures Deciplus', () => {
  const order = { payment: { status: 'paid' }, reliability: { state: STATES.PAID } };
  assert.equal(isMemberOrSaleEligible(order), false);
  order.signature = { signed_at: new Date().toISOString() };
  advanceOrder(order, STATES.SIGNED);
  assert.equal(isMemberOrSaleEligible(order), true);
});

test('IBAN inchangé invalide est non retryable', () => {
  const result = classifyError(new Error('IBAN français invalide'));
  assert.equal(result.classification, CLASSIFICATION.VALIDATION);
  assert.equal(result.retryable, false);
});

test('auth et réseau sont retryables avec backoff exponentiel borné', () => {
  assert.equal(classifyError(new Error('session Deciplus expirée')).classification, CLASSIFICATION.AUTH);
  assert.equal(classifyError(new Error('navigation timeout')).classification, CLASSIFICATION.TRANSIENT);
  assert.equal(backoffMs(1, { baseMs: 1000, random: () => 0 }), 750);
  assert.equal(backoffMs(3, { baseMs: 1000, random: () => 0 }), 3000);
  assert.equal(backoffMs(20, { baseMs: 1000, capMs: 5000, random: () => 0 }), 3750);
});

test('réconciliation classe les anomalies demandées', () => {
  const unsigned = {
    order_id: 'U1',
    payment: { status: 'paid' },
    deciplus_member_id: '10',
  };
  assert.deepEqual(categoriesForOrder(unsigned), [CATEGORY.PAID_UNSIGNED_MEMBER]);
  const report = reconcileOrders([
    unsigned,
    {
      order_id: 'S1',
      payment: { status: 'paid', billing_plan: 'rib' },
      signature: { signed_at: '2026-01-01' },
      deciplus_sale_id: '20',
      bot_status: 'success',
      reliability: { badge_created: true, active_subscription_count: 2 },
    },
  ]);
  assert.equal(report.mode, 'read_only_dry_run');
  assert.equal(report.counts[CATEGORY.PAID_UNSIGNED_MEMBER], 1);
  assert.equal(report.counts[CATEGORY.SALE_MANDATE_MISSING], 1);
  assert.equal(report.counts[CATEGORY.DUPLICATE_SUBSCRIPTION], 1);
  assert.equal(report.counts[CATEGORY.BADGE_WITHOUT_CONTRACT], 1);
});

test('crash après MEMBER_CREATED reprend le membre sans le recréer', () => {
  const decision = resumeDecision({
    acquired: true,
    reason: 'acquired',
    member_id: '18401',
    sale_id: null,
  });
  assert.deepEqual(decision, { disposition: 'resume_after_member', member_id: '18401' });
});

test('callback perdu après SALE_CREATED retourne le résultat durable sans nouvelle vente', () => {
  const decision = resumeDecision({
    acquired: false,
    reason: 'completed',
    member_id: '18401',
    sale_id: '42677',
  });
  assert.deepEqual(decision, {
    disposition: 'completed',
    member_id: '18401',
    sale_id: '42677',
  });
});

test('registre distribué utilise les RPC atomiques avec identité worker', async () => {
  const calls = [];
  idempotency._setClientForTests({
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (name === 'boxplus_acquire_job_action') {
        return { data: [{ acquired: true, reason: 'acquired', attempt: 1 }], error: null };
      }
      return { data: { status: params.p_status }, error: null };
    },
  });
  const lease = await idempotency.acquire('BC-LOCK', 'sale', {
    workerId: 'sales-1',
    leaseSeconds: 60,
  });
  assert.equal(lease.acquired, true);
  await idempotency.checkpoint('BC-LOCK', 'sale', {
    worker_id: 'sales-1',
    status: 'completed',
    member_id: '11',
    sale_id: '22',
  });
  assert.deepEqual(calls.map((call) => call.name), [
    'boxplus_acquire_job_action',
    'boxplus_checkpoint_job_action',
  ]);
  assert.equal(calls[1].params.p_worker_id, 'sales-1');
});
