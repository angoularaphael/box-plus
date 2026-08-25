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
  listAllOrders,
  toAdminSummary,
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

  it('sortAdminOrders — États-Unis en premier, puis plus récent', () => {
    const { sortAdminOrders } = require('../storefront/lib/order-lifecycle');
    const sorted = sortAdminOrders([
      { gym: 'minimes', created_at: '2026-08-25T12:00:00.000Z', order_id: 'BC-1' },
      { gym: 'etats-unis', created_at: '2026-08-13T12:00:00.000Z', order_id: 'BC-2' },
      { gym: 'etats-unis', created_at: '2026-08-25T00:00:00.000Z', order_id: 'BC-3' },
      { gym: 'st-cyprien', created_at: '2026-08-25T13:00:00.000Z', order_id: 'BC-4' },
    ]);
    assert.equal(sorted[0].order_id, 'BC-3');
    assert.equal(sorted[1].order_id, 'BC-2');
    assert.equal(sorted[2].order_id, 'BC-1');
    assert.equal(sorted[3].order_id, 'BC-4');
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
    assert.equal(order.step, 4); // PAYMENT
    assert.ok(order.funnel?.step_entered_at, 'horloge étape posée à la création');
    assert.equal(String(order.funnel.tracked_step), '4');
    const enteredPayment = order.funnel.step_entered_at;
    assert.equal(toAdminSummary(order).can_resume, true);
    assert.equal(toAdminSummary(order).can_pay, true);

    const shortErrors = validateShortForm(order.customer_short);
    assert.equal(shortErrors.length, 0);

    await markPaymentPaid(orderId, { method: 'demo', iban: null });
    const paid = loadOrder(orderId);
    assert.equal(paid.payment.status, 'paid');
    assert.equal(paid.step, 6); // DOSSIER (pas d'IBAN pour séance essai)
    assert.equal(String(paid.funnel.tracked_step), '6');
    assert.ok(paid.funnel.step_entered_at);
    assert.notEqual(paid.funnel.step_entered_at, enteredPayment, 'changement d’étape = nouveau chrono relance');
    assert.equal(toAdminSummary(paid).can_pay, false);

    await updateFullProfile(orderId, {
      gender: 'M',
      gym: 'minimes',
      address: '1 rue Test',
      postal_code: '31000',
      city: 'Toulouse',
      emergency_contact: 'Contact 0600000000',
    });
    const full = loadOrder(orderId);
    assert.equal(full.customer_full.gym, 'minimes');
    assert.equal(full.step, 7); // SIGNATURE

    const signed = await recordSignature(orderId, {
      consent_cgv: true,
      consent_reglement: true,
      ip: '127.0.0.1',
    });
    assert.equal(signed.step, 8); // CONFIRMED
    assert.equal(signed.ready_for_dispatch, true);

    const payload = buildOrderFromLifecycle(signed, product);
    assert.equal(payload.customer.first_name, 'Test');
    assert.equal(payload.gym, 'minimes');
    assert.equal(payload.sale_type, 'carte');
    assert.match(String(payload.deciplus_product_search || ''), /essai/i);

    const { filepath } = await generateContractPdf(signed);
    assert.ok(fs.existsSync(filepath));

    const all = listAllOrders();
    assert.ok(all.some((o) => o.order_id === orderId));
    const summary = toAdminSummary(signed);
    assert.equal(summary.signed, true);
    assert.equal(summary.email, 'lifecycle@test.boxplus.local');
    assert.equal(summary.can_resume, false);
    assert.equal(summary.gym, 'minimes');
    assert.equal(summary.gym_label, 'Minimes');
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
