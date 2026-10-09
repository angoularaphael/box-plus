'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCancelConfirmationEmail,
  formatCancelDateFr,
  isChangeCancelReason,
  sendCancelConfirmationEmail,
} = require('../storefront/lib/membership');

test('formatCancelDateFr accepte ISO et FR', () => {
  assert.equal(formatCancelDateFr('2026-10-09'), '09/10/2026');
  assert.equal(formatCancelDateFr('09/10/2026'), '09/10/2026');
  assert.equal(formatCancelDateFr(''), null);
});

test('changement comptant : pas de mail résiliation', () => {
  assert.equal(isChangeCancelReason('change_to_comptant'), true);
  assert.equal(isChangeCancelReason('change_plan'), true);
  assert.equal(isChangeCancelReason('resiliation_web'), false);
});

test('contenu confirmation résiliation avec date', () => {
  const mail = buildCancelConfirmationEmail(
    { first_name: 'Camille' },
    { cancelDate: '2026-10-31' }
  );
  assert.equal(mail.subject, 'Confirmation de résiliation — Boxing Center');
  assert.match(mail.html, /Bonjour Camille/);
  assert.match(mail.html, /31\/10\/2026/);
  assert.match(mail.html, /résiliation/i);
  assert.match(mail.html, /Boxing Center/);
});

test('sendCancelConfirmationEmail ignore change_to_comptant', async () => {
  const out = await sendCancelConfirmationEmail(
    { email: 'x@example.com', first_name: 'X' },
    { cancelReason: 'change_to_comptant', cancelDate: '2026-10-09' }
  );
  assert.equal(out.sent, false);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'change_cancel');
});
