'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveCancelNeverVoid } = require('../bot/cancel-sale');

test('résiliation web David → toujours Résilier (neverVoid)', () => {
  assert.equal(resolveCancelNeverVoid({}, 'resiliation_web'), true);
  assert.equal(resolveCancelNeverVoid({}, ''), true);
  assert.equal(resolveCancelNeverVoid({ cancelReason: 'resiliation_web' }, 'resiliation_web'), true);
});

test('scripts pendingOnly / forceVoid → peuvent encore annuler la vente', () => {
  assert.equal(resolveCancelNeverVoid({ pendingOnly: true }, 'resiliation_web'), false);
  assert.equal(resolveCancelNeverVoid({ forceVoid: true }, 'resiliation_web'), false);
  assert.equal(resolveCancelNeverVoid({ forceVoid: true }, 'change_badge_policy'), false);
});

test('impayés → neverVoid', () => {
  assert.equal(resolveCancelNeverVoid({}, 'echeancier_impaye'), true);
  assert.equal(resolveCancelNeverVoid({}, 'impaye_sepa'), true);
});

test('cancelOneContract : chaque await voidPendingSaleIfPossible est sous forceVoid', () => {
  const src = fs.readFileSync(path.join(__dirname, '../bot/cancel-sale.js'), 'utf8');
  const parts = src.split('await voidPendingSaleIfPossible');
  assert.equal(parts.length - 1, 4);
  for (let i = 1; i < parts.length; i += 1) {
    assert.match(parts[i - 1].slice(-500), /forceVoid/);
  }
});

test('processCancelJob boutique → neverVoid: true', () => {
  const src = fs.readFileSync(path.join(__dirname, '../bot/index.js'), 'utf8');
  assert.match(src, /cancelSale\(page, memberId, \{[\s\S]*neverVoid:\s*true/);
});
