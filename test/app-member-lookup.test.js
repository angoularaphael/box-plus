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

  it('contrat resilie avec acces restant : actif jusqu a la date, resiliation remontee', () => {
    const s = summarizeContracts(
      [{ label: '44,99€/4 SEMAINES SANS ENGAGEMENT CONTRAT N°C1 vendu le 05/01/2026 05/01/2026 06/12/2026 Résilié depuis le 20/12/2026', inactive: true }],
      new Date('2026-11-23T10:00:00Z')
    );
    assert.equal(s.abonnement_actif, true);
    assert.equal(s.resilie_le, '2026-12-20');
    assert.equal(s.fin_contrat, '2026-12-20');
    assert.equal(s.offre, '44,99€/4 SEMAINES SANS ENGAGEMENT');
  });

  it('contrat resilie dont la date est passee : plus d abonnement', () => {
    const s = summarizeContracts(
      [{ label: 'OFFRE CONTRAT N°C2 vendu le 05/01/2026 05/01/2026 06/12/2026 Résilié depuis le 07/10/2026', inactive: true }],
      new Date('2026-11-23T10:00:00Z')
    );
    assert.equal(s.abonnement_actif, false);
    assert.equal(s.resilie_le, '2026-10-07');
  });

  it('nouvel abonnement apres une resiliation : la resiliation ne compte plus', () => {
    const s = summarizeContracts(
      [
        { label: 'VIEUX CONTRAT N°C2 vendu le 05/01/2026 05/01/2026 06/12/2026 Résilié depuis le 07/10/2026', inactive: true },
        { label: 'ETUDIANTS CONTRAT N°C3 vendu le 23/11/2026 23/11/2026 24/10/2027 336 jours restants' },
      ],
      new Date('2026-11-23T10:00:00Z')
    );
    assert.equal(s.abonnement_actif, true);
    assert.equal(s.resilie_le, null);
    assert.equal(s.offre, 'ETUDIANTS');
    assert.equal(s.fin_contrat, '2027-10-24');
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

describe('echeancier app', () => {
  const { summarizeEcheances } = require('../bot/app-member');
  it('prochain prelevement a faire, montant et impayes', () => {
    const e = summarizeEcheances(
      [
        { date: '01/10/2026', price: '36.99', etat: 'I', mode: 'Prélèvement' },
        { date: '16/01/2027', price: '36.99', etat: 'T', mode: 'Prélèvement Auto RIB' },
        { date: '20/12/2026', price: '36,99', etat: 'T', mode: 'Prélèvement Auto RIB' },
      ],
      new Date('2026-11-23T10:00:00Z')
    );
    assert.deepEqual(e, { prochain_prelevement: '2026-12-20', prochain_montant: 36.99, prelevement_auto: true, impayes: 1 });
  });
});
