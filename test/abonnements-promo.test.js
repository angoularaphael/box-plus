const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getEnrichedProducts } = require('../storefront/lib/merch');

const key = (p) => p.legacy_id || p.id;

describe('abonnements#promo', () => {
  /* Les offres promo 29 € et 259 € sont retirées de la vente depuis le 19/10/2026.
     Ces deux cas verrouillent leur absence : elles ne doivent revenir ni dans
     l'onglet Promotions, ni dans l'onglet Comptant, ni nulle part ailleurs. */
  it('les offres promo 29 € et 259 € ne sont plus vendues', () => {
    for (const subsection of ['promo', 'comptant', 'prelevement', 'enfants']) {
      const liste = getEnrichedProducts({ tab: 'abonnements', subsection });
      const ids = liste.map(key);
      assert.ok(!ids.includes('offre-duo'), `offre 29 € absente de ${subsection}`);
      assert.ok(!ids.includes('offre-saison'), `offre 259 € absente de ${subsection}`);
      assert.ok(
        !liste.some((p) => p.price_cents === 2900 || p.price_cents === 2999 || p.price_cents === 25900),
        `aucun tarif promo dans ${subsection}`
      );
    }
  });

  it('les formules de référence restent disponibles', () => {
    const tous = ['promo', 'comptant', 'prelevement', 'enfants']
      .flatMap((subsection) => getEnrichedProducts({ tab: 'abonnements', subsection }));
    const prix = tous.map((p) => p.price_cents);
    assert.ok(prix.includes(4499), 'sans engagement 44,99 € toujours vendu');
    assert.ok(prix.includes(40000), 'comptant 12 mois 400 € toujours vendu');
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
