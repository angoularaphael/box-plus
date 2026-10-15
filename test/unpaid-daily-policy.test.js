'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideUnpaidDailyAction, addHoursToFrDate } = require('../lib/unpaid-daily-policy');
const { SEPA_REASON } = require('../lib/sepa-unpaid-policy');

test('AM04 premier impaye -> grace unique +72h', () => {
  const d = decideUnpaidDailyAction(
    {
      unpaid_count: 1,
      dates: ['07/10/2026'],
      entries: [{ eid: '999', date: '07/10/2026' }],
      remarks: ['AM04 Provision insuffisante'],
    },
    null,
    new Date('2026-10-15T12:00:00+02:00')
  );
  assert.equal(d.action, 'grace');
  assert.equal(d.why, 'am04_first_grace');
  assert.equal(d.newDue, addHoursToFrDate('07/10/2026').fr);
});

test('MS02 -> resiliation immediate', () => {
  const d = decideUnpaidDailyAction(
    {
      unpaid_count: 1,
      remarks: ['MS02 Refus du debiteur / Blocage volontaire'],
      entries: [{ eid: '1', date: '07/10/2026' }],
    },
    null,
    new Date()
  );
  assert.equal(d.action, 'resiliate');
  assert.equal(d.why, 'sepa_immediate');
});

test('AM04 apres grace expiree -> resiliation', () => {
  const grace = {
    reported_at: '2026-10-08T15:00:00.000Z',
    failed_due: '07/10/2026',
    new_due: '10/10/2026',
    new_due_ms: addHoursToFrDate('07/10/2026').ms,
  };
  const d = decideUnpaidDailyAction(
    {
      unpaid_count: 1,
      dates: ['07/10/2026'],
      entries: [{ eid: '999', date: '07/10/2026' }],
      remarks: ['AM04 Provision insuffisante'],
    },
    grace,
    new Date('2026-10-11T10:00:00+01:00')
  );
  assert.equal(d.action, 'resiliate');
  assert.equal(d.why, 'am04_grace_expired');
});

test('AM04 en cours de grace -> attendre', () => {
  const grace = {
    reported_at: '2026-10-08T15:00:00.000Z',
    failed_due: '07/10/2026',
    new_due: '10/10/2026',
    new_due_ms: addHoursToFrDate('07/10/2026').ms,
  };
  const d = decideUnpaidDailyAction(
    {
      unpaid_count: 1,
      remarks: ['AM04 Provision insuffisante'],
      entries: [{ eid: '999', date: '07/10/2026' }],
    },
    grace,
    new Date('2026-10-09T10:00:00+02:00')
  );
  assert.equal(d.action, 'skip');
  assert.equal(d.why, 'am04_in_grace');
});

test('sans remarque SEPA -> skip en attente detail', () => {
  const d = decideUnpaidDailyAction({ unpaid_count: 1, entries: [{ eid: '1', date: '01/10/2026' }] }, null);
  assert.equal(d.action, 'skip');
  assert.equal(d.sepaReasons.length, 0);
});
