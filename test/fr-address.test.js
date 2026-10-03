'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  hasValidFrenchAddress,
  applyFrenchAddressFallback,
  ribAddressFields,
} = require('../lib/fr-address');

describe('fr-address', () => {
  it('accepte un code postal FR à 5 chiffres', () => {
    assert.equal(
      hasValidFrenchAddress({
        address: '1 rue test',
        postal_code: '31000',
        city: 'Toulouse',
      }),
      true
    );
  });

  it('rejette une adresse irlandaise', () => {
    assert.equal(
      hasValidFrenchAddress({
        address: '51 Rathbawn drive',
        postal_code: 'F23NV29',
        city: 'Castlebar',
        country: 'IE',
      }),
      false
    );
  });

  it('remplace par l’adresse de la salle', () => {
    const out = applyFrenchAddressFallback(
      {
        address: '51 Rathbawn drive',
        postal_code: 'F23NV29',
        city: 'Castlebar',
        country: 'IE',
      },
      { address: '12 rue de Fenouillet, 31200 Toulouse' }
    );
    assert.equal(out.postal_code, '31200');
    assert.equal(out.city, 'Toulouse');
    assert.equal(out.country, 'FR');
    assert.match(out.address2, /Adresse saisie:/);
  });

  it('remplace toute l’adresse hors France par l’adresse réelle par défaut', () => {
    const out = ribAddressFields({
      address: '51 Rathbawn drive',
      postal_code: 'F23NV29',
      city: 'Castlebar',
      country: 'IE',
    });
    assert.equal(out.address, '12 rue de Fenouillet');
    assert.equal(out.postal_code, '31200');
    assert.equal(out.city, 'Toulouse');
    assert.equal(out.country, 'France');
  });

  it('réconcilie Villeneuve-Tolosane coincée dans la rue + ville Toulouse', () => {
    const out = ribAddressFields({
      address: '66 ter route de portet villeneuve tolosone',
      postal_code: '31270',
      city: 'TOULOUSE',
    });
    assert.equal(out.city, 'Villeneuve-Tolosane');
    assert.equal(out.postal_code, '31270');
    assert.equal(out.address, '66 ter route de portet');
  });

  it('rejette un code postal à 5 chiffres si le pays n’est pas la France', () => {
    assert.equal(
      hasValidFrenchAddress({
        address: '10 Main Street',
        postal_code: '10001',
        city: 'New York',
        country: 'United States',
      }),
      false
    );
    const out = applyFrenchAddressFallback(
      {
        address: '10 Main Street',
        postal_code: '10001',
        city: 'New York',
        country: 'US',
      },
      { address: '388 avenue des États-Unis, 31200 Toulouse', label: 'États-Unis' }
    );
    assert.equal(out.address, '388 avenue des États-Unis');
    assert.equal(out.postal_code, '31200');
    assert.equal(out.city, 'Toulouse');
    assert.equal(out.country, 'FR');
    assert.match(out.address2, /10 Main Street/);
  });
});
