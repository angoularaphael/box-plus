'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPortetGym,
  isPortetKidsFlow,
  isPortetKidsOrder,
  isPortetCawl4xRib,
  normalizeGuardian,
  validateGuardian,
  dossierStatus,
  guardianAdminNote,
} = require('../lib/portet-inscription');
const { isPayplug4xPrelevement, isPayplug4xPrelevementOrder, requiresIbanForPlan } = require('../lib/billing-plan');
const { buildOrderPayload } = require('../storefront/lib/orders');
const { normalizeOrder } = require('../lib/normalize');

const BABY = {
  id: 'baby-boxe',
  name: 'BABY BOXE',
  supports_installment_choice: true,
  requires_iban: false,
  requires_payment: true,
  price_cents: 25000,
  subsection: 'enfants',
};

const EDUC = {
  id: 'boxe-educative',
  name: 'BOXE EDUCATIVE',
  supports_installment_choice: true,
  requires_iban: false,
  requires_payment: true,
  price_cents: 29500,
};

describe('Portet enfants — isolation salles', () => {
  it('ne s’active pas hors Portet', () => {
    assert.equal(isPortetGym('minimes'), false);
    assert.equal(isPortetKidsFlow('minimes', EDUC), false);
    assert.equal(isPortetKidsFlow('portet', EDUC), true);
    assert.equal(isPortetKidsFlow('portet', { id: 'offre-saison', name: 'OFFRE PROMO' }), false);
  });

  it('tuteur obligatoire seulement si fourni incomplet', () => {
    assert.deepEqual(validateGuardian({}), [
      'Prénom du responsable légal requis',
      'Nom du responsable légal requis',
      'Téléphone du responsable légal requis',
      'E-mail du responsable légal requis',
    ]);
    assert.equal(
      validateGuardian({
        first_name: 'Marie',
        last_name: 'Martin',
        phone: '0612345678',
        email: 'marie@test.fr',
      }).length,
      0
    );
  });

  it('4× CAWL + RIB Portet, pas les autres salles', () => {
    assert.equal(
      isPortetCawl4xRib({ gym: 'portet', paymentPlan: '4x', payMethod: 'cawl' }),
      true
    );
    assert.equal(
      isPortetCawl4xRib({ gym: 'portet', paymentPlan: '4x', payMethod: 'paypal' }),
      false
    );
    assert.equal(
      isPortetCawl4xRib({ gym: 'minimes', paymentPlan: '4x', payMethod: 'cawl' }),
      false
    );
  });

  it('payload bot 4× CAWL+RIB = même sémantique que PayPlug 4× RIB', () => {
    const payload = buildOrderPayload(
      {
        first_name: 'Leo',
        last_name: 'Test',
        email: 'parent@test.fr',
        phone: '0612345678',
        birthdate: '2018-01-01',
        gender: 'M',
        gym: 'portet',
        address: '1 rue Test',
        postal_code: '31120',
        city: 'Portet',
        payment_plan: '4x',
        billing_plan: 'rib',
        payment_method: 'cawl',
        guardian: {
          first_name: 'Marie',
          last_name: 'Test',
          phone: '0612345678',
          email: 'parent@test.fr',
        },
      },
      BABY
    );
    assert.equal(payload.requires_iban, true);
    assert.equal(payload.paiement_comptant, false);
    assert.equal(payload.payment.amount, 62.5);
    assert.equal(payload.customer.guardian.first_name, 'Marie');
    assert.equal(isPayplug4xPrelevement('4x', 'rib'), true);
    assert.equal(isPayplug4xPrelevementOrder(payload), true);
    assert.equal(requiresIbanForPlan(BABY, 'rib', '4x'), true);
    const norm = normalizeOrder(payload);
    assert.equal(norm.customer.guardian.first_name, 'Marie');
  });

  it('dossier incomplet sans photo / CNI', () => {
    const status = dossierStatus({
      product_id: 'boxe-educative',
      product_snapshot: EDUC,
      customer_full: {
        gym: 'portet',
        address: '1 rue A',
        postal_code: '31120',
        city: 'Portet',
        guardian: {
          first_name: 'A',
          last_name: 'B',
          phone: '0612345678',
          email: 'a@b.fr',
        },
      },
      payment: { status: 'paid' },
      documents: {},
    });
    assert.equal(status.complete, false);
    assert.ok(status.missing.includes('photo'));
    assert.ok(status.missing.includes('piece_identite'));
  });

  it('Minimes 4× PayPlug inchangé (détecteur existant)', () => {
    assert.equal(
      isPayplug4xPrelevementOrder({
        gym: 'minimes',
        payment: { payment_plan: '4x', billing_plan: 'rib', method: 'payplug' },
      }),
      true
    );
    assert.equal(isPortetKidsOrder({ customer_full: { gym: 'minimes' }, product_snapshot: EDUC }), false);
  });

  it('note tuteur pour Deciplus', () => {
    const note = guardianAdminNote({
      first_name: 'Marie',
      last_name: 'Martin',
      phone: '0612345678',
      email: 'marie@test.fr',
    });
    assert.match(note, /Tuteur/);
    assert.match(note, /Marie Martin/);
  });
});
