'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  changePendingId,
  saveMembershipChangePending,
  loadMembershipChangePending,
} = require('../storefront/lib/membership');

describe('membership change pending payment', () => {
  it('changePendingId sanitize', () => {
    assert.equal(changePendingId('PAY_abc-123'), 'chgpend-PAY_abc-123');
    assert.match(changePendingId('weird/id!'), /^chgpend-/);
  });

  it('save + load pending change payload', async () => {
    const ref = `test-pp-${Date.now()}`;
    await saveMembershipChangePending(ref, {
      target_product_id: 'comptant-3-mois',
      first_name: 'Ada',
      last_name: 'Lovelace',
      birthdate: '1990-01-15',
      email: 'ada@example.com',
      gym: 'minimes',
      payment_method: 'paypal',
    });
    const loaded = await loadMembershipChangePending(ref);
    assert.ok(loaded);
    assert.equal(loaded.target_product_id, 'comptant-3-mois');
    assert.equal(loaded.first_name, 'Ada');
    assert.equal(loaded.payment_method, 'paypal');
    assert.equal(loaded.payment_ref, ref);
  });
});
