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

test('contrat expiré / résilié ne bloque pas une nouvelle vente', () => {
  const { leftoverBlocksNewSale, isStaleOrInactiveAbo } = require('../lib/replace-existing-abo');
  const expired = {
    idc: '40919',
    isBadge: false,
    label: 'BOXE EDUCATIVE Contrat n°C2026-040919 vendu le 28/01/2026 28/01/2026 27/06/2026 Expiré',
  };
  const expiredCaps = {
    idc: '35598',
    isBadge: false,
    label: 'OFFRE A 29€ CONTRAT N°C2025-035598 01/01/2025 31/12/2025 EXPIRÉ',
  };
  const cancelled = {
    idc: '9',
    isBadge: false,
    label: '44,99€/4 SEMAINES CONTRAT N°C2025-011111 Résilié',
  };
  const live = {
    idc: '1',
    isBadge: false,
    label: '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C2026-040925 132 jours restants',
  };
  const withBanner = {
    idc: '2',
    isBadge: false,
    label: '1 ANNULÉ, 1 ACTIF BOXE EDUCATIVE CONTRAT N°C2026-040919 90 jours restants',
  };
  assert.equal(isStaleOrInactiveAbo(expired.label), true);
  assert.equal(isStaleOrInactiveAbo(expiredCaps.label), true);
  assert.equal(isStaleOrInactiveAbo(cancelled.label), true);
  assert.equal(isStaleOrInactiveAbo(live.label), false);
  assert.equal(isStaleOrInactiveAbo(withBanner.label), false);
  assert.equal(leftoverBlocksNewSale(expired), false);
  assert.equal(leftoverBlocksNewSale(expiredCaps), false);
  assert.equal(leftoverBlocksNewSale(cancelled), false);
  assert.equal(leftoverBlocksNewSale(live), true);
  const c = classifyMemberContracts([expired, cancelled, live], offre29, opts);
  assert.deepEqual(
    c.toCancel.map((x) => x.idc),
    ['1']
  );
});

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

test('Aventure applique la même matrice Badge que le bot principal', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/aventure-clone.js'), 'utf8');
  assert.match(src, /orderNeedsAutoBadge\(order, productConfig\)/);
  assert.doesNotMatch(src, /productConfig\.auto_badge = true/);
  const idx = require('fs').readFileSync(require('path').join(__dirname, '../bot/index.js'), 'utf8');
  assert.match(idx, /orderNeedsAutoBadge\(order, productConfig\)/);
  assert.match(idx, /badgeDone/);
});

test('29 € déjà démarré + replaceExisting → on résilie puis on revend', () => {
  const contracts = [
    {
      idc: '3',
      isBadge: false,
      label: 'OFFRE DUO 29€ CONTRAT N°C2026-042431 vendu le 22/08/2026 330 jours restants',
    },
  ];
  const c = classifyMemberContracts(contracts, offre29, { ...opts, replaceExisting: true });
  assert.equal(c.needsNewSale, true);
  assert.deepEqual(
    c.toCancel.map((x) => x.idc),
    ['3']
  );
  const kept = classifyMemberContracts(contracts, offre29, {
    ...opts,
    replaceExisting: true,
    keepSaleId: '3',
  });
  assert.equal(kept.needsNewSale, false);
  assert.equal(kept.toCancel.length, 0);
});

test('le bot ventes résilie l’ancien abo avant de vendre le nouveau', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/sale.js'), 'utf8');
  assert.match(src, /classifyMemberContracts/);
  assert.match(src, /change_replace_existing/);
  assert.match(src, /Badge déjà actif/);
  assert.match(src, /replaceExisting:\s*true/);
  assert.match(src, /leftoverBlocksNewSale/);
  assert.match(src, /Ancien abo clos \/ expiré/);
  assert.match(src, /leftover\.length === 0/);
  assert.doesNotMatch(src, /nouvelle vente bloquée pour éviter un doublon/);
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

test('badge impayé : Annuler la vente même si le contrat a déjà commencé', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/cancel-sale.js'), 'utf8');
  assert.match(src, /allowStarted: forceVoid \|\| Boolean\(contract\.isBadge\) \|\| sameDayStart/);
  assert.match(src, /reason: contract\.isBadge \? 'badge_voided' : 'pending_voided'/);
});
