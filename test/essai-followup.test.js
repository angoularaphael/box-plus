'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPaidEssaiOrder,
  isMembershipOrder,
  isMembershipContract,
  getGymCoachTarget,
  gymEssaiFollowupText,
  membershipKeysFromOrders,
  classifyEssaiFollowup,
  classifyCustomerNudge,
  customerNudgeCopy,
  essaiCheckSaleJob,
  stripEssaiAboSuffix,
  applyEssaiAboCheck,
  dispatchDueEssaiFollowups,
  ESSAI_SINCE_MS,
  FOLLOWUP_AFTER_MS,
  CUSTOMER_NUDGE_GAP_MS,
  WA_GAP_MS,
} = require('../storefront/lib/essai-followup');

const THREE_DAYS = FOLLOWUP_AFTER_MS;

function essai(overrides = {}) {
  return {
    order_id: 'BC-ESSAI-1',
    product_id: 'seance-essai',
    product_snapshot: { id: 'seance-essai', name: "SEANCE D'ESSAI", price_cents: 1000 },
    payment: { status: 'paid', paid_at: '2026-08-20T10:00:00.000Z', amount: 10 },
    customer_short: {
      first_name: 'Camille',
      last_name: 'Durand',
      email: 'camille@example.com',
      phone: '0612345678',
      birthdate: '1994-05-12',
    },
    customer_full: { gym: 'minimes' },
    created_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

test('essai 10 € payé reconnu, essai gratuit web ignoré', () => {
  assert.equal(isPaidEssaiOrder(essai()), true);
  assert.equal(
    isPaidEssaiOrder(
      essai({
        product_id: 'seance-essai-offerte',
        product_snapshot: { id: 'seance-essai-offerte', name: 'SEANCE D ESSAI GRATUITE WEB', price_cents: 0 },
        payment: { status: 'paid', amount: 0, paid_at: '2026-08-20T10:00:00.000Z' },
      })
    ),
    false
  );
  assert.equal(isPaidEssaiOrder(essai({ payment: { status: 'pending', amount: 10 } })), false);
});

test('abonnement 29 / 259 reconnu, 44,99 et coaching ignorés', () => {
  assert.equal(
    isMembershipOrder({
      order_id: 'BC-ABO',
      product_id: 'dp-104',
      payment: { status: 'paid', amount: 29.99 },
      product_snapshot: { price_cents: 2999, name: 'OFFRE A 29€' },
    }),
    true
  );
  assert.equal(
    isMembershipOrder({
      order_id: 'BC-259',
      product_id: 'dp-100',
      payment: { status: 'paid', amount: 259 },
      product_snapshot: { price_cents: 25900, name: 'OFFRE PROMO 12 MOIS' },
    }),
    true
  );
  assert.equal(isMembershipOrder(essai()), false);
  assert.equal(
    isMembershipOrder({
      order_id: 'BC-44',
      product_id: '44-99-4-semaines',
      payment: { status: 'paid', amount: 44.99 },
      product_snapshot: { price_cents: 4499, name: '44,99 € / 4 semaines' },
    }),
    false
  );
  assert.equal(
    isMembershipOrder({
      order_id: 'BC-COACH',
      product_id: 'coaching-1',
      payment: { status: 'paid', amount: 55 },
      product_snapshot: { price_cents: 5500 },
    }),
    false
  );
});

test('Minimes et États-Unis = même numéro, Portet et St-Cyprien distincts, Ramonville ignoré', () => {
  assert.equal(getGymCoachTarget('minimes').telephone, '+33767919166');
  assert.equal(getGymCoachTarget('etats-unis').telephone, '+33767919166');
  assert.equal(getGymCoachTarget('États-Unis').telephone, '+33767919166');
  assert.equal(getGymCoachTarget('portet').telephone, '+33687900216');
  assert.equal(getGymCoachTarget('st-cyprien').telephone, '+33625745369');
  assert.equal(getGymCoachTarget('ramonville'), null);
});

test('contrat Deciplus 29 / 259 compte, essai / 44,99 non', () => {
  assert.equal(isMembershipContract({ isBadge: true, label: 'Badge' }), false);
  assert.equal(isMembershipContract({ isBadge: false, label: "SEANCE D'ESSAI" }), false);
  assert.equal(isMembershipContract({ isBadge: false, label: '44,99 € / 4 semaines' }), false);
  assert.equal(isMembershipContract({ isBadge: false, label: 'OFFRE A 29€' }), true);
  assert.equal(isMembershipContract({ isBadge: false, label: 'OFFRE PROMO 12 MOIS 259€' }), true);
});

test('message coach contient nom, tel, salle et 10 €', () => {
  const text = gymEssaiFollowupText(essai({ customer_full: { gym: 'etats-unis' } }));
  assert.match(text, /10 €/);
  assert.match(text, /Camille Durand/);
  assert.match(text, /0612345678/);
  assert.match(text, /États-Unis/);
  assert.match(text, /29 € ni 259 €/);
});

test('relance client J+0 / J+1 / J+2 puis stop à J+3', () => {
  const paid = Date.parse('2026-08-20T10:00:00.000Z');
  const keys = membershipKeysFromOrders([]);
  const d1 = classifyCustomerNudge(essai(), { now: paid + 60 * 1000, membershipKeys: keys });
  assert.equal(d1.action, 'nudge_customer');
  assert.equal(d1.day, 1);
  const after1 = essai({
    essai_customer_nudges: [{ day: 1, at: new Date(paid + 60 * 1000).toISOString() }],
  });
  const tooSoon = classifyCustomerNudge(after1, {
    now: paid + 2 * 60 * 60 * 1000,
    membershipKeys: keys,
  });
  assert.equal(tooSoon.action, 'wait');
  const d2 = classifyCustomerNudge(after1, {
    now: paid + CUSTOMER_NUDGE_GAP_MS + 1000,
    membershipKeys: keys,
  });
  assert.equal(d2.action, 'nudge_customer');
  assert.equal(d2.day, 2);
  const copy = customerNudgeCopy(essai(), 1);
  assert.match(copy.text, /29 €/);
  assert.match(copy.text, /259 €/);
  const after72h = classifyCustomerNudge(essai(), {
    now: paid + THREE_DAYS + 1000,
    membershipKeys: keys,
  });
  assert.equal(after72h.action, 'skip');
  assert.equal(after72h.reason, 'coach_window');
});

test('avant 3 jours → wait, après 3 jours sans abo → check Deciplus', () => {
  const paid = Date.parse('2026-08-20T10:00:00.000Z');
  const keys = membershipKeysFromOrders([]);
  const early = classifyEssaiFollowup(essai(), {
    now: paid + THREE_DAYS - 1000,
    membershipKeys: keys,
  });
  assert.equal(early.action, 'wait');
  const due = classifyEssaiFollowup(essai(), {
    now: paid + THREE_DAYS + 1000,
    membershipKeys: keys,
  });
  assert.equal(due.action, 'enqueue_check');
});

test('abo boutique plus tard → converted, pas de WhatsApp', () => {
  const trial = essai();
  const abo = {
    order_id: 'BC-ABO',
    product_id: 'dp-104',
    payment: { status: 'paid', amount: 29.99, paid_at: '2026-08-22T10:00:00.000Z' },
    product_snapshot: { price_cents: 2999 },
    customer_short: { email: 'camille@example.com', phone: '0612345678' },
  };
  const keys = membershipKeysFromOrders([trial, abo]);
  const decision = classifyEssaiFollowup(trial, {
    now: Date.parse(trial.payment.paid_at) + THREE_DAYS + 1000,
    membershipKeys: keys,
  });
  assert.equal(decision.action, 'converted');
});

test('avant le 13 août → skip', () => {
  const old = essai({
    payment: { status: 'paid', paid_at: '2026-08-10T10:00:00.000Z', amount: 10 },
  });
  const decision = classifyEssaiFollowup(old, {
    now: ESSAI_SINCE_MS + 10 * 24 * 60 * 60 * 1000,
    membershipKeys: membershipKeysFromOrders([]),
  });
  assert.equal(decision.action, 'skip');
  assert.equal(decision.reason, 'before_13_aout');
});

test('check Deciplus fait, pas d’abo → send, 2 min d’écart', () => {
  const ready = essai({
    essai_abo_checked_at: '2026-08-23T12:00:00.000Z',
    essai_has_abo: false,
    essai_followup_status: 'ready',
  });
  const paid = Date.parse(ready.payment.paid_at);
  const now = paid + THREE_DAYS + 1000;
  const send = classifyEssaiFollowup(ready, {
    now,
    membershipKeys: membershipKeysFromOrders([]),
    lastWaAt: 0,
  });
  assert.equal(send.action, 'send');
  const gap = classifyEssaiFollowup(ready, {
    now,
    membershipKeys: membershipKeysFromOrders([]),
    lastWaAt: now - 60 * 1000,
  });
  assert.equal(gap.action, 'wait');
  assert.equal(gap.reason, 'wa_gap');
  assert.ok(WA_GAP_MS === 2 * 60 * 1000);
});

test('job check_sale essai-abo + suffixe', () => {
  const job = essaiCheckSaleJob(essai());
  assert.equal(job.action, 'check_sale');
  assert.equal(job.essai_followup, true);
  assert.equal(job.order_id, 'BC-ESSAI-1#essai-abo');
  assert.equal(stripEssaiAboSuffix(job.order_id), 'BC-ESSAI-1');
  assert.equal(job.customer.last_name, 'Durand');
});

test('callback Deciplus sans abo → ready, avec abo → converted', async () => {
  const store = new Map();
  const trial = essai();
  store.set(trial.order_id, { ...trial });
  const deps = {
    loadOrder: async (id) => store.get(id) || null,
    saveOrder: async (order) => {
      store.set(order.order_id, order);
      return order;
    },
  };
  await applyEssaiAboCheck(trial.order_id, { has_abo: false, deciplus_member_id: '99' }, deps);
  assert.equal(store.get(trial.order_id).essai_followup_status, 'ready');
  assert.equal(store.get(trial.order_id).essai_has_abo, false);
  await applyEssaiAboCheck(`${trial.order_id}#essai-abo`, { has_abo: true }, deps);
  assert.equal(store.get(trial.order_id).essai_followup_status, 'converted');
});

test('dispatch : relance client avant J+3, 1 WhatsApp max', async () => {
  const paid = Date.parse('2026-08-27T10:00:00.000Z');
  const now = paid + 2 * 60 * 60 * 1000;
  const trial = essai({
    payment: { status: 'paid', paid_at: new Date(paid).toISOString(), amount: 10 },
  });
  const store = new Map([[trial.order_id, { ...trial }]]);
  const sent = [];
  const mails = [];
  const out = await dispatchDueEssaiFollowups({
    now,
    listOrders: async () => [...store.values()],
    loadOrder: async (id) => store.get(id),
    saveOrder: async (order) => {
      store.set(order.order_id, order);
      return order;
    },
    sendWa: async (phone, message) => {
      sent.push({ phone, message });
      return { sent: true };
    },
    sendEmail: async (payload) => {
      mails.push(payload);
      return { sent: true };
    },
    forwardJob: async () => ({ forwarded: true }),
  });
  assert.equal(sent.length, 1);
  assert.equal(mails.length, 1);
  assert.equal(sent[0].phone, '0612345678');
  assert.equal(store.get(trial.order_id).essai_customer_nudges.length, 1);
  assert.equal(out.customer_nudges, 1);
  assert.equal(out.sent, 0);
});

test('dispatch : 1 WhatsApp max, 2 min, Portet / St-Cyprien / Minimes', async () => {
  const now = Date.parse('2026-08-28T12:00:00.000Z');
  const orders = [
    essai({
      order_id: 'BC-MIN',
      customer_full: { gym: 'minimes' },
      essai_abo_checked_at: '2026-08-24T10:00:00.000Z',
      essai_has_abo: false,
      essai_followup_status: 'ready',
      essai_customer_nudges: [
        { day: 1, at: '2026-08-20T10:05:00.000Z' },
        { day: 2, at: '2026-08-21T10:05:00.000Z' },
        { day: 3, at: '2026-08-22T10:05:00.000Z' },
      ],
    }),
    essai({
      order_id: 'BC-POR',
      customer_full: { gym: 'portet' },
      customer_short: {
        first_name: 'Léo',
        last_name: 'Martin',
        email: 'leo@example.com',
        phone: '0699999999',
      },
      essai_abo_checked_at: '2026-08-24T10:00:00.000Z',
      essai_has_abo: false,
      essai_followup_status: 'ready',
    }),
    essai({
      order_id: 'BC-CYP',
      customer_full: { gym: 'st-cyprien' },
      customer_short: {
        first_name: 'Nina',
        last_name: 'Rossi',
        email: 'nina@example.com',
        phone: '0688888888',
      },
      essai_abo_checked_at: '2026-08-24T10:00:00.000Z',
      essai_has_abo: false,
      essai_followup_status: 'ready',
    }),
  ];
  const store = new Map(orders.map((o) => [o.order_id, { ...o }]));
  const sent = [];
  const out = await dispatchDueEssaiFollowups({
    now,
    listOrders: async () => [...store.values()],
    loadOrder: async (id) => store.get(id),
    saveOrder: async (order) => {
      store.set(order.order_id, order);
      return order;
    },
    sendWa: async (phone, message) => {
      sent.push({ phone, message });
      return { sent: true };
    },
    forwardJob: async () => ({ forwarded: true }),
  });
  assert.equal(sent.length, 1, 'un seul WhatsApp par tick (2 min)');
  assert.equal(sent[0].phone, '+33767919166');
  assert.equal(store.get('BC-MIN').essai_followup_status, 'sent');
  assert.equal(store.get('BC-POR').essai_followup_status, 'ready');
  assert.equal(out.sent, 1);
});
