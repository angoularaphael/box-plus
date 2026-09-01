const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCustomOfferProduct,
  prepareCustomOffer,
  landingUrl,
  parsePriceCents,
  normalizeMode,
} = require('../storefront/lib/custom-offer');

test('parsePriceCents accepte euros et virgule', () => {
  assert.equal(parsePriceCents({ price_euros: '39,90' }), 3990);
  assert.equal(parsePriceCents({ price_cents: 25900 }), 25900);
  assert.equal(parsePriceCents({ price_euros: '0' }), null);
});

test('normalizeMode mappe abonnement / prélèvement', () => {
  assert.equal(normalizeMode('comptant'), 'comptant');
  assert.equal(normalizeMode('comptant_4x'), 'comptant_4x');
  assert.equal(normalizeMode('abonnement'), 'abonnement');
  assert.equal(normalizeMode('prelevement'), 'abonnement');
  assert.equal(normalizeMode(''), null);
});

test('buildCustomOfferProduct comptant sans IBAN', () => {
  const p = buildCustomOfferProduct({ price_euros: 80, mode: 'comptant', label: 'Offre Youssef' });
  assert.equal(p.subsection, 'comptant');
  assert.equal(p.requires_iban, false);
  assert.equal(p.supports_installment_choice, false);
  assert.equal(p.price_cents, 8000);
  assert.equal(p.display_name, 'Offre Youssef');
  assert.match(p.id, /^custom-[a-f0-9]+$/);
});

test('buildCustomOfferProduct comptant 1× ou 4×', () => {
  const p = buildCustomOfferProduct({ price_euros: 259, mode: 'comptant_4x' });
  assert.equal(p.subsection, 'comptant');
  assert.equal(p.requires_iban, false);
  assert.equal(p.supports_installment_choice, true);
  assert.equal(p.installments_note, 'En une fois ou en 4× sans frais');
  assert.equal(p.badge, '1× ou 4×');
  assert.equal(p.price_cents, 25900);
});

test('buildCustomOfferProduct allow_4x sur comptant', () => {
  const p = buildCustomOfferProduct({ price_euros: 80, mode: 'comptant', allow_4x: true });
  assert.equal(p.supports_installment_choice, true);
});

test('abonnement ignore le 4×', () => {
  const p = buildCustomOfferProduct({ price_euros: 35, mode: 'abonnement', allow_4x: true });
  assert.equal(p.subsection, 'prelevement');
  assert.equal(p.requires_iban, true);
  assert.equal(p.supports_installment_choice, false);
});

test('buildCustomOfferProduct abonnement avec IBAN', () => {
  const p = buildCustomOfferProduct({ price_euros: 35, mode: 'abonnement' });
  assert.equal(p.subsection, 'prelevement');
  assert.equal(p.requires_iban, true);
  assert.equal(p.duration_label, 'Toutes les 4 semaines');
  assert.equal(p.price_cents, 3500);
});

test('prepareCustomOffer + landingUrl', () => {
  const prepared = prepareCustomOffer({
    price_euros: 49,
    mode: 'comptant',
    first_name: 'Léa',
    gym: 'minimes',
  });
  assert.equal(prepared.source, 'custom_offer');
  assert.equal(prepared.gym, 'minimes');
  assert.equal(prepared.party_size, 1);
  assert.equal(prepared.customer_short.first_name, 'Léa');
  const url = landingUrl(
    { order_id: 'BC-1', access_token: 'abc' },
    'https://boutique.boxingcenter.fr'
  );
  assert.equal(url, 'https://boutique.boxingcenter.fr/offre-perso?order=BC-1&token=abc');
});

test('parsePartySize borne 1–4', () => {
  const { parsePartySize, peopleLabel } = require('../storefront/lib/custom-offer');
  assert.equal(parsePartySize({}), 1);
  assert.equal(parsePartySize({ party_size: 3 }), 3);
  assert.equal(parsePartySize({ party_size: 9 }), 4);
  assert.equal(peopleLabel(2), '2 personnes');
});

test('offre perso 3 personnes + companions', () => {
  const {
    buildCustomOfferProduct,
    parseCompanions,
    validateCompanions,
    buildCustomOfferClubRecap,
    clubCustomOfferEmail,
  } = require('../storefront/lib/custom-offer');
  const p = buildCustomOfferProduct({ price_euros: 120, mode: 'comptant_4x', party_size: 3 });
  assert.equal(p.party_size, 3);
  assert.match(p.description, /3 personnes/);
  const companions = parseCompanions(
    [
      { first_name: 'Marie', last_name: 'Martin', email: 'marie@test.fr', birthdate: '1990-01-02' },
      { first_name: 'Paul', last_name: 'Martin', phone: '0611223344', birthdate: '1992-03-04', gender: 'M' },
    ],
    3
  );
  assert.equal(companions.length, 2);
  assert.deepEqual(validateCompanions(companions, 3, p), []);
  assert.ok(validateCompanions([{ first_name: 'X' }], 3, p).length > 0);
  const recap = buildCustomOfferClubRecap({
    order_id: 'BC-TEST',
    source: 'custom_offer',
    party_size: 3,
    product_snapshot: p,
    customer_short: {
      first_name: 'Léa',
      last_name: 'Durand',
      email: 'lea@test.fr',
      phone: '0601020304',
      birthdate: '1988-05-06',
    },
    customer_full: {
      gender: 'F',
      gym: 'minimes',
      address: '12 rue Test',
      postal_code: '31000',
      city: 'Toulouse',
    },
    payment: { status: 'paid', payment_plan: '4x' },
    companions,
  });
  assert.equal(recap.to, 'boxingcenter31@gmail.com');
  assert.equal(clubCustomOfferEmail(), 'boxingcenter31@gmail.com');
  assert.match(recap.subject, /3 personnes/);
  assert.match(recap.text, /Marie Martin/);
  assert.match(recap.text, /Paul Martin/);
  assert.match(recap.html, /Personne 1 \(payeur\)/);
  assert.match(recap.html, /12 rue Test/);
});
