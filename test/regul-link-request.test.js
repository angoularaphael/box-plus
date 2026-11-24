'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SYNC_SECRET = process.env.SYNC_SECRET || 'secret-test-regul';

const { buildPayUrl } = require('../lib/echeancier-pay-link');
const {
  verifyPayToken,
  decodePayload,
  normalizeRegulRequest,
  regulRequestAllowed,
} = require('../storefront/lib/echeancier-pay');
const { normalizeOrder, validateOrder, getJobId } = require('../lib/normalize');
const { isOpsOrder } = require('../lib/bot-forward');
const { pickKind } = require('../bot/regul-link-request');
const { buildRegulLinkEmail } = require('../storefront/lib/unpaid-am04-email');

test('lien « demande » : valable, sans date de representation, decode en kind demande', () => {
  const url = buildPayUrl({ member_id: '22466', eid: '9001', amount_cents: 2999, kind: 'demande', failed_due: '02/11/2026' });
  assert.ok(url && url.includes('/regulariser?t='));
  const token = decodeURIComponent(url.split('t=')[1]);
  const info = decodePayload(verifyPayToken(token));
  assert.equal(info.kind, 'demande');
  assert.equal(info.member_id, '22466');
  assert.equal(info.amount_cents, 2999);
});

test('pickKind : reprend la grace en cours si la representation est future, sinon demande', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  const grace = { eid: '9001', new_due: '30/11/2026', new_due_ms: Date.parse('2026-11-30T10:00:00Z') };
  assert.deepEqual(pickKind(grace, '9001', now), { kind: 'grace', new_due: '30/11/2026' });
  assert.deepEqual(pickKind(grace, '1234', now), { kind: 'demande' });
  assert.deepEqual(pickKind(null, '9001', now), { kind: 'demande' });
});

test('demande boutique : nettoyage des champs et date ISO obligatoire', () => {
  const r = normalizeRegulRequest({ first_name: '  Juan ', last_name: 'Fajardo', birthdate: '2005-06-08', email: 'A@B.FR' });
  assert.equal(r.first_name, 'Juan');
  assert.equal(r.birthdate, '2005-06-08');
  assert.equal(r.email, 'a@b.fr');
  assert.equal(normalizeRegulRequest({ birthdate: '08/06/2005' }).birthdate, '');
});

test('anti-abus : 3 demandes max par cle sur 15 minutes', () => {
  const key = `test-${Math.random()}`;
  const t0 = Date.now();
  assert.equal(regulRequestAllowed(key, t0), true);
  assert.equal(regulRequestAllowed(key, t0 + 1), true);
  assert.equal(regulRequestAllowed(key, t0 + 2), true);
  assert.equal(regulRequestAllowed(key, t0 + 3), false);
  assert.equal(regulRequestAllowed(key, t0 + 16 * 60 * 1000), true);
});

test('job regul_link : normalise, valide, route vers le bot de maintenance', () => {
  const order = normalizeOrder({
    order_id: 'REGUL-LINK-1',
    action: 'regul_link',
    customer: { first_name: 'Juan', last_name: 'Fajardo', birthdate: '2005-06-08' },
    payment: { status: 'none' },
  });
  assert.equal(order.action, 'regul_link');
  assert.deepEqual(validateOrder(order), []);
  assert.equal(getJobId(order), 'REGUL-LINK-1#regul_link');
  assert.equal(isOpsOrder(order), true);
  const bad = normalizeOrder({ order_id: 'X', action: 'regul_link', customer: { first_name: 'A', last_name: 'B' } });
  assert.ok(validateOrder(bad).some((e) => /naissance/.test(e)));
});

test('mail du lien : montant, date et bouton', () => {
  const m = buildRegulLinkEmail({ firstName: 'Juan', payUrl: 'https://x/regulariser?t=abc', amountCents: 2999, failedDue: '02/11/2026' });
  assert.match(m.text, /29,99/);
  assert.match(m.text, /02\/11\/2026/);
  assert.match(m.html, /https:\/\/x\/regulariser\?t=abc/);
});
