'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOrderSummary,
  stripHeavyFields,
  reconstructOrderFromListRow,
} = require('../storefront/lib/order-persistence');

const fatOrder = {
  order_id: 'BC-1',
  access_token: 'tok-1',
  step: 6,
  product_id: 'offre-duo',
  payment: { status: 'paid', paid_at: '2026-08-17T10:00:00.000Z', iban: 'FR763000' },
  customer_short: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', phone: '0600000000' },
  customer_full: { gym: 'ramonville', email: 'ada@example.com' },
  product_snapshot: { id: 'offre-duo', display_name: 'Offre duo', price_cents: 2999 },
  funnel: { complete_deadline_at: '2026-08-17T10:30:00.000Z' },
  signature: { signed_at: null, image_base64: 'data:image/png;base64,AAAA' },
  documents: {
    photo: '/tmp/photo.jpg',
    photo_filename: 'photo.jpg',
    photo_base64: `data:image/jpeg;base64,${'A'.repeat(50000)}`,
  },
  created_at: '2026-08-17T09:00:00.000Z',
  updated_at: '2026-08-17T10:00:00.000Z',
};

test('buildOrderSummary n’embarque ni photo ni signature en base64', () => {
  const summary = buildOrderSummary(fatOrder);
  const json = JSON.stringify(summary);
  assert.equal(summary.order_id, 'BC-1');
  assert.equal(summary.payment.status, 'paid');
  assert.equal(summary.product_snapshot.id, 'offre-duo');
  assert.equal(summary.documents.has_photo, true);
  assert.equal(summary.documents.photo_filename, 'photo.jpg');
  assert.ok(!json.includes('photo_base64'));
  assert.ok(!json.includes('image_base64'));
  assert.ok(!json.includes('AAAA'));
  assert.equal(summary.payment.has_iban, true);
  assert.notEqual(summary.payment.iban, 'FR763000');
});

test('stripHeavyFields enlève les data-url base64', () => {
  const slim = stripHeavyFields(fatOrder);
  assert.equal(slim.documents.photo_filename, 'photo.jpg');
  assert.equal(slim.documents.photo_base64, undefined);
  assert.equal(slim.signature.image_base64, undefined);
});

test('reconstructOrderFromListRow reconstitue une commande liste sans payload', () => {
  const order = reconstructOrderFromListRow({
    order_id: 'BC-1',
    access_token: 'tok-1',
    updated_at: '2026-08-17T10:00:00.000Z',
    step: 6,
    payment: { status: 'paid' },
    product_snapshot: { id: 'offre-duo' },
    signed_at: null,
    photo: '/tmp/photo.jpg',
    photo_filename: 'photo.jpg',
  });
  assert.equal(order.order_id, 'BC-1');
  assert.equal(order.payment.status, 'paid');
  assert.equal(order.product_snapshot.id, 'offre-duo');
  assert.equal(order.documents.photo_filename, 'photo.jpg');
  assert.equal(order.signature.signed_at, null);
});

test('reconstructOrderFromListRow privilégie summary', () => {
  const order = reconstructOrderFromListRow({
    order_id: 'BC-1',
    summary: buildOrderSummary(fatOrder),
    payload: fatOrder,
  });
  assert.equal(order.documents.photo_base64, undefined);
  assert.equal(order.payment.status, 'paid');
});
