'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CLUB,
  CLUB_PORTET,
  clubForGym,
  clubForOrder,
  clubEmitterRows,
} = require('../storefront/lib/pdf-layout');

describe('émetteur facture', () => {
  it('Portet = association Noble Art Portésien', () => {
    const club = clubForOrder({ customer_full: { gym: 'portet' } });
    assert.equal(club, CLUB_PORTET);
    assert.equal(club.name, 'NOBLE ART PORTESIEN');
    assert.equal(club.legalForm, 'Association loi 1901');
    assert.equal(club.address, "61 route d'Espagne");
    assert.equal(club.city, '31120 Portet-sur-Garonne');
    assert.equal(club.siren, '444 152 482');
    assert.equal(club.siret, '444 152 482 00022');
    assert.equal(club.tva, 'FR80444152482');
    assert.equal(club.naf, '9312Z');
  });

  it('détecte Portet via salle de retrait matériel', () => {
    assert.equal(clubForOrder({ pickup_gym: 'portet' }), CLUB_PORTET);
    assert.equal(clubForGym('Boxing Center Portet'), CLUB_PORTET);
  });

  it('Minimes / autres salles = SAS Boxing Center', () => {
    assert.equal(clubForOrder({ customer_full: { gym: 'minimes' } }), CLUB);
    assert.equal(clubForGym('ramonville'), CLUB);
    assert.equal(CLUB.siret, '821 817 889 00016');
  });

  it('bloc émetteur Portet contient SIREN, SIRET, TVA et NAF', () => {
    const rows = clubEmitterRows(CLUB_PORTET);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    assert.equal(byLabel.Association, 'NOBLE ART PORTESIEN');
    assert.equal(byLabel['Forme juridique'], 'Association loi 1901');
    assert.match(byLabel.Adresse, /61 route d'Espagne/);
    assert.match(byLabel.Adresse, /31120 Portet-sur-Garonne/);
    assert.equal(byLabel.SIREN, '444 152 482');
    assert.equal(byLabel.SIRET, '444 152 482 00022');
    assert.equal(byLabel.TVA, 'FR80444152482');
    assert.equal(byLabel['NAF / APE'], '9312Z');
  });
});
