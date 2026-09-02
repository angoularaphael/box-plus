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

test('259 cash n’est pas validé par un contrat 4× Deciplus', () => {
  const cash = { ...promo259, paiement_comptant: true };
  assert.equal(
    saleContractMatches('OFFRE PROMO 12MOIS — 4× sans frais CONTRAT N°C2026-050099', cash),
    false
  );
  assert.equal(
    saleContractMatches(
      'OFFRE PROMO 12MOIS CONTRAT N°C2026-042337 vendu le 19/08/2026 365 jours restants',
      cash
    ),
    true
  );
});

test('un 259 € archivé ne valide pas une nouvelle vente promo', () => {
  assert.equal(
    saleContractMatches(
      'ARCHIVÉE : OFFRE PROMO 12 MOIS CONTRAT N°C2025-038631 vendu le 25/09/2025 30 jours restants',
      promo259
    ),
    false
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

test('OFFRE A 29€ matche OFFRE DUO 29€, pas un 44,99 résilié', () => {
  const offre29 = {
    id: 'dp-104',
    name: 'OFFRE A 29€',
    deciplus_product_search: 'OFFRE A 29',
  };
  assert.equal(
    saleContractMatches('OFFRE DUO 29€ CONTRAT N°C2026-050001 vendu le 22/08/2026', offre29),
    true
  );
  assert.equal(
    saleContractMatches(
      '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2024-027841 Résilié depuis le 01/12/2024',
      offre29
    ),
    false
  );
  assert.equal(
    saleContractMatches(
      '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2026-040925 132 jours restants',
      offre29
    ),
    false
  );
});
