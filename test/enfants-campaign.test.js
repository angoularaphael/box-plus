'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEnfantsCampaignEmail,
  enfantsCampaignSmsText,
  ENFANTS_CAMPAIGN_URL,
} = require('../storefront/lib/campaign-email');

test('campagne enfants — mail David avec lien abonnements', () => {
  const mail = buildEnfantsCampaignEmail({ name: 'Léa' });
  assert.match(mail.subject, /enfants/i);
  assert.match(mail.emailText, /Salut Léa, c'est David de Boxing Center/);
  assert.match(mail.emailText, /Baby Boxe dès 3 ans/);
  assert.match(mail.emailText, /abonnements#enfants/);
  assert.match(mail.emailText, /Séance d'essai offerte/);
  assert.equal(mail.fromName, 'David');
  assert.match(mail.html, /<html lang="fr">/);
  assert.match(mail.html, /Voir les cours enfants/);
  assert.match(mail.html, /12 rue de Fenouillet/);
  assert.ok(mail.headers['List-Unsubscribe']);
});

test('campagne enfants — SMS sans accents pour GSM', () => {
  const sms = enfantsCampaignSmsText();
  assert.match(sms, /Salut c'est David/);
  assert.match(sms, /boutique\.boxingcenter\.fr\/abonnements#enfants/);
  assert.doesNotMatch(sms, /[éèêëàâùûîïôöç]/i);
  assert.doesNotMatch(sms, /€|×/);
});
