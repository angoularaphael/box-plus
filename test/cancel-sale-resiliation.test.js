'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveCancelNeverVoid } = require('../bot/cancel-sale');

test('toute résiliation → neverVoid (jamais Annuler la vente)', () => {
  assert.equal(resolveCancelNeverVoid({}, 'resiliation_web'), true);
  assert.equal(resolveCancelNeverVoid({}, ''), true);
  assert.equal(resolveCancelNeverVoid({ pendingOnly: true }, 'resiliation_web'), true);
  assert.equal(resolveCancelNeverVoid({ forceVoid: true }, 'resiliation_web'), true);
  assert.equal(resolveCancelNeverVoid({ forceVoid: true }, 'change_badge_policy'), true);
  assert.equal(resolveCancelNeverVoid({}, 'change_replace_existing'), true);
  assert.equal(resolveCancelNeverVoid({}, 'echeancier_impaye'), true);
});

test('cancel-sale.js ne clique plus Annuler la vente', () => {
  const src = fs.readFileSync(path.join(__dirname, '../bot/cancel-sale.js'), 'utf8');
  assert.doesNotMatch(src, /clickActionTile\(page, \[\s*\/\^Annuler la vente/);
  assert.doesNotMatch(src, /logInfo\('Clic Annuler la vente'/);
  assert.doesNotMatch(src, /vente annulée/);
  assert.match(src, /Clic Annuler la vente interdit — Résilier uniquement/);
  assert.match(src, /if \(\/annuler la vente\/i\.test\(t\)\) continue/);
  assert.doesNotMatch(src, /forceVoid/);
  assert.doesNotMatch(src, /voidPendingSaleIfPossible|confirmAnnulationModal|clickAnnulationRefundMode|shouldVoidSale/);
  assert.match(src, /clickActionTile\(page, \[\/\^Résilier\$\/i/);
});

test('processCancelJob boutique → neverVoid: true', () => {
  const src = fs.readFileSync(path.join(__dirname, '../bot/index.js'), 'utf8');
  assert.match(src, /cancelSale\(page, memberId, \{[\s\S]*neverVoid:\s*true/);
});
