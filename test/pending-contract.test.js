'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');

describe('isPendingOrFutureContract', () => {
  it('détecte le libellé en attente', () => {
    assert.equal(isPendingOrFutureContract('OFFRE DUO 29€ — EN ATTENTE'), true);
  });

  it('détecte une période qui commence dans le futur', () => {
    assert.equal(
      isPendingOrFutureContract('OFFRE DUO 29€ 20/07/2027 au 19/06/2028'),
      true
    );
  });

  it('garde l’abo en cours', () => {
    assert.equal(
      isPendingOrFutureContract('OFFRE DUO 29€ 19/08/2026 au 19/07/2027'),
      false
    );
  });
});
