const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BLADE_ID,
  BLADE_PRICE_CENTS,
  adultAboEligible,
  shouldOfferUpsell,
  mergeBladeIntoList,
  isBladeProductId,
  buildUpsellForOrder,
} = require('../storefront/lib/blade-upsell');
const { getMaterielProducts, findMaterielProduct } = require('../storefront/lib/merch');

test('gants Blade sont en première position du catalogue matériel', () => {
  const products = getMaterielProducts({ activeOnly: true });
  assert.equal(products.length, 12);
  assert.equal(products[0].id, BLADE_ID);
  assert.equal(products[1].id, 'mat-pack-enfants');
  assert.equal(products[0].price_cents, BLADE_PRICE_CENTS);
  assert.equal(products[0].combinations.length, 6);
});

test('findMaterielProduct retrouve Blade par id et par slug', () => {
  const byId = findMaterielProduct(BLADE_ID);
  const bySlug = findMaterielProduct('gants-boxe-blade-noir-blanc');
  const byLegacy = findMaterielProduct('gants-boxe-blade-gold-blanc-noir');
  assert.equal(byId.id, BLADE_ID);
  assert.equal(bySlug.id, BLADE_ID);
  assert.equal(byLegacy.id, BLADE_ID);
  assert.ok(byId.combinations.some((c) => c.id.includes('10oz')));
  assert.ok(byId.combinations.some((c) => c.id.includes('12oz')));
  assert.ok(byId.combinations.some((c) => c.id.includes('14oz')));
  assert.match(byId.pickup_note, /Minimes/);
  assert.match(byId.pickup_hours, /17h–21h/);
});

test('Blade n’apparaît que dans destockage / tout', () => {
  const destock = getMaterielProducts({ category: 'destockage', activeOnly: true });
  assert.ok(destock.some((p) => p.id === BLADE_ID));
  const gants = getMaterielProducts({ category: 'gants', activeOnly: true });
  assert.ok(!gants.some((p) => p.id === BLADE_ID));
});

test('upsell uniquement après paiement d’un abo adulte ou essai', () => {
  assert.equal(adultAboEligible({ tab: 'abonnements', subsection: 'comptant' }), true);
  assert.equal(adultAboEligible({ tab: 'seance-essai', subsection: 'essai' }), true);
  assert.equal(adultAboEligible({ subsection: 'comptant' }), true);
  assert.equal(adultAboEligible({ subsection: 'prelevement' }), true);
  assert.equal(adultAboEligible({ subsection: 'promo' }), true);
  assert.equal(adultAboEligible({ tab: 'abonnements', subsection: 'enfants' }), false);
  assert.equal(adultAboEligible({ tab: 'coachings', subsection: 'coaching' }), false);

  const base = {
    payment: { status: 'paid' },
    product_snapshot: { tab: 'abonnements', subsection: 'prelevement' },
  };
  assert.equal(shouldOfferUpsell(base), true);
  assert.equal(shouldOfferUpsell({ ...base, addons: { blade: { status: 'skipped' } } }), false);
  assert.equal(shouldOfferUpsell({ ...base, addons: { blade: { status: 'paid' } } }), false);
  assert.equal(shouldOfferUpsell({ ...base, signature: { signed_at: '2026-08-29' } }), false);
  assert.equal(
    shouldOfferUpsell({
      payment: { status: 'paid' },
      product_snapshot: { tab: 'abonnements', subsection: 'enfants' },
    }),
    false
  );
});

test('mergeBladeIntoList déduplique et pin en tête', () => {
  const merged = mergeBladeIntoList([{ id: 'mat-37', name: 'Bandes' }]);
  assert.equal(merged[0].id, BLADE_ID);
  assert.equal(merged.filter((p) => isBladeProductId(p.id)).length, 1);
});

test('buildUpsellForOrder expose le produit quand éligible', () => {
  const shown = buildUpsellForOrder({
    payment: { status: 'paid' },
    product_snapshot: { tab: 'abonnements', subsection: 'comptant' },
  });
  assert.equal(shown.show, true);
  assert.equal(shown.product.price_cents, 1790);
  const hidden = buildUpsellForOrder({
    payment: { status: 'pending' },
    product_snapshot: { tab: 'abonnements', subsection: 'comptant' },
  });
  assert.equal(hidden.show, false);
});
