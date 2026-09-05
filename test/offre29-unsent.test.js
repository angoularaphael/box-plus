'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listOffre29Unsent, waDuoSent } = require('../storefront/lib/offre29-unsent');

test('waDuoSent — ami notifié si SMS ou WhatsApp', () => {
  assert.equal(waDuoSent({ referral_notify: { whatsapp: { sent: true } } }), true);
  assert.equal(waDuoSent({ referral_notify: { sms: { sent: true } } }), true);
  assert.equal(waDuoSent({ referral_notify: {} }), false);
});

test('listOffre29Unsent — uniquement amis Offre Duo non notifiés', async () => {
  const orders = [
    {
      order_id: 'BC-duo',
      created_at: '2026-08-20T10:00:00.000Z',
      product_id: 'offre-duo',
      product_snapshot: { name: 'OFFRE A 29€' },
      payment: { status: 'paid', paid_at: '2026-08-20T11:00:00.000Z' },
      customer_short: { first_name: 'Alice', last_name: 'Martin' },
      referral_friend: { prenom: 'Bob', nom: 'Durand', telephone: '0698765432' },
      referral_notify: {},
    },
    {
      order_id: 'BC-duo-sent',
      created_at: '2026-08-19T10:00:00.000Z',
      product_id: 'offre-duo',
      product_snapshot: { name: 'OFFRE A 29€' },
      payment: { status: 'paid' },
      customer_short: { first_name: 'Claire' },
      referral_friend: { prenom: 'Eve', telephone: '0611223344' },
      referral_notify: { sms: { sent: true } },
    },
    {
      order_id: 'BC-reprise',
      created_at: '2026-08-18T10:00:00.000Z',
      product_id: 'dp-104',
      product_snapshot: { name: 'OFFRE A 29€', requires_payment: true, price_cents: 2900 },
      payment: { status: 'pending' },
      customer_short: { first_name: 'Diego', phone: '0677889900' },
      step: 4,
    },
    {
      order_id: 'BC-259',
      created_at: '2026-08-17T10:00:00.000Z',
      product_id: 'offre-saison',
      product_snapshot: { name: 'OFFRE 259€' },
      payment: { status: 'paid' },
      customer_short: { first_name: 'Frank' },
      referral_friend: { prenom: 'Grace', telephone: '0611002200' },
    },
  ];

  const out = await listOffre29Unsent({
    since: '2026-08-01T00:00:00.000Z',
    rows: orders,
  });
  assert.equal(out.count, 1);
  assert.equal(out.items[0].name, 'Bob Durand');
  assert.equal(out.items[0].phone, '0698765432');
  assert.equal(out.items[0].referrer, 'Alice Martin');
  assert.equal(out.items[0].order_id, 'BC-duo');
});
