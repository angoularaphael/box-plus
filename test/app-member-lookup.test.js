'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { decideAppLink, summarizeContracts, APP_MATCH_FIELDS } = require('../lib/app-member-match');
const { normalizeOrder, validateOrder } = require('../lib/normalize');

describe('rapprochement app : regle stricte', () => {
  it('fiche concordante sur tous les champs : liee', () => {
    assert.deepEqual(decideAppLink({ found: true, member_id: 48213 }), {
      decision: 'lie',
      member_id: '48213',
      mismatch_fields: [],
    });
  });

  it('e-mail + naissance + nom, telephone different : liee', () => {
    const r = decideAppLink({ found: false, reason: 'identity_mismatch', member_id: '7', mismatch_fields: ['phone'] });
    assert.equal(r.decision, 'lie');
  });

  it('e-mail + naissance + telephone, prenom different : liee', () => {
    const r = decideAppLink({ found: false, reason: 'identity_mismatch', member_id: '7', mismatch_fields: ['first_name'] });
    assert.equal(r.decision, 'lie');
  });

  it('e-mail + naissance, mais ni nom ni telephone : revue', () => {
    const r = decideAppLink({ found: false, reason: 'identity_mismatch', member_id: '7', mismatch_fields: ['phone', 'last_name'] });
    assert.equal(r.decision, 'a_revoir');
  });

  it('date de naissance differente : revue, jamais liee', () => {
    const r = decideAppLink({ found: false, reason: 'identity_mismatch', member_id: '7', mismatch_fields: ['birthdate'] });
    assert.equal(r.decision, 'a_revoir');
  });

  it('fiche trouvee par le telephone, e-mail different : revue', () => {
    const r = decideAppLink({ found: false, reason: 'identity_mismatch', member_id: '7', mismatch_fields: ['email'] });
    assert.equal(r.decision, 'a_revoir');
  });

  it('fiche Balma ignoree : revue', () => {
    const r = decideAppLink({ found: false, reason: 'balma_skipped', member_id: '9' });
    assert.equal(r.decision, 'a_revoir');
  });

  it('aucune fiche : prospect', () => {
    const r = decideAppLink({ found: false, reason: 'not_found', mismatch_fields: [] });
    assert.equal(r.decision, 'prospect');
    assert.equal(r.member_id, null);
  });

  it('compare les cinq champs', () => {
    assert.deepEqual([...APP_MATCH_FIELDS].sort(), ['birthdate', 'email', 'first_name', 'last_name', 'phone']);
  });
});

describe('rapprochement app : lecture des contrats', () => {
  it('abonnement actif et badge', () => {
    const s = summarizeContracts([
      { label: 'Sans engagement 4 semaines ACTIF', isBadge: false },
      { label: 'Carte badge', isBadge: true },
    ]);
    assert.equal(s.abonnement_actif, true);
    assert.equal(s.badge_enregistre, true);
  });

  it('seance d essai seule : pas d abonnement', () => {
    const s = summarizeContracts([{ label: 'Seance d essai', isBadge: false }]);
    assert.equal(s.abonnement_actif, false);
  });

  it('contrat en attente : pas encore actif', () => {
    const s = summarizeContracts([{ label: 'Offre promo 12 mois EN ATTENTE', isBadge: false }]);
    assert.equal(s.abonnement_actif, false);
    assert.equal(s.abonnement_en_attente, true);
  });
});

describe('job app_member_lookup', () => {
  const base = {
    action: 'app_lookup',
    order_id: 'app-123',
    status_callback_base: 'https://api.example.test',
    customer: { first_name: 'Camille', last_name: 'Durand', email: 'C@EX.FR', phone: '06 12 34 56 78', birthdate: '1996-04-12' },
  };

  it('normalise l action, l e-mail, le telephone et l identifiant de job', () => {
    const o = normalizeOrder(base);
    assert.equal(o.action, 'app_member_lookup');
    assert.equal(o.job_id, 'app-123#app');
    assert.equal(o.customer.email, 'c@ex.fr');
    assert.equal(o.customer.phone, '+33612345678');
    assert.deepEqual(validateOrder(o), []);
  });

  it('refuse un job sans adresse de rappel (jamais de repli vers la boutique)', () => {
    const o = normalizeOrder({ ...base, status_callback_base: '' });
    assert.ok(validateOrder(o).includes('status_callback_base manquant'));
  });

  it('refuse un job sans telephone ni date de naissance', () => {
    const o = normalizeOrder({ ...base, customer: { ...base.customer, phone: '', birthdate: null } });
    const errors = validateOrder(o);
    assert.ok(errors.includes('téléphone manquant'));
    assert.ok(errors.includes('date de naissance manquante'));
  });

  it('relecture d une fiche deja liee : l identifiant Deciplus suffit', () => {
    const o = normalizeOrder({ action: 'app_member_lookup', order_id: 'app-9', status_callback_base: 'https://api.example.test', deciplus_member_id: 48213 });
    assert.equal(o.deciplus_member_id, '48213');
    assert.deepEqual(validateOrder(o), []);
  });

  it('signe le rappel en HMAC sur horodatage et corps', () => {
    const { signBody } = require('../bot/app-member');
    const expected = crypto.createHmac('sha256', 's3cret').update('1700000000.{"a":1}').digest('hex');
    assert.equal(signBody('s3cret', '1700000000', '{"a":1}'), expected);
  });
});
