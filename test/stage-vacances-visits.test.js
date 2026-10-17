'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStageSrc,
  summarizeVisitRows,
} = require('../storefront/lib/stage-vacances-visits');

test('direct et vide comptent comme e-mail (clic mail sans ?src=)', () => {
  assert.equal(normalizeStageSrc('direct'), 'mail');
  assert.equal(normalizeStageSrc(''), 'mail');
  assert.equal(normalizeStageSrc(null), 'mail');
  assert.equal(normalizeStageSrc('mail'), 'mail');
  assert.equal(normalizeStageSrc('email'), 'mail');
  assert.equal(normalizeStageSrc('sms'), 'sms');
  assert.equal(normalizeStageSrc('ig'), 'ig');
  assert.equal(normalizeStageSrc('flyer'), 'flyer');
});

test('les visites directes fusionnent dans le bucket mail', () => {
  const summary = summarizeVisitRows([
    { src: 'mail', created_at: '2026-10-17T10:00:00.000Z' },
    { src: 'direct', created_at: '2026-10-17T11:00:00.000Z' },
    { src: '', created_at: '2026-10-17T12:00:00.000Z' },
    { src: 'sms', created_at: '2026-10-17T13:00:00.000Z' },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.mail, 3);
  assert.equal(summary.sms, 1);
  assert.equal(summary.direct, 0);
  assert.equal(summary.days[0].mail, 3);
});
