'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isConfigured, senderEmail, DEFAULT_SENDER_EMAIL } = require('../storefront/lib/resend-send');

test('factures inscription et matériel passent par Resend, pas Brevo', () => {
  const mailer = fs.readFileSync(path.join(__dirname, '../storefront/lib/mailer.js'), 'utf8');
  const branding = fs.readFileSync(path.join(__dirname, '../storefront/lib/branding.js'), 'utf8');
  assert.match(mailer, /resend-send/);
  assert.match(mailer, /sendEmailViaResend/);
  assert.match(mailer, /fromName: 'Boxing Center'/);
  assert.doesNotMatch(mailer, /sendEmailViaBrevo/);
  assert.doesNotMatch(mailer, /brevo-send/);
  assert.match(branding, /resend-send/);
  assert.doesNotMatch(branding, /brevo-send/);
});

test('Resend convertit les PJ fichier/buffer en base64', () => {
  const { toResendAttachments } = require('../storefront/lib/resend-send');
  const raw = Buffer.alloc(600, 1);
  const files = toResendAttachments([{ filename: 'facture.pdf', content: raw }]);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'facture.pdf');
  assert.equal(files[0].content, raw.toString('base64'));
});

test('Resend accepte un champ cc', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/resend-send.js'), 'utf8');
  assert.match(src, /ccList/);
  assert.match(src, /body\.cc = ccList/);
});

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

test('relance inscription e-mail passe par Resend, pas Brevo', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/inscription-nudge.js'), 'utf8');
  assert.match(src, /resend-send/);
  assert.match(src, /sendEmailViaResend/);
  assert.doesNotMatch(src, /sendEmailViaBrevo/);
});

test('relance inscription SMS (« vous n’avez pas finalisé ») coupée', () => {
  const nudge = fs.readFileSync(path.join(__dirname, '../storefront/lib/inscription-nudge.js'), 'utf8');
  assert.match(nudge, /sms_disabled/);
  assert.doesNotMatch(nudge, /inscription-relance/);
  assert.doesNotMatch(nudge, /sms-gateway/);
});

test('mail campagne : texte David, comme Guillaume en Principal', () => {
  const { buildOfferCampaignEmail } = require('../storefront/lib/campaign-email');
  const mail = buildOfferCampaignEmail({
    name: 'Camille',
    hubUrl: 'https://boutique.boxingcenter.fr/offres-speciales',
    email: 'boxingcenter31@gmail.com',
  });
  assert.match(mail.subject, /c’est David/);
  assert.match(mail.emailText, /C’est David\./);
  assert.match(mail.emailText, /David de Boxing Center/);
  assert.equal(mail.fromName, 'David');
  assert.doesNotMatch(mail.emailText, /C’est David, de Boxing Center/);
  assert.doesNotMatch(mail.subject, /Boxing Center|offres|€/);
  assert.equal(mail.html, undefined);
  assert.match(mail.emailText, /29 euros les 4 semaines/);
  assert.match(mail.emailText, /259 euros les 12 mois/);
  assert.match(mail.emailText, /offres-speciales/);
  assert.doesNotMatch(mail.emailText, /Guillaume|Voir les offres|🚨/);
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
