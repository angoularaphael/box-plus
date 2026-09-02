const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ribAddressFields } = require('../bot/wallet');

const gym = { label: 'St-Cyprien', address: '11 Rue Sainte-Lucie, 31300 Toulouse' };

describe('ribAddressFields', () => {
  it('keeps a real city', () => {
    const addr = ribAddressFields(
      { address: '8 passage de l allier', postal_code: '31170', city: 'Tournefeuille' },
      gym
    );
    assert.equal(addr.city, 'Tournefeuille');
    assert.equal(addr.postal_code, '31170');
  });

  it('falls back to gym when city is the postal code', () => {
    const addr = ribAddressFields(
      { address: '8 passage de l allier', postal_code: '31170', city: '31170' },
      gym
    );
    assert.equal(addr.city, 'Toulouse');
    assert.equal(addr.postal_code, '31300');
    assert.match(addr.address, /Sainte-Lucie/i);
  });
});
