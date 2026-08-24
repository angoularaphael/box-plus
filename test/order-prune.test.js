'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isEmptyIdentityAbandon,
  isUnpaidDuplicateOfPaid,
  paidEmailsFrom,
  ordersToPrune,
} = require('../storefront/lib/order-prune');

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

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
  it('ne touche pas un brouillon identité encore en cours de saisie', () => {
    assert.equal(
      isEmptyIdentityAbandon(
        ghost('BC-LIVE', { created_at: hoursAgo(0.5), updated_at: hoursAgo(0.5) })
      ),
      false
    );
  });

  it('supprime les arrêts identité sans nom ni email après plusieurs heures', () => {
    const old = ghost('BC-1', { created_at: hoursAgo(7), updated_at: hoursAgo(7) });
    assert.equal(isEmptyIdentityAbandon(old), true);
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

  it('ne traite pas un ancien abo (suspendu / résilié) comme un doublon à supprimer', () => {
    const paidLongAgo = ghost('BC-PAY', {
      step: 8,
      payment: { status: 'paid', paid_at: hoursAgo(24 * 10) },
      customer_short: { first_name: 'Diego', email: 'd@test.local' },
      signature: { signed_at: hoursAgo(24 * 10) },
    });
    const returning = ghost('BC-NEW', {
      step: 4,
      created_at: hoursAgo(0.1),
      updated_at: hoursAgo(0.1),
      customer_short: { first_name: 'Diego', email: 'd@test.local' },
    });
    const other = ghost('BC-OTH', {
      step: 4,
      customer_short: { first_name: 'Léa', email: 'lea@test.local' },
    });
    const paidEmails = paidEmailsFrom([paidLongAgo, returning, other]);
    assert.equal(paidEmails.has('d@test.local'), true);
    assert.equal(isUnpaidDuplicateOfPaid(returning, paidEmails), true);
    const doomed = ordersToPrune([paidLongAgo, returning, other]);
    assert.deepEqual(
      doomed.map((o) => o.order_id),
      []
    );
  });

  it('supprime seulement un vrai doublon d’onglet juste après un paiement', () => {
    const justPaid = ghost('BC-PAY', {
      step: 8,
      payment: { status: 'paid', paid_at: hoursAgo(1) },
      customer_short: { first_name: 'Diego', email: 'd@test.local' },
      signature: { signed_at: hoursAgo(1) },
    });
    const otherTab = ghost('BC-DUP', {
      step: 4,
      customer_short: { first_name: 'Diego', email: 'd@test.local' },
    });
    const doomed = ordersToPrune([justPaid, otherTab, ghost('BC-EMPTY', { created_at: hoursAgo(8), updated_at: hoursAgo(8) })]);
    assert.deepEqual(
      doomed.map((o) => o.order_id).sort(),
      ['BC-DUP', 'BC-EMPTY']
    );
  });
});
