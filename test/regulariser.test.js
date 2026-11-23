'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('lien /regulariser', () => {
  before(() => {
    process.env.SYNC_SECRET = process.env.SYNC_SECRET || 'secret-test-regulariser';
    process.env.BOXPLUS_STORE_URL = 'https://boutique.test';
  });

  it('grace : la boutique relit fiche, echeance, montant et dates', () => {
    const { buildPayUrl } = require('../lib/echeancier-pay-link');
    const { verifyPayToken, decodePayload } = require('../storefront/lib/echeancier-pay');
    const url = buildPayUrl(
      {
        member_id: '23337',
        eid: '249217',
        amount_cents: 3699,
        email: 'a@b.fr',
        prenom: 'Test',
        gym: 'minimes',
        product: 'Etudiants 36,99€/4 semaines',
        failed_due: '20/12/2026',
        new_due: '23/12/2026',
        kind: 'grace',
      },
      Date.parse('2026-12-20T15:00:00Z')
    );
    assert.match(url, /^https:\/\/boutique\.test\/regulariser\?t=/);
    const token = decodeURIComponent(url.split('t=')[1]);
    // verifyPayToken compare l'expiration a maintenant : le lien de test vise decembre 2026.
    const realNow = Date.now;
    Date.now = () => Date.parse('2026-12-21T10:00:00Z');
    try {
      const info = decodePayload(verifyPayToken(token));
      assert.equal(info.member_id, '23337');
      assert.equal(info.eid, '249217');
      assert.equal(info.amount_cents, 3699);
      assert.equal(info.kind, 'grace');
      assert.equal(info.failed_due, '20/12/2026');
      assert.equal(info.new_due, '23/12/2026');
    } finally {
      Date.now = realNow;
    }
  });

  it('grace : plus de lien la veille de la nouvelle presentation', () => {
    const { buildPayUrl } = require('../lib/echeancier-pay-link');
    const url = buildPayUrl(
      { member_id: '1', eid: '2', amount_cents: 100, kind: 'grace', new_due: '23/12/2026' },
      Date.parse('2026-12-23T08:00:00Z')
    );
    assert.equal(url, null);
  });

  it('sans echeance ni montant : pas de lien', () => {
    const { buildPayUrl } = require('../lib/echeancier-pay-link');
    assert.equal(buildPayUrl({ member_id: '1', amount_cents: 100, kind: 'resilie' }), null);
    assert.equal(buildPayUrl({ member_id: '1', eid: '2', amount_cents: 0, kind: 'resilie' }), null);
  });
});

describe('encaisser : choix de l echeance', () => {
  const { pickTarget } = require('../bot/encaisser-echeance');
  const rows = [
    { eid: '10', date: '20/10/2026', etat: 'I', cents: 3699 },
    { eid: '11', date: '17/11/2026', etat: 'I', cents: 3699 },
    { eid: '12', date: '14/12/2026', etat: 'T', cents: 3699 },
  ];

  it('l echeance du lien en priorite', () => {
    assert.equal(pickTarget(rows, { eid: '12', amountCents: 3699 }).eid, '12');
  });

  it('sinon l impaye le plus recent du meme montant', () => {
    assert.equal(pickTarget(rows, { eid: '', amountCents: 3699 }).eid, '11');
  });

  it('aucun impaye du bon montant : rien', () => {
    assert.equal(pickTarget(rows, { eid: '', amountCents: 5000 }), null);
  });
});
