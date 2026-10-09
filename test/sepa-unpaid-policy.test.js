'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifySepaRemark,
  shouldResiliateUnpaid,
  shouldSendRibReminder,
  hasTwoConsecutiveUnpaid,
  SEPA_REASON,
} = require('../lib/sepa-unpaid-policy');

test('1 impayé AM04 : encore attendre ; tout autre motif : résilier', () => {
  assert.equal(classifySepaRemark('AM04 Provision insuffisante'), SEPA_REASON.INSUFFICIENT_FUNDS);
  assert.equal(
    classifySepaRemark('MD01 Pas d’autorisation / Absence de mandat'),
    SEPA_REASON.NO_MANDATE
  );
  const am04One = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AM04 Provision insuffisante'],
  });
  assert.equal(am04One.ok, false);
  assert.equal(am04One.why, 'wait_two_unpaid');
  const md01One = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['MD01 Pas d’autorisation / Absence de mandat'],
  });
  assert.equal(md01One.ok, true);
  assert.equal(md01One.why, 'sepa_immediate');
});

test('2 impayés consécutifs → résil peu importe le motif', () => {
  const am04 = shouldResiliateUnpaid({
    unpaid_count: 2,
    dates: ['06/07/2026', '06/08/2026'],
    remarks: ['AM04 Provision insuffisante'],
  });
  assert.equal(am04.ok, true);
  assert.equal(am04.why, 'two_consecutive_unpaid');
  const md01 = shouldResiliateUnpaid({
    unpaid_count: 2,
    dates: ['05/08/2026', '05/09/2026'],
    remarks: ['MD01 Pas d’autorisation / Absence de mandat'],
  });
  assert.equal(md01.ok, true);
  assert.equal(md01.why, 'sepa_immediate');
  const unknown = shouldResiliateUnpaid({
    unpaid_count: 2,
    months: ['2026-07', '2026-08'],
  });
  assert.equal(unknown.ok, true);
  assert.equal(hasTwoConsecutiveUnpaid({ unpaid_count: 2, dates: ['05/08/2026', '31/08/2026'] }), true);
});

test('2 impayés non consécutifs (trou d’un cycle) → pas de résil', () => {
  const gap = shouldResiliateUnpaid({
    unpaid_count: 2,
    dates: ['29/06/2026', '20/08/2026'],
    remarks: ['AM04 Provision insuffisante'],
  });
  assert.equal(gap.ok, false);
  assert.equal(hasTwoConsecutiveUnpaid({ unpaid_count: 2, dates: ['29/06/2026', '20/08/2026'] }), false);
});

test('2 impayés le même jour (abo + badge) → pas consécutifs', () => {
  const same = shouldResiliateUnpaid({
    unpaid_count: 2,
    dates: ['07/08/2026', '07/08/2026'],
    remarks: ['AM04 Provision insuffisante'],
  });
  assert.equal(same.ok, false);
});

test('MD06 / MS02 / MS03 / AC04 / JSON → immédiat', () => {
  assert.equal(
    classifySepaRemark('MD06 Contestation débiteur / Contestation d’une opération autorisée'),
    SEPA_REASON.DEBTOR_DISPUTE
  );
  assert.equal(classifySepaRemark('MS03 Raison non communiquée'), SEPA_REASON.DEBTOR_REFUSAL);
  assert.equal(classifySepaRemark('AC04 Compte clôturé'), SEPA_REASON.CLOSED_ACCOUNT);
  for (const remark of [
    'MD06 Contestation débiteur',
    'MS02 Sur ordre du client / Refus du débiteur',
    'MS03 Raison non communiquée',
    'Blocage volontaire',
    'AC04 Compte clôturé',
    '(Erreur JSON Syntax error)',
  ]) {
    assert.equal(shouldResiliateUnpaid({ unpaid_count: 1, remarks: [remark] }).ok, true);
  }
  assert.equal(classifySepaRemark('Blocage volontaire'), SEPA_REASON.DEBTOR_REFUSAL);
});

test('AC01 / RC01 : résil dès le 1er impayé (pas un fonds insuffisant)', () => {
  assert.equal(classifySepaRemark('RC01 Code banque incorrect'), SEPA_REASON.INVALID_BANK_ID);
  const one = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AC01 Coordonnée Bancaire inexploitable'],
    email: 'a@b.fr',
  });
  assert.equal(one.ok, true);
  assert.equal(one.why, 'sepa_immediate');
  const rib = shouldSendRibReminder(
    { unpaid_count: 1, remarks: ['AC01 Coordonnée Bancaire inexploitable'], email: 'a@b.fr' },
    null,
    {}
  );
  assert.equal(rib.ok, false);
});

test('AC06 : résil dès le 1er impayé, sans mail RIB', () => {
  const one = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AC06 Opposition sur compte'],
    email: 'a@b.fr',
  });
  assert.equal(one.ok, true);
  assert.equal(one.why, 'sepa_immediate');
  assert.equal(
    shouldSendRibReminder(
      { unpaid_count: 1, remarks: ['AC06 Opposition sur compte'], email: 'a@b.fr' },
      null,
      {}
    ).ok,
    false
  );
});

test('fiche sans e-mail ni téléphone → immédiat, sauf fonds insuffisant', () => {
  const one = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['MD01 Pas d’autorisation / Absence de mandat'],
    email: '',
    phone: '',
  });
  assert.equal(one.ok, true);
  assert.equal(one.why, 'missing_contact');
  const am04 = shouldResiliateUnpaid({
    unpaid_count: 1,
    remarks: ['AM04 Provision insuffisante'],
    email: '',
    phone: '',
  });
  assert.equal(am04.ok, false);
  assert.equal(am04.why, 'wait_two_unpaid');
});

test('résiliation impayés : Résilier abo + badge, jamais Annuler la vente', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/cancel-sale.js'), 'utf8');
  assert.match(src, /function resolveCancelNeverVoid\([\s\S]*?\{\s*return true;\s*\}/);
  assert.match(src, /!c\.isBadge/);
  assert.doesNotMatch(src, /badge_voided/);
  assert.doesNotMatch(src, /forceVoid|voidPendingSaleIfPossible|confirmAnnulationModal/);
  const script = require('fs').readFileSync(
    require('path').join(__dirname, '../scripts/mail-rib-and-resiliate-unpaid.js'),
    'utf8'
  );
  assert.match(script, /neverVoid:\s*true/);
  assert.match(script, /abo et badge/i);
  assert.doesNotMatch(script, /forceVoid:\s*true/);
});
