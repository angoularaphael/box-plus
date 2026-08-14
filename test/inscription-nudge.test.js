'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isNudgeDue, completeDeadlineAt } = require('../storefront/lib/inscription-nudge');
const { resolvePaypalLandingPage } = require('../storefront/lib/paypal');

test('landing PayPal : Portet CB = BILLING, compte = LOGIN, 4x = NO_PREFERENCE', () => {
  assert.equal(resolvePaypalLandingPage({ guestCard: true }), 'BILLING');
  assert.equal(resolvePaypalLandingPage({ paymentPlan: 'once' }), 'LOGIN');
  assert.equal(resolvePaypalLandingPage({ paymentPlan: '4x' }), 'NO_PREFERENCE');
  assert.equal(resolvePaypalLandingPage({ paymentPlan: '4x', guestCard: true }), 'NO_PREFERENCE');
});

test('lien de reprise : étape réelle, produit et jeton', () => {
  const prev = process.env.STORE_URL;
  process.env.STORE_URL = 'https://boutique.boxingcenter.fr';
  const { resumeUrl, describeResume, resumeStep } = require('../storefront/lib/inscription-nudge');
  const token = 'a'.repeat(48);
  const order = {
    order_id: 'BC-123',
    access_token: token,
    product_id: 'abo-mensuel',
    step: 3,
    customer_short: { first_name: 'Léa', last_name: 'Martin', email: 'lea@test.local' },
  };
  const url = resumeUrl(order);
  assert.match(url, /^https:\/\/boutique\.boxingcenter\.fr\/inscription\?/);
  assert.match(url, /order=BC-123/);
  assert.match(url, /product=abo-mensuel/);
  assert.match(url, /step=3/);
  assert.match(url, new RegExp(`bc_token=${token}`));
  assert.equal(resumeStep(order), 3);
  const info = describeResume(order);
  assert.equal(info.can_resume, true);
  assert.equal(info.step_label, 'Identité');
  assert.equal(info.email, 'lea@test.local');
  assert.equal(describeResume({ ...order, step: 8 }).can_resume, false);
  assert.equal(resumeUrl(order, { minStep: 5 }).includes('step=5'), true);
  if (prev === undefined) delete process.env.STORE_URL;
  else process.env.STORE_URL = prev;
});

test('relance 30 min : due seulement si payé, incomplet, deadline dépassée', () => {
  const now = Date.parse('2026-08-13T18:00:00.000Z');
  const paid = '2026-08-13T17:20:00.000Z';
  const base = {
    step: 6,
    payment: { status: 'paid', paid_at: paid },
    funnel: { complete_deadline_at: '2026-08-13T17:50:00.000Z' },
  };
  assert.equal(isNudgeDue(base, now), true);
  assert.equal(isNudgeDue({ ...base, step: 8 }, now), false);
  assert.equal(
    isNudgeDue(
      { ...base, funnel: { complete_deadline_at: '2026-08-13T17:50:00.000Z', nudge_sent_at: paid } },
      now
    ),
    false
  );
  assert.equal(
    isNudgeDue(
      {
        ...base,
        funnel: { complete_deadline_at: '2026-08-13T17:50:00.000Z', nudge_queued_at: '2026-08-13T17:59:00.000Z' },
      },
      now
    ),
    false
  );
  assert.equal(
    isNudgeDue(
      {
        ...base,
        funnel: { complete_deadline_at: '2026-08-13T17:50:00.000Z', nudge_queued_at: '2026-08-13T17:50:00.000Z' },
      },
      now
    ),
    true
  );
  assert.equal(isNudgeDue(base, Date.parse('2026-08-13T17:49:00.000Z'), { force: true }), true);
  assert.equal(
    isNudgeDue({ ...base, payment: { status: 'pending', paid_at: paid } }, now),
    false
  );
  assert.equal(
    completeDeadlineAt({ payment: { paid_at: paid }, funnel: { complete_deadline_at: '2026-08-13T17:50:00.000Z' } }),
    '2026-08-13T17:50:00.000Z'
  );
});
