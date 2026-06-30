const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isMfaAuthError } = require('../bot/auth');

describe('auth guard', () => {
  it('détecte les erreurs MFA / cooldown sans retry', () => {
    assert.equal(isMfaAuthError('Code email Deciplus requis — DECIPLUS_EMAIL_CODE'), true);
    assert.equal(isMfaAuthError('Connexion Deciplus en cooldown (8 min)'), true);
    assert.equal(isMfaAuthError('Échec vente badge modal'), false);
  });
});
