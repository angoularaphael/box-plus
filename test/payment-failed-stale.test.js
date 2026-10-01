'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ordersDir = path.join(os.tmpdir(), `boxplus-failed-stale-${Date.now()}`);
fs.mkdirSync(ordersDir, { recursive: true });
process.env.BOXPLUS_ORDERS_DIR = ordersDir;
process.env.BOXPLUS_ORDERS_REMOTE = '0';
process.env.NODE_ENV = 'test';

const {
  createDraftAsync,
  markPaymentPaid,
  markPaymentFailed,
  loadOrderAsync,
  saveOrderAsync,
} = require('../storefront/lib/order-lifecycle');

const product = {
  id: 'offre-259',
  name: 'Saison',
  price_cents: 25900,
  requires_payment: true,
};

test('échec PayPlug ancien n’écrase pas la page courante ni un paiement payé', async () => {
  const draft = await createDraftAsync({
    product_id: product.id,
    product,
    customer_short: { first_name: 'Raphael', last_name: 'Test', email: 'raphael-test@example.com' },
  });

  draft.payment = {
    method: 'payplug',
    status: 'pending',
    payplug_payment_id: 'pay_B',
    payplug_payment_ids: ['pay_A'],
  };
  await saveOrderAsync(draft);

  const afterOldFail = await markPaymentFailed(draft.order_id, {
    method: 'payplug',
    payplug_payment_id: 'pay_A',
    failure: { code: 'card_declined', message: 'Refusée' },
  });
  assert.equal(afterOldFail.payment.status, 'pending');
  assert.equal(afterOldFail.payment.payplug_payment_id, 'pay_B');
  assert.equal(afterOldFail.payment.last_failed_payment_id, 'pay_A');
  assert.ok(afterOldFail.payment.payplug_payment_ids.includes('pay_A'));

  await markPaymentPaid(draft.order_id, {
    method: 'payplug',
    payplug_payment_id: 'pay_B',
    status: 'paid',
  });
  const afterPaidFail = await markPaymentFailed(draft.order_id, {
    method: 'payplug',
    payplug_payment_id: 'pay_B',
    failure: { message: 'late webhook' },
  });
  assert.equal(afterPaidFail.payment.status, 'paid');

  const currentFail = await createDraftAsync({
    product_id: product.id,
    product,
    customer_short: { first_name: 'A', last_name: 'B', email: 'ab-fail@example.com' },
  });
  currentFail.payment = {
    method: 'payplug',
    status: 'pending',
    payplug_payment_id: 'pay_ONLY',
  };
  await saveOrderAsync(currentFail);
  const failed = await markPaymentFailed(currentFail.order_id, {
    method: 'payplug',
    payplug_payment_id: 'pay_ONLY',
    failure: { message: 'Refusée' },
  });
  assert.equal(failed.payment.status, 'failed');

  const reloaded = await loadOrderAsync(draft.order_id);
  assert.equal(reloaded.payment.status, 'paid');
});
