'use strict';

/**
 * Conformité au cahier de charge Blade :
 * C:\Users\PC\Desktop\cahier de charge _bladee.pdf
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  BLADE_ID,
  BLADE_PRICE_CENTS,
  BLADE_PRODUCT,
  BLADE_SIZES,
  ALERT_AT,
  REMUS_PHONE,
  PICKUP_HOURS,
  PICKUP_NOTE,
  MINIMES_PICKUP,
  adultAboEligible,
  shouldOfferUpsell,
} = require('../storefront/lib/blade-upsell');
const { getMaterielProducts, findMaterielProduct } = require('../storefront/lib/merch');

const ROOT = path.join(__dirname, '..');
const inscriptionJs = fs.readFileSync(path.join(ROOT, 'storefront/public/js/inscription.js'), 'utf8');
const mailerJs = fs.readFileSync(path.join(ROOT, 'storefront/lib/mailer.js'), 'utf8');
const invoicePdfJs = fs.readFileSync(path.join(ROOT, 'storefront/lib/invoice-pdf.js'), 'utf8');
const upsellJs = fs.readFileSync(path.join(ROOT, 'storefront/lib/blade-upsell.js'), 'utf8');
const wpBannerPath = path.join(ROOT, '..', 'site_word_press', 'word_press', '_wp_tmp', 'blade-banner.html');
const wpBanner = fs.existsSync(wpBannerPath) ? fs.readFileSync(wpBannerPath, 'utf8') : '';

test('cahier §prix : 17,90 € au lieu de 40 €', () => {
  assert.equal(BLADE_PRICE_CENTS, 1790);
  assert.equal(BLADE_PRODUCT.price_was_cents, 4000);
  assert.equal(BLADE_PRODUCT.price_label, '17,90 €');
  assert.equal(BLADE_PRODUCT.price_was_label, '40,00 €');
});

test('cahier §retrait : Minimes, jour même, horaires lun–ven 12h–14h et 17h–21h, samedi 15h–18h', () => {
  assert.equal(MINIMES_PICKUP, 'Barrière de Paris - Minimes');
  assert.equal(BLADE_PRODUCT.pickup_locked, MINIMES_PICKUP);
  assert.equal(BLADE_PRODUCT.pickup_same_day, true);
  assert.match(PICKUP_HOURS, /12h–14h/);
  assert.match(PICKUP_HOURS, /17h–21h/);
  assert.match(PICKUP_HOURS, /samedi 15h–18h/i);
  assert.match(PICKUP_NOTE, /Minimes/);
  assert.match(PICKUP_NOTE, /jour même/);
});

test('cahier §boutique : fiche Blade en 1re position de /materiel', () => {
  const products = getMaterielProducts({ activeOnly: true });
  assert.equal(products[0].id, BLADE_ID);
  assert.equal(products[0].sort_order, 1);
  assert.equal(products[0].featured_first, true);
  const p = findMaterielProduct('gants-boxe-blade-noir-blanc');
  assert.equal(p.id, BLADE_ID);
  assert.ok(p.combinations.some((c) => String(c.attributes?.Taille || c.label).includes('14oz')));
});

test('cahier §upsell : après paiement abo adulte / essai, pas enfants ni coaching', () => {
  assert.equal(adultAboEligible({ tab: 'abonnements', subsection: 'comptant' }), true);
  assert.equal(adultAboEligible({ tab: 'abonnements', subsection: 'prelevement' }), true);
  assert.equal(adultAboEligible({ tab: 'seance-essai', subsection: 'essai' }), true);
  assert.equal(adultAboEligible({ tab: 'abonnements', subsection: 'enfants' }), false);
  assert.equal(adultAboEligible({ tab: 'coachings' }), false);

  const paidAdult = {
    payment: { status: 'paid' },
    product_snapshot: { tab: 'abonnements', subsection: 'prelevement' },
  };
  assert.equal(shouldOfferUpsell(paidAdult), true);
  assert.equal(shouldOfferUpsell({ ...paidAdult, payment: { status: 'pending' } }), false);
  assert.equal(shouldOfferUpsell({ ...paidAdult, signature: { signed_at: '2026-08-29' } }), false);
});

test('cahier §upsell : Passer / carte / PayPal dans le tunnel, puis dossier', () => {
  assert.match(inscriptionJs, /id="bladeSkip"/);
  assert.match(inscriptionJs, /id="bladePayCard"/);
  assert.match(inscriptionJs, /id="bladePayPaypal"/);
  assert.match(inscriptionJs, /Passer et continuer l’inscription/);
  assert.match(inscriptionJs, /sans quitter votre inscription/);
  assert.doesNotMatch(inscriptionJs, /Blanc\/Or|blanc-or/);
  assert.match(inscriptionJs, /Boxing Center Toulouse Minimes/);
  assert.match(inscriptionJs, /17h–21h/);
  assert.match(inscriptionJs, /samedi 15h–18h/);
  assert.match(inscriptionJs, /showUpsell/);
  assert.match(inscriptionJs, /fullForm/);
});

test('cahier §facture : abonnement + gants sur la facture et l’e-mail', () => {
  assert.match(invoicePdfJs, /addonPaid && addonCents/);
  assert.match(invoicePdfJs, /Gants Blade/);
  assert.match(invoicePdfJs, /Retrait Minimes/);
  assert.match(mailerJs, /addons\?\.blade\?\.status === 'paid'/);
  assert.match(mailerJs, /17,90 €/);
  assert.match(inscriptionJs, /addons\?\.blade\?\.status === 'paid'/);
});

test('cahier §WhatsApp Remus : +33 7 67 91 91 66, nom, prénom, tél, produit', () => {
  assert.equal(REMUS_PHONE, '0767919166');
  assert.match(upsellJs, /Prénom :/);
  assert.match(upsellJs, /Nom :/);
  assert.match(upsellJs, /Tél :/);
  assert.match(upsellJs, /Produit :/);
  assert.match(upsellJs, /sendWhatsAppMessage\(REMUS_PHONE/);
  assert.match(upsellJs, /Les ventes continuent/);
});

test('cahier §bandeau WordPress : entre musculation/cardio et Nos coachs, prix + lien fiche', (t) => {
  if (!wpBanner) {
    t.skip('snippet WordPress absent de ce clone');
    return;
  }
  assert.match(wpBanner, /Espaces Musculation \/ Cardio/);
  assert.match(wpBanner, /Nos coachs/);
  assert.match(wpBanner, /17,90/);
  assert.match(wpBanner, /40/);
  assert.match(wpBanner, /boutique\.boxingcenter\.fr\/materiel\/produit\/gants-boxe-blade-noir-blanc/);
});

test('cahier §alerte stock : les ventes continuent après le seuil', () => {
  assert.match(upsellJs, /Les ventes continuent/);
  assert.match(upsellJs, /hitAlert/);
  assert.ok(ALERT_AT > 0);
});

test('écarts vs ce PDF (taille 14oz / stock 30 / alerte à 30) — élargi par le catalogue rentrée', () => {
  assert.ok(BLADE_SIZES.includes('14oz'));
  assert.deepEqual(BLADE_SIZES, ['10oz', '12oz', '14oz']);
  assert.notEqual(ALERT_AT, 30, 'PDF = alerte à 30 vendus ; code actuel = ' + ALERT_AT);
  assert.equal(ALERT_AT, 10);
  assert.equal(BLADE_PRODUCT.stock, 30);
  assert.equal(BLADE_PRODUCT.combinations.length, 3);
  assert.ok(!BLADE_PRODUCT.combinations.some((c) => /blanc-or|Blanc \/ Or/i.test(`${c.id} ${c.label}`)));
  assert.notEqual(BLADE_PRODUCT.name, 'Gants de boxe Blade Gold Blanc Noir');
});
