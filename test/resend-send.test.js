'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isConfigured, senderEmail, DEFAULT_SENDER_EMAIL } = require('../storefront/lib/resend-send');

test('Resend : expéditeur campagne = no-reply@boxingcenter.fr', () => {
  const prev = process.env.RESEND_SENDER_EMAIL;
  delete process.env.RESEND_SENDER_EMAIL;
  assert.equal(senderEmail(), DEFAULT_SENDER_EMAIL);
  assert.equal(DEFAULT_SENDER_EMAIL, 'no-reply@boxingcenter.fr');
  if (prev == null) delete process.env.RESEND_SENDER_EMAIL;
  else process.env.RESEND_SENDER_EMAIL = prev;
});

test('relance essai client passe par Resend, pas Brevo', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/essai-followup.js'), 'utf8');
  assert.match(src, /resend-send/);
  assert.match(src, /sendEmailViaResend/);
  assert.doesNotMatch(src, /sendEmailViaBrevo/);
});

test('mail campagne : List-Unsubscribe et objet sans urgence', () => {
  const { buildOfferCampaignEmail } = require('../storefront/lib/campaign-email');
  const mail = buildOfferCampaignEmail({
    name: 'Guillaume',
    hubUrl: 'https://boutique.boxingcenter.fr/offres-speciales',
    email: 'boxingcenter31@gmail.com',
  });
  assert.match(mail.subject, /offres Boxing Center — 29 € ou 259 €/);
  assert.match(mail.headers['List-Unsubscribe-Post'], /One-Click/);
  assert.match(mail.html, /Se désabonner/);
  assert.doesNotMatch(mail.html, /🚨|DERNIÈRES PLACES|trop tard/);
});

test('isConfigured suit RESEND_API_KEY', () => {
  const prev = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = '';
  assert.equal(isConfigured(), false);
  process.env.RESEND_API_KEY = 're_test';
  assert.equal(isConfigured(), true);
  if (prev == null) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prev;
});
