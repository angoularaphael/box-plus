'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { saleContractMatches } = require('../lib/sale-contract-match');

const promo259 = {
  name: 'OFFRE PROMO 12 MOIS',
  deciplus_product_search: 'OFFRE PROMO 12',
};

const monthly = {
  name: '44,99€/4 semaines Sans Engagement',
};

test('259 € n’est pas validé par un abo 44,99 déjà sur la fiche', () => {
  const existing =
    '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2026-040925 vendu le 29/01/2026 132 jours restants';
  assert.equal(saleContractMatches(existing, promo259), false);
  assert.equal(
    saleContractMatches(
      'OFFRE PROMO 12MOIS CONTRAT N°C2026-042337 vendu le 19/08/2026 365 jours restants',
      promo259
    ),
    true
  );
});

test('44,99 match le contrat mensuel, pas le 12 mois', () => {
  assert.equal(
    saleContractMatches(
      '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2026-040925 132 jours restants',
      monthly
    ),
    true
  );
  assert.equal(
    saleContractMatches('OFFRE PROMO 12MOIS CONTRAT N°C2026-042337 365 jours restants', monthly),
    false
  );
});
