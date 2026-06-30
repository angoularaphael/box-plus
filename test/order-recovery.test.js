const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { packOrderMetadata, buildOrderPayload } = require('../storefront/lib/orders');
const { loadOrder, ORDERS_DIR } = require('../storefront/lib/order-lifecycle');
const { rebuildLifecycleOrderFromSession } = require('../storefront/lib/order-recovery');
const { findEnrichedProduct } = require('../storefront/lib/merch');

describe('order recovery from Stripe', () => {
  it('rebuilds lifecycle order from paid session metadata', async () => {
    const product = findEnrichedProduct('seance-essai');
    const orderId = 'BC-RECOVER-TEST';
    const accessToken = 'abc123token';
    const payload = buildOrderPayload(
      {
        order_id: orderId,
        first_name: 'Jean',
        last_name: 'Dupont',
        email: 'jean@test.boxplus.local',
        phone: '0612345678',
        birthdate: '1990-05-15',
        gym: 'minimes',
        gender: 'M',
      },
      product
    );
    payload.lifecycle_order_id = orderId;

    const session = {
      id: 'cs_test_recovery',
      payment_status: 'paid',
      metadata: {
        product_id: product.id,
        order_id: orderId,
        lifecycle_order_id: orderId,
        bc_token: accessToken,
        ...packOrderMetadata(payload),
      },
    };

    const orderFile = path.join(ORDERS_DIR, `${orderId}.json`);
    if (fs.existsSync(orderFile)) fs.unlinkSync(orderFile);

    const order = await rebuildLifecycleOrderFromSession(session, {
      accessToken,
      findProduct: findEnrichedProduct,
    });

    assert.ok(order);
    assert.equal(order.order_id, orderId);
    assert.equal(order.access_token, accessToken);
    assert.equal(order.step, 4);
    assert.equal(order.payment.status, 'paid');
    assert.equal(order.customer_short.email, 'jean@test.boxplus.local');
    assert.equal(order.recovered_from_stripe, true);

    const fromDisk = loadOrder(orderId);
    assert.ok(fromDisk);
    assert.equal(fromDisk.customer_short.first_name, 'Jean');

    fs.unlinkSync(orderFile);
  });

  it('rejects recovery when token does not match', async () => {
    const product = findEnrichedProduct('seance-essai');
    const payload = buildOrderPayload(
      {
        order_id: 'BC-RECOVER-BAD',
        first_name: 'A',
        last_name: 'B',
        email: 'a@test.local',
        phone: '0600000000',
        birthdate: '1990-01-01',
      },
      product
    );
    payload.lifecycle_order_id = 'BC-RECOVER-BAD';

    const session = {
      id: 'cs_test_bad',
      payment_status: 'paid',
      metadata: {
        product_id: product.id,
        lifecycle_order_id: 'BC-RECOVER-BAD',
        bc_token: 'correct-token',
        ...packOrderMetadata(payload),
      },
    };

    const order = await rebuildLifecycleOrderFromSession(session, {
      accessToken: 'wrong-token',
      findProduct: findEnrichedProduct,
    });
    assert.equal(order, null);
  });
});
