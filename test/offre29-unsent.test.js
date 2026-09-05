'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  listOffre29Unsent,
  waDuoSent,
  resumeSent,
} = require('../storefront/lib/offre29-unsent');

test('waDuoSent — ami notifié si SMS ou WhatsApp', () => {
  assert.equal(waDuoSent({ referral_notify: { whatsapp: { sent: true } } }), true);
  assert.equal(waDuoSent({ referral_notify: { sms: { sent: true } } }), true);
  assert.equal(waDuoSent({ referral_notify: {} }), false);
});

test('resumeSent — reprise déjà envoyée', () => {
  assert.equal(resumeSent({ funnel: { resume_sms_sent_at: '2026-01-01' } }), true);
  assert.equal(resumeSent({ funnel: {} }), false);
});

test('listOffre29Unsent — compte reprise, ami et relance', async () => {
  const orders = [
    {
      order_id: 'BC-duo',
      created_at: '2026-08-20T10:00:00.000Z',
      product_id: 'offre-duo',
      access_token: 'a'.repeat(48),
      product_snapshot: { name: 'OFFRE A 29€' },
      payment: { status: 'paid' },
      customer_short: { first_name: 'Alice', last_name: 'Martin', phone: '0612345678' },
      referral_friend: { prenom: 'Bob', nom: 'Durand', telephone: '0698765432' },
      referral_notify: {},
      step: 8,
    },
    {
      order_id: 'BC-reprise',
      created_at: '2026-08-19T10:00:00.000Z',
      product_id: 'dp-104',
      access_token: 'b'.repeat(48),
      product_snapshot: { name: 'OFFRE A 29€', requires_payment: true, price_cents: 2900 },
      payment: { status: 'pending' },
      customer_short: { first_name: 'Claire', phone: '0611223344' },
      step: 4,
      funnel: {},
    },
    {
      order_id: 'BC-relance',
      created_at: '2026-08-18T10:00:00.000Z',
      product_id: 'offre-duo',
      access_token: 'c'.repeat(48),
      product_snapshot: { name: 'OFFRE A 29€' },
      payment: { status: 'paid', paid_at: '2026-08-18T11:00:00.000Z' },
      customer_short: { first_name: 'Diego', phone: '0677889900' },
      step: 6,
      funnel: { step_entered_at: '2026-08-18T12:00:00.000Z' },
    },
    {
      order_id: 'BC-259',
      created_at: '2026-08-17T10:00:00.000Z',
      product_id: 'offre-saison',
      product_snapshot: { name: 'OFFRE 259€' },
      payment: { status: 'pending' },
      customer_short: { first_name: 'Eve', phone: '0611002200' },
      step: 4,
    },
  ];

  const out = await listOffre29Unsent({
    since: '2026-08-01T00:00:00.000Z',
    now: Date.parse('2026-08-20T18:00:00.000Z'),
    rows: orders,
  });
  assert.equal(out.scanned, 3);
  assert.equal(out.count, 3);
  assert.equal(out.by_type.duo_ami, 1);
  assert.equal(out.by_type.reprise, 1);
  assert.equal(out.by_type.relance, 1);
  assert.deepEqual(
    out.items.map((i) => i.type),
    ['duo_ami', 'reprise', 'relance']
  );
});
