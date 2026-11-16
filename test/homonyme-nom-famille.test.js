'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { namesClose, firstNamesCompatible, memberSearchHitMatches } = require('../lib/deciplus-member-format');

describe('homonymes de nom de famille (Nada / Taha Bellaghzal)', () => {
  it('Nada et Taha ne sont pas une typo', () => {
    assert.equal(namesClose('Nada', 'Taha'), false);
    assert.equal(firstNamesCompatible('Nada', 'Taha'), false);
  });

  it('garde les vraies typos sur noms longs (Lajabi / Ladjabi, Dufou / Duou)', () => {
    assert.equal(namesClose('Lajabi', 'Ladjabi'), true);
    assert.equal(namesClose('Dufou', 'Duou'), true);
  });

  it('refuse la fiche Nada pour une commande Taha (meme nom, autre prenom)', () => {
    const form = { lastName: 'BELLAGHZAL', firstName: 'NADA', email: 'nada@example.com', birth: '' };
    const customer = { last_name: 'Bellaghzal ', first_name: 'Taha', email: 'taha@example.com', birthdate: '1999-07-28' };
    assert.equal(memberSearchHitMatches(form, customer), false);
    assert.equal(memberSearchHitMatches(form, customer, { strictIdentity: true }), false);
  });

  it('mode strict : refuse une fiche sans date de naissance', () => {
    const form = { lastName: 'BELLAGHZAL', firstName: 'TAHA', email: '', birth: '' };
    const customer = { last_name: 'Bellaghzal', first_name: 'Taha', birthdate: '1999-07-28' };
    assert.equal(memberSearchHitMatches(form, customer, { strictIdentity: true }), false);
  });

  it('mode strict : accepte la bonne fiche (nom + prenom + naissance)', () => {
    const form = { lastName: 'BELLAGHZAL', firstName: 'TAHA', email: 'taha@example.com', birth: '28/07/1999' };
    const customer = { last_name: 'Bellaghzal ', first_name: 'Taha', email: 'taha@example.com', birthdate: '1999-07-28' };
    assert.equal(memberSearchHitMatches(form, customer, { strictIdentity: true }), true);
  });
});
