'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isBotErrorOrder,
  classifyBotError,
  botErrorRows,
} = require('../storefront/lib/admin-stats');

describe('bot error detection', () => {
  it('détecte manual_review avec message', () => {
    assert.equal(
      isBotErrorOrder({
        bot_status: 'manual_review',
        bot_error: 'Création membre Deciplus: ID introuvable',
      }),
      true
    );
  });

  it('ignore manual_ok', () => {
    assert.equal(isBotErrorOrder({ bot_status: 'manual_ok' }), false);
  });

  it('classe adresse non FR', () => {
    assert.equal(
      classifyBotError({
        customer_full: { postal_code: 'F23NV29', city: 'Castlebar', address: '51 Rathbawn' },
        bot_error: 'ID introuvable',
      }),
      'adresse_non_fr'
    );
  });

  it('liste les erreurs bot', () => {
    const rows = botErrorRows([
      {
        order_id: 'BC-1',
        bot_status: 'error',
        bot_error: 'fail',
        customer_short: { first_name: 'A', last_name: 'B', phone: '0612345678' },
        customer_full: { gym: 'minimes' },
        payment: { status: 'paid', paid_at: '2026-09-01T10:00:00Z' },
        signature: { signed_at: '2026-09-01T10:05:00Z' },
        product_snapshot: { name: 'OFFRE A 29€' },
      },
      {
        order_id: 'BC-2',
        bot_status: 'success',
        customer_short: { first_name: 'C', last_name: 'D' },
        payment: { status: 'paid', paid_at: '2026-09-02T10:00:00Z' },
        signature: { signed_at: '2026-09-02T10:05:00Z' },
        deciplus_sale_id: '123',
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].order_id, 'BC-1');
    assert.equal(rows[0].phone, '0612345678');
    assert.equal(rows[0].product, 'OFFRE A 29€');
  });
});
