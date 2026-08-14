/**
 * IBAN / RIB français — toutes banques (BNP, BP, CA, SG, Boursorama, etc.).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIban, isValidFrenchIban, frenchIbanError } = require('../lib/iban');

const SAMPLES = [
  { iban: 'FR76 3000 1007 9412 3456 7890 185', label: 'BNP Paribas' },
  { iban: 'FR51 2004 1010 1610 1152 8D03 754', label: 'La Banque Postale (compte avec lettre)' },
  { iban: 'FR14 2004 1010 0505 0001 3M02 606', label: 'La Banque Postale' },
  { iban: 'FR76 3000 6000 0112 3456 7890 189', label: 'exemple courant' },
  { iban: 'FR7630001007941234567890185', label: 'fixture tests' },
];

describe('French IBAN / RIB', () => {
  for (const { iban, label } of SAMPLES) {
    it(`accepts ${label}`, () => {
      assert.strictEqual(isValidFrenchIban(iban), true, frenchIbanError(iban));
    });
  }

  it('rejects foreign IBAN', () => {
    assert.strictEqual(isValidFrenchIban('DE89370400440532013000'), false);
  });

  it('rejects wrong RIB key', () => {
    assert.strictEqual(isValidFrenchIban('FR7630001007941234567890186'), false);
    assert.match(frenchIbanError('FR7630001007941234567890186'), /RIB/i);
  });

  it('rejects too short', () => {
    assert.strictEqual(isValidFrenchIban('FR76300010079412345678901'), false);
    assert.match(frenchIbanError('FR76300010079412345678901'), /27 caract/i);
  });

  it('normalizes spaces', () => {
    assert.strictEqual(normalizeIban('fr 51 2004 1010 1610 1152 8d03 754'), 'FR5120041010161011528D03754');
  });
});
