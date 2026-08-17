'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { offerKind, offerDocumentCopy, documentTypeLabel } = require('../lib/offer-document-copy');
const { invoiceTypeLabel } = require('../lib/billing-plan');

describe('textes facture / contrat selon l’offre', () => {
  it('coaching 1 séance 55 € : pas un abonnement, pas de badge 72h', () => {
    const product = {
      id: 'coaching-1',
      name: 'COACHING PRIVE 1 SEANCE',
      price_cents: 5500,
    };
    const order = {
      product_id: 'coaching-1',
      customer_full: { gym: 'minimes' },
      payment: { badge_timing: 'deferred', iban: 'FR761234' },
    };
    const copy = offerDocumentCopy(product, order);
    assert.equal(offerKind(product, order), 'coaching-1');
    assert.equal(copy.typeLabel, 'Coaching privé');
    assert.match(copy.description, /1 séance/i);
    assert.match(copy.description, /Aucun abonnement/);
    assert.equal(copy.showBadge72h, false);
    assert.equal(copy.showSepa, false);
    assert.equal(copy.showIban, false);
    assert.doesNotMatch(copy.description, /prélèvement prévu/i);
    assert.match(copy.footerNote, /ne constitue pas un contrat d'abonnement/);
    assert.match(copy.contractTitle, /coaching privé/i);
    assert.equal(invoiceTypeLabel(product), 'Coaching privé');
  });

  it('séance d’essai 10 €', () => {
    const product = { id: 'seance-essai', name: "SEANCE D'ESSAI", price_cents: 1000 };
    const copy = offerDocumentCopy(product, { product_id: 'seance-essai' });
    assert.equal(copy.kind, 'essai');
    assert.equal(copy.typeLabel, "Séance d'essai");
    assert.equal(copy.showBadge72h, false);
    assert.equal(copy.showSepa, false);
    assert.match(copy.description, /essai/i);
  });

  it('offre 29,99 € : abo prélèvement + badge 72h', () => {
    const product = {
      id: 'dp-104',
      legacy_id: 'offre-duo',
      name: 'OFFRE A 29 €',
      price_cents: 2999,
      requires_iban: true,
      sale_type: 'abonnement',
      duration_label: '4 semaines',
    };
    const copy = offerDocumentCopy(product, {
      product_id: 'dp-104',
      payment: { billing_plan: 'rib' },
    });
    assert.equal(copy.kind, 'abo-prelevement');
    assert.equal(documentTypeLabel(product), 'Abonnement prélèvement');
    assert.match(copy.description, /5 salles/);
    assert.match(copy.description, /prélèvement/i);
    assert.equal(copy.showSepa, true);
    assert.equal(copy.showBadge72h, true);
  });

  it('offre 259 € : comptant, pas de SEPA ni badge auto', () => {
    const product = {
      id: 'dp-100',
      legacy_id: 'offre-saison',
      name: 'OFFRE PROMO 12 MOIS 259 €',
      price_cents: 25900,
      supports_installment_choice: true,
    };
    const copy = offerDocumentCopy(product, { product_id: 'dp-100' });
    assert.equal(copy.kind, 'abo-comptant');
    assert.equal(copy.typeLabel, 'Paiement comptant');
    assert.match(copy.description, /une fois|comptant/i);
    assert.equal(copy.showSepa, false);
    assert.equal(copy.showBadge72h, false);
  });

  it('forfait coaching 5 séances', () => {
    const copy = offerDocumentCopy(
      { id: 'coaching-5', name: 'COACHING PRIVE 5 SEANCES', price_cents: 25000 },
      {}
    );
    assert.equal(copy.kind, 'coaching-5');
    assert.match(copy.description, /5 séances/);
    assert.equal(copy.showBadge72h, false);
  });

  it('Portet : pas de mention Boxing Center', () => {
    const product = {
      id: 'dp-100',
      name: 'OFFRE PROMO 12 MOIS',
      price_cents: 25900,
      supports_installment_choice: true,
    };
    const copy = offerDocumentCopy(product, { customer_full: { gym: 'portet' } });
    assert.doesNotMatch(copy.description, /Boxing Center/i);
    assert.doesNotMatch(copy.footerNote, /Boxing Center/i);
    assert.doesNotMatch(copy.contractTitle, /Boxing Center/i);
    assert.match(copy.description, /Portet/i);
    assert.match(copy.contractTitle, /Noble Art Portésien/i);
  });
});
