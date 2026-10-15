const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getEnrichedProducts } = require('../storefront/lib/merch');

const key = (p) => p.legacy_id || p.id;

describe('abonnements#promo', () => {
  it('Promotions : 29 € puis 259 € l’année, sans 9 € ni 38,99 €', () => {
    const promo = getEnrichedProducts({ tab: 'abonnements', subsection: 'promo' });
    const ids = promo.map(key);
    assert.ok(!ids.includes('offre-promo-9'), 'offre 9 € retirée');
    assert.ok(!ids.includes('offre-promo-adulte'), 'offre 38,99 € retirée');
    assert.ok(!promo.some((p) => p.price_cents === 900 || p.price_cents === 3899));
    assert.equal(key(promo[0]), 'offre-duo');
    assert.equal(key(promo[1]), 'offre-saison');
    assert.equal(promo[1].price_cents, 25900);
  });

  it('le 259 € reste aussi en Comptant, et garde son onglet d’origine pour le paiement', () => {
    const comptant = getEnrichedProducts({ tab: 'abonnements', subsection: 'comptant' });
    const saison = comptant.find((p) => key(p) === 'offre-saison');
    assert.ok(saison, '259 € toujours en Comptant');
    const promo = getEnrichedProducts({ tab: 'abonnements', subsection: 'promo' });
    assert.equal(promo.find((p) => key(p) === 'offre-saison').subsection, 'comptant');
  });

  it('chaque carte à prélèvement affiche SON prix, pas celui de l’offre 29 €', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'public', 'js', 'offers.js'), 'utf8');
    const window = {};
    const document = {
      readyState: 'loading',
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({}),
    };
    vm.runInNewContext(src, { window, document, localStorage: { getItem: () => null, setItem() {} }, Intl, Date, Math });
    const line = window.BCOffers.formatPaymentMode({
      requires_payment: true,
      supports_billing_choice: true,
      price_label: '44,99 €',
    });
    assert.match(line, /^44,99 € toutes les 4 semaines/);
    assert.doesNotMatch(line, /29 €/);
  });
});
