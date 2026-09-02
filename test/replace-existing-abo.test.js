'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');
const {
  classifyMemberContracts,
  contractsToCancelBeforeNewAbo,
} = require('../lib/replace-existing-abo');

const offre29 = {
  id: 'dp-104',
  name: 'OFFRE A 29€',
  deciplus_product_search: 'OFFRE A 29',
};

const opts = { isPendingOrFuture: isPendingOrFutureContract };

test('44,99 en cours → on résilie, on vend le 29, badge manquant', () => {
  const contracts = [
    {
      idc: '1',
      isBadge: false,
      label: '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2026-040925 132 jours restants',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, opts);
  assert.equal(c.needsNewSale, true);
  assert.equal(c.needsBadge, true);
  assert.deepEqual(
    contractsToCancelBeforeNewAbo(contracts, offre29, opts).map((x) => x.idc),
    ['1']
  );
});

test('259 / 12 mois en cours → on résilie aussi (pas seulement 44,99)', () => {
  const contracts = [
    {
      idc: '2',
      isBadge: false,
      label: 'OFFRE PROMO 12MOIS CONTRAT N°C2026-042337 vendu le 19/08/2026 365 jours restants',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, opts);
  assert.equal(c.otherActive.length, 1);
  assert.equal(c.toCancel[0].idc, '2');
  assert.equal(c.needsNewSale, true);
});

test('29 € déjà démarré → on ne re-vend pas, on ne résilie pas ce 29', () => {
  const contracts = [
    {
      idc: '3',
      isBadge: false,
      label: 'OFFRE DUO 29€ CONTRAT N°C2026-042431 vendu le 22/08/2026 330 jours restants',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, opts);
  assert.equal(c.needsNewSale, false);
  assert.equal(c.toCancel.length, 0);
});

test('29 € en attente + ancien abo → on résilie les deux puis on vend', () => {
  const contracts = [
    {
      idc: '4',
      isBadge: false,
      label: '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2025-011111 40 jours restants',
    },
    {
      idc: '5',
      isBadge: false,
      label: 'OFFRE DUO 29€ — EN ATTENTE 20/09/2026 au 19/08/2027',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, opts);
  assert.equal(c.matchingPending.length, 1);
  assert.equal(c.otherActive.length, 1);
  assert.equal(c.needsNewSale, true);
  assert.deepEqual(
    c.toCancel.map((x) => x.idc).sort(),
    ['4', '5']
  );
});

test('29 déjà démarré + 44,99 encore actif → on résilie seulement l’ancien', () => {
  const contracts = [
    {
      idc: '6',
      isBadge: false,
      label: 'OFFRE DUO 29€ CONTRAT N°C2026-042431 vendu le 22/08/2026 330 jours restants',
    },
    {
      idc: '7',
      isBadge: false,
      label: '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2024-027841 12 jours restants',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, opts);
  assert.equal(c.needsNewSale, false);
  assert.deepEqual(
    c.toCancel.map((x) => x.idc),
    ['7']
  );
});

test('Badge actif → pas de nouveau badge ; Badge absent → besoin', () => {
  const withBadge = classifyMemberContracts(
    [
      {
        idc: '8',
        isBadge: false,
        label: 'OFFRE DUO 29€ CONTRAT N°C2026-042431 vendu le 22/08/2026',
      },
      { idc: '9', isBadge: true, label: 'BADGE 34,99€ 12 crédits' },
    ],
    offre29,
    opts
  );
  assert.equal(withBadge.needsBadge, false);

  const noBadge = classifyMemberContracts(
    [
      {
        idc: '8',
        isBadge: false,
        label: 'OFFRE DUO 29€ CONTRAT N°C2026-042431 vendu le 22/08/2026',
      },
    ],
    offre29,
    opts
  );
  assert.equal(noBadge.needsBadge, true);
});

test('Aventure 29 € force le badge auto', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/aventure-clone.js'), 'utf8');
  assert.match(src, /productConfig\.auto_badge = true/);
  const idx = require('fs').readFileSync(require('path').join(__dirname, '../bot/index.js'), 'utf8');
  assert.match(idx, /isOffre29Product/);
  assert.match(idx, /badgeDone/);
});

test('le bot ventes résilie l’ancien abo avant de vendre le nouveau', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/sale.js'), 'utf8');
  assert.match(src, /classifyMemberContracts/);
  assert.match(src, /change_replace_existing/);
  assert.match(src, /Badge déjà actif/);
});

test('Aventure Minimes : un 44,99 déjà sur la fiche est bien à résilier', () => {
  const contracts = [
    {
      idc: '10',
      isBadge: false,
      label: '44,99€/4 SEMAINES SANS ENGAGEMENT 80 jours restants',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, opts);
  assert.equal(c.toCancel.length, 1);
  assert.equal(c.needsNewSale, true);
  assert.equal(c.needsBadge, true);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/sale.js'), 'utf8');
  assert.match(src, /skipCancel:\s*false/);
});

test('une séance d’essai n’est pas résiliée pour poser un 259', () => {
  const contracts = [
    {
      idc: '42567',
      isBadge: false,
      label: "SEANCE D'ESSAI CONTRAT N°C2026-042567 vendu le 26/08/2026",
    },
    {
      idc: '43028',
      isBadge: false,
      label: 'Contrat n°C2026-043028 vendu le 02/09/2026 28/08/2033 27/08/2034 En attente',
    },
  ];
  const promo = {
    name: 'OFFRE PROMO 12MOIS',
    paiement_comptant: true,
  };
  const c = classifyMemberContracts(contracts, promo, opts);
  assert.deepEqual(
    c.toCancel.map((x) => x.idc),
    ['43028']
  );
});

test('badge différé : Terminer absent n’abandonne pas le Badge', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/sale.js'), 'utf8');
  const start = src.indexOf('async function finalizeBadgePayment');
  const end = src.indexOf('async function configureBadgeDeferredDates');
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /throw new Error\('Badge — bouton « Terminer » introuvable'\)/);
  assert.match(body, /vérification du contrat/);
});

test('échéance badge : gymConfig est un argument (plus de ReferenceError)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/sale.js'), 'utf8');
  assert.match(
    src,
    /async function enforceBadgeEcheance\(page, memberId, badgeConfig = \{\}, gymConfig = \{\}\)/
  );
  assert.match(src, /enforceBadgeEcheance\(page, memberId, badgeProductConfig, gymConfig\)/);
});
