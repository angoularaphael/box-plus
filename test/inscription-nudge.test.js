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
    customer_short: { first_name: 'Léa', last_name: 'Martin', email: 'lea@test.local', phone: '0612345678' },
    product_snapshot: { id: 'abo-mensuel', price_cents: 2999, requires_payment: true },
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
  assert.equal(info.phone, '0612345678');
  assert.equal(describeResume({ ...order, step: 8 }).can_resume, false);
  const pay = describeResume(order, { kind: 'pay' });
  assert.equal(pay.kind, 'pay');
  assert.equal(pay.step, 4);
  assert.match(pay.url, /step=4/);
  assert.match(pay.url, /pay=1/);
  assert.equal(pay.can_pay, true);
  assert.equal(
    describeResume(
      { ...order, payment: { status: 'paid' }, product_snapshot: { price_cents: 2999 } },
      { kind: 'pay' }
    ).can_pay,
    false
  );
  assert.equal(resumeUrl(order, { minStep: 5 }).includes('step=5'), true);
  if (prev === undefined) delete process.env.STORE_URL;
  else process.env.STORE_URL = prev;
});

test('mails reprise / relance : vouvoiement, bouton payer visible', () => {
  const prev = process.env.STORE_URL;
  process.env.STORE_URL = 'https://boutique.boxingcenter.fr';
  const {
    resumeEmailSubject,
    resumeEmailHtml,
    resumeWhatsAppText,
    nudgeEmailSubject,
    nudgeEmailHtml,
    nudgeWhatsAppText,
  } = require('../storefront/lib/inscription-nudge');
  const token = 'b'.repeat(48);
  const unpaid = {
    order_id: 'BC-MAIL',
    access_token: token,
    product_id: 'dp-104',
    step: 4,
    customer_short: { first_name: 'Diego', last_name: 'Cardozo', email: 'd@test.local' },
    customer_full: { gym: 'st-cyprien' },
    product_snapshot: { name: 'OFFRE A 29€', price_cents: 2999, requires_payment: true },
    payment: { status: 'failed' },
  };
  const payHtml = resumeEmailHtml(unpaid);
  const paySubject = resumeEmailSubject(unpaid);
  assert.match(paySubject, /payer/i);
  assert.match(payHtml, /Bonjour Diego/);
  assert.match(payHtml, /Payer maintenant/);
  assert.match(payHtml, /carte bancaire/i);
  assert.match(payHtml, /PayPal/);
  assert.match(payHtml, /boutique\.boxingcenter\.fr\/inscription/);
  assert.match(payHtml, /order=BC-MAIL/);
  assert.match(payHtml, /\bvous\b|\bvotre\b/i);
  assert.doesNotMatch(payHtml, /(?:^|[\s>])(?:tu |ton |tes |toi)|t'|Salut /i);
  const payWa = resumeWhatsAppText(unpaid, { kind: 'pay' });
  assert.match(payWa, /Bonjour Diego/);
  assert.match(payWa, /Payez ici/);
  assert.match(payWa, /carte bancaire/i);
  assert.match(payWa, /boutique\.boxingcenter\.fr\/inscription/);
  assert.match(payWa, /order=BC-MAIL/);
  assert.doesNotMatch(payWa, /(?:^|[\s\n])(?:tu |ton |tes |toi)/i);

  const identity = { ...unpaid, step: 3, payment: { status: 'pending' } };
  const resumeHtml = resumeEmailHtml(identity);
  assert.match(resumeHtml, /Reprendre mon inscription/);
  assert.match(resumeHtml, /Identité/);
  assert.match(resumeHtml, /\bvous\b|\bvotre\b/i);
  assert.doesNotMatch(resumeHtml, /(?:^|[\s>])(?:tu |ton |tes |toi)|t'|Salut /i);
  const resumeWa = resumeWhatsAppText(identity);
  assert.match(resumeWa, /Reprenez exactement là où vous en étiez/);
  assert.match(resumeWa, /Identité/);
  assert.doesNotMatch(resumeWa, /(?:^|[\s\n])(?:tu |ton |tes |toi)/i);

  const paid = {
    ...unpaid,
    step: 6,
    payment: { status: 'paid', paid_at: '2026-08-16T08:00:00.000Z' },
  };
  const nudgeHtml = nudgeEmailHtml(paid);
  assert.match(nudgeEmailSubject(), /validez votre inscription/i);
  assert.match(nudgeHtml, /Bonjour Diego/);
  assert.match(nudgeHtml, /Terminer mon inscription/);
  assert.match(nudgeHtml, /dossier et la signature/);
  assert.match(nudgeHtml, /boutique\.boxingcenter\.fr\/inscription/);
  assert.match(nudgeHtml, /\bvous\b|\bvotre\b/i);
  assert.doesNotMatch(nudgeHtml, /(?:^|[\s>])(?:tu |ton |tes |toi)|t'|Salut /i);
  const wa = nudgeWhatsAppText(paid);
  assert.match(wa, /Bonjour Diego/);
  assert.match(wa, /dossier et la signature/);
  assert.match(wa, /boutique\.boxingcenter\.fr\/inscription/);
  assert.match(wa, /Terminez votre inscription/);
  assert.doesNotMatch(wa, /(?:^|[\s\n])(?:tu |ton |tes |toi)/i);
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
    true,
    'email déjà parti → encore dû pour le WhatsApp'
  );
  assert.equal(
    isNudgeDue(
      {
        ...base,
        funnel: {
          complete_deadline_at: '2026-08-13T17:50:00.000Z',
          nudge_email_sent_at: paid,
          nudge_whatsapp_sent_at: paid,
        },
      },
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
        funnel: { complete_deadline_at: '2026-08-13T17:50:00.000Z', nudge_queued_at: '2026-08-13T17:59:00.000Z' },
      },
      now,
      { force: true }
    ),
    true,
    'force ignore le cooldown de file'
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
