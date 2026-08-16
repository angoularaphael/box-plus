'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isEmptyIdentityAbandon,
  isUnpaidDuplicateOfPaid,
  paidEmailsFrom,
  ordersToPrune,
} = require('../storefront/lib/order-prune');

function ghost(id, extra = {}) {
  return {
    order_id: id,
    access_token: 'tok',
    step: 3,
    payment: { status: 'pending' },
    customer_full: { gym: 'ramonville' },
    product_snapshot: { name: 'OFFRE A 29€' },
    ...extra,
  };
}

describe('order-prune', () => {
  it('supprime les arrêts identité sans nom ni email', () => {
    assert.equal(isEmptyIdentityAbandon(ghost('BC-1')), true);
    assert.equal(
      isEmptyIdentityAbandon(
        ghost('BC-2', { customer_short: { first_name: 'Léa', email: 'lea@test.local' }, step: 3 })
      ),
      false
    );
    assert.equal(
      isEmptyIdentityAbandon(ghost('BC-3', { payment: { status: 'paid' }, step: 3 })),
      false
    );
    assert.equal(isEmptyIdentityAbandon(ghost('BC-4', { step: 6 })), false);
  });

  it('supprime les sessions impayées d’un email déjà payé', () => {
    const paid = ghost('BC-PAY', {
      step: 8,
      payment: { status: 'paid' },
      customer_short: { first_name: 'Diego', email: 'd@test.local' },
      signature: { signed_at: '2026-08-16T10:00:00.000Z' },
    });
    const dupe = ghost('BC-DUP', {
      step: 4,
      customer_short: { first_name: 'Diego', email: 'd@test.local' },
    });
    const other = ghost('BC-OTH', {
      step: 4,
      customer_short: { first_name: 'Léa', email: 'lea@test.local' },
    });
    const paidEmails = paidEmailsFrom([paid, dupe, other]);
    assert.equal(paidEmails.has('d@test.local'), true);
    assert.equal(isUnpaidDuplicateOfPaid(dupe, paidEmails), true);
    assert.equal(isUnpaidDuplicateOfPaid(paid, paidEmails), false);
    assert.equal(isUnpaidDuplicateOfPaid(other, paidEmails), false);
    const doomed = ordersToPrune([paid, dupe, other, ghost('BC-EMPTY')]);
    assert.deepEqual(
      doomed.map((o) => o.order_id).sort(),
      ['BC-DUP', 'BC-EMPTY']
    );
  });
});
