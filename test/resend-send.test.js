'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  isConfigured,
  senderEmail,
  DEFAULT_SENDER_EMAIL,
  sendEmailViaResend,
} = require('../storefront/lib/resend-send');

test('factures inscription et matériel passent par Brevo, pas Resend API', () => {
  const mailer = fs.readFileSync(path.join(__dirname, '../storefront/lib/mailer.js'), 'utf8');
  const branding = fs.readFileSync(path.join(__dirname, '../storefront/lib/branding.js'), 'utf8');
  assert.match(mailer, /brevo-send/);
  assert.match(mailer, /sendEmailViaBrevo/);
  assert.match(mailer, /fromName: 'Boxing Center'/);
  assert.doesNotMatch(mailer, /sendEmailViaResend/);
  assert.doesNotMatch(mailer, /resend-send/);
  assert.match(branding, /brevo-send/);
  assert.doesNotMatch(branding, /resend-send/);
});

test('compat Resend convertit les PJ fichier/buffer en base64', () => {
  const { toResendAttachments } = require('../storefront/lib/resend-send');
  const raw = Buffer.alloc(600, 1);
  const files = toResendAttachments([{ filename: 'facture.pdf', content: raw }]);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'facture.pdf');
  assert.equal(files[0].content, raw.toString('base64'));
});

test('module compat Resend route vers Brevo (pas api.resend.com)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/resend-send.js'), 'utf8');
  assert.match(src, /brevo-send/);
  assert.match(src, /sendEmailViaBrevo/);
  assert.doesNotMatch(src, /api\.resend\.com/);
  assert.equal(typeof sendEmailViaResend, 'function');
});

test('expéditeur par défaut = Brevo (suzinabot)', () => {
  const prev = process.env.BREVO_SENDER_EMAIL;
  const prevResend = process.env.RESEND_SENDER_EMAIL;
  delete process.env.BREVO_SENDER_EMAIL;
  delete process.env.RESEND_SENDER_EMAIL;
  assert.equal(senderEmail(), DEFAULT_SENDER_EMAIL);
  assert.equal(DEFAULT_SENDER_EMAIL, 'suzinabot@gmail.com');
  if (prev == null) delete process.env.BREVO_SENDER_EMAIL;
  else process.env.BREVO_SENDER_EMAIL = prev;
  if (prevResend == null) delete process.env.RESEND_SENDER_EMAIL;
  else process.env.RESEND_SENDER_EMAIL = prevResend;
});

test('relance essai client passe par Brevo, pas Resend API', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/essai-followup.js'), 'utf8');
  assert.match(src, /brevo-send/);
  assert.match(src, /sendEmailViaBrevo/);
  assert.doesNotMatch(src, /sendEmailViaResend/);
});

test('relance inscription e-mail passe par Brevo, pas Resend API', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/inscription-nudge.js'), 'utf8');
  assert.match(src, /brevo-send/);
  assert.match(src, /sendEmailViaBrevo/);
  assert.doesNotMatch(src, /sendEmailViaResend/);
  assert.match(src, /html: copy\.html/);
  assert.doesNotMatch(src, /html:\s*undefined/);
  const copy = fs.readFileSync(path.join(__dirname, '../storefront/lib/campaign-email.js'), 'utf8');
  assert.match(copy, /david@boxingcenter\.fr/);
});

test('relance inscription SMS (« vous n’avez pas finalisé ») coupée', () => {
  const nudge = fs.readFileSync(path.join(__dirname, '../storefront/lib/inscription-nudge.js'), 'utf8');
  assert.match(nudge, /sms_disabled/);
  assert.doesNotMatch(nudge, /inscription-relance/);
  assert.doesNotMatch(nudge, /sms-gateway/);
  assert.doesNotMatch(nudge, /inscription-reprise/);
  assert.match(nudge, /async function sendResumeWhatsApp\(\)/);
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
  assert.match(mail.emailText, /44,99 euros les 4 semaines/);
  assert.match(mail.emailText, /400 euros les 12 mois/);
  assert.doesNotMatch(mail.emailText, /\b29 euros|259 euros/);
  assert.match(mail.emailText, /offres-speciales/);
  assert.doesNotMatch(mail.emailText, /Guillaume|Voir les offres|🚨/);
});

test('isConfigured suit Brevo (API ou SMTP)', () => {
  const prevKey = process.env.BREVO_API_KEY;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;
  const prevVercel = process.env.VERCEL;
  delete process.env.BREVO_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.VERCEL;
  assert.equal(isConfigured(), false);
  process.env.BREVO_API_KEY = 'xkeysib-test';
  assert.equal(isConfigured(), true);
  if (prevKey == null) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = prevKey;
  if (prevUser == null) delete process.env.SMTP_USER;
  else process.env.SMTP_USER = prevUser;
  if (prevPass == null) delete process.env.SMTP_PASS;
  else process.env.SMTP_PASS = prevPass;
  if (prevVercel == null) delete process.env.VERCEL;
  else process.env.VERCEL = prevVercel;
});

test('Pass Sport et alertes ops passent par Brevo', () => {
  const pass = fs.readFileSync(path.join(__dirname, '../storefront/lib/pass-sport-mail.js'), 'utf8');
  const logger = fs.readFileSync(path.join(__dirname, '../lib/logger.js'), 'utf8');
  assert.match(pass, /brevo-send/);
  assert.match(pass, /sendEmailViaBrevo/);
  assert.doesNotMatch(pass, /api\.resend\.com/);
  assert.match(logger, /brevo-send/);
  assert.match(logger, /sendEmailViaBrevo/);
  assert.doesNotMatch(logger, /api\.resend\.com/);
});
