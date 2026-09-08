'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  contractStartDate,
  isPendingOrFutureContract,
  isSameDayStartContract,
  isAppliquerQuitterLabel,
} = require('../bot/cancel-sale');

const DUO_TODAY =
  'OFFRE DUO 29€ CONTRAT N°C2026-043663 vendu le 07/09/2026 07/09/2026 08/08/2027 3';

test('date de début = 2e date après « vendu le », pas la date de vente', () => {
  const start = contractStartDate('OFFRE DUO vendu le 06/09/2026 07/09/2026 08/08/2027');
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 8);
  assert.equal(start.getDate(), 7);
});

test('contrat vendu et commencé aujourd’hui → Annuler la vente, pas Résilier', () => {
  const now = new Date(2026, 8, 7);
  assert.equal(isSameDayStartContract(DUO_TODAY, now), true);
  assert.equal(isPendingOrFutureContract(DUO_TODAY), false);
});

test('libellés Appliquer et Quitter Nextgen (bouton, lien, casse, newline)', () => {
  assert.equal(isAppliquerQuitterLabel('Appliquer et Quitter'), true);
  assert.equal(isAppliquerQuitterLabel('Appliquer et quitter'), true);
  assert.equal(isAppliquerQuitterLabel('Appliquer et Fermer'), true);
  assert.equal(isAppliquerQuitterLabel('Appliquer\net Quitter'), true);
  assert.equal(isAppliquerQuitterLabel('Appliquer'), true);
  assert.equal(isAppliquerQuitterLabel('Annuler la vente'), false);
  assert.equal(isAppliquerQuitterLabel('Résilier'), false);
});
