'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isPortetOrder, portetDossierCc, materielClubCc } = require('../storefront/lib/mailer');
const { decodePayload, OFFER_LABELS } = require('../storefront/lib/echeancier-pay');
const { isOpsOrder } = require('../lib/bot-forward');

describe('Portet dossier CC', () => {
  it('copie nobleartportesien pour une inscription Portet', () => {
    const order = {
      customer_short: { email: 'adrien@example.com' },
      customer_full: { gym: 'portet' },
    };
    assert.equal(isPortetOrder(order), true);
    assert.deepEqual(portetDossierCc(order), ['nobleartportesien@gmail.com']);
  });

  it('pas de copie pour Minimes', () => {
    assert.equal(isPortetOrder({ customer_full: { gym: 'minimes' } }), false);
    assert.deepEqual(portetDossierCc({ customer_full: { gym: 'minimes' } }), []);
  });
});

describe('CC club matériel', () => {
  it('copie boxingcenter31 pour toutes les salles', () => {
    for (const gym of ['minimes', 'portet', 'st-cyprien', 'ramonville', 'etats-unis']) {
      assert.deepEqual(
        materielClubCc({ customer: { email: 'client@example.com' }, pickup_gym: gym }),
        ['boxingcenter31@gmail.com']
      );
    }
  });

  it('ne se copie pas si le client est déjà boxingcenter31', () => {
    assert.deepEqual(
      materielClubCc({ customer: { email: 'boxingcenter31@gmail.com' } }),
      []
    );
  });
});

describe('echeancier pay token payload', () => {
  it('décode l’offre 29 / 36 / 44', () => {
    const info = decodePayload({
      m: '15914',
      e: 'a@b.c',
      p: 'Pierre',
      n: 'Blanc',
      a: 2999,
      g: 'minimes',
      o: '29',
      x: Math.floor(Date.now() / 1000) + 3600,
    });
    assert.equal(info.offer_label, OFFER_LABELS['29']);
    assert.equal(info.portet, false);
    assert.equal(info.amount_cents, 2999);
  });

  it('Portet = PayPal', () => {
    const info = decodePayload({ m: '1', a: 4499, g: 'portet', o: '44' });
    assert.equal(info.portet, true);
  });
});

describe('bot-forward ops', () => {
  it('route encaisser vers le bot ops', () => {
    assert.equal(isOpsOrder({ action: 'encaisser' }), true);
    assert.equal(isOpsOrder({ action: 'echeancier' }), true);
    assert.equal(isOpsOrder({ action: 'balma_switch' }), true);
    assert.equal(isOpsOrder({ action: 'sale' }), false);
  });
});
