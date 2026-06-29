const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  createDraft,
  loadOrder,
  markPaymentPaid,
  updateFullProfile,
  recordSignature,
  ORDERS_DIR,
} = require('../storefront/lib/order-lifecycle');
const { getEnrichedProducts, getFeaturedProducts, findEnrichedProduct } = require('../storefront/lib/merch');
const { buildOrderFromLifecycle, validateShortForm, validateFullForm } = require('../storefront/lib/orders');
const { generateContractPdf } = require('../storefront/lib/contract-pdf');

describe('lifecycle tunnel', () => {
  let orderId;

  it('merch includes seance-essai manual product', () => {
    const p = findEnrichedProduct('seance-essai');
    assert.ok(p);
    assert.equal(p.price_cents, 1000);
    assert.equal(p.tab, 'seance-essai');
  });

  it('featured products max 3', () => {
    const featured = getFeaturedProducts(3);
    assert.ok(featured.length <= 3);
  });

  it('draft → pay → profile → sign flow', async () => {
    const product = findEnrichedProduct('seance-essai');
    const order = createDraft({
      product_id: 'seance-essai',
      product,
      customer_short: {
        first_name: 'Test',
        last_name: 'Lifecycle',
        email: 'lifecycle@test.boxplus.local',
        phone: '0612345678',
        birthdate: '1990-01-01',
      },
    });
    orderId = order.order_id;
    assert.equal(order.step, 2);

    const shortErrors = validateShortForm(order.customer_short);
    assert.equal(shortErrors.length, 0);

    markPaymentPaid(orderId, { method: 'demo', iban: null });
    const paid = loadOrder(orderId);
    assert.equal(paid.payment.status, 'paid');
    assert.equal(paid.step, 4);

    updateFullProfile(orderId, {
      gender: 'M',
      gym: 'minimes',
      address: '1 rue Test',
      postal_code: '31000',
      city: 'Toulouse',
      emergency_contact: 'Contact 0600000000',
    });
    const full = loadOrder(orderId);
    assert.equal(full.customer_full.gym, 'minimes');

    const signed = recordSignature(orderId, {
      consent_cgv: true,
      consent_reglement: true,
      ip: '127.0.0.1',
    });
    assert.equal(signed.step, 6);
    assert.equal(signed.ready_for_dispatch, true);

    const payload = buildOrderFromLifecycle(signed, product);
    assert.equal(payload.customer.first_name, 'Test');
    assert.equal(payload.gym, 'minimes');

    const { filepath } = await generateContractPdf(signed);
    assert.ok(fs.existsSync(filepath));
  });

  after(() => {
    if (orderId) {
      const f = path.join(ORDERS_DIR, `${orderId}.json`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });
});

describe('enriched catalog', () => {
  it('abonnements prelevement filter', () => {
    const items = getEnrichedProducts({ tab: 'abonnements', subsection: 'prelevement' });
    assert.ok(items.length >= 1);
    assert.ok(items.every((p) => p.subsection === 'prelevement'));
  });

  it('coachings tab has 3 packs', () => {
    const items = getEnrichedProducts({ tab: 'coachings' });
    assert.ok(items.length >= 3);
  });
});
