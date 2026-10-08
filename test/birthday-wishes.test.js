'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  isBirthdayToday,
  isSkipMember,
  shouldRunAt,
  buildBirthdayEmail,
  firstNameOf,
  FROM_NAME,
} = require('../storefront/lib/birthday-wishes');

test('prenom Guillaume', () => {
  assert.equal(firstNameOf('Guillaume CESSAC'), 'Guillaume');
});

test('anniversaire = jour/mois Paris, pas l’annee', () => {
  const now = new Date('2026-10-07T00:15:00+02:00');
  assert.equal(isBirthdayToday('1994-10-07', now), true);
  assert.equal(isBirthdayToday('07/10/1988', now), true);
  assert.equal(isBirthdayToday('1994-10-08', now), false);
  assert.equal(isBirthdayToday('', now), false);
});

test('29 fevrier hors annee bissextile = 1er mars', () => {
  const now = new Date('2026-03-01T00:10:00+01:00');
  assert.equal(isBirthdayToday('2000-02-29', now), true);
  assert.equal(isBirthdayToday('2000-02-29', new Date('2026-02-28T12:00:00+01:00')), false);
});

test('fenetre ops minuit jusqu’a 11h Paris, une fois par jour', () => {
  assert.equal(shouldRunAt(new Date('2026-10-07T00:05:00+02:00'), ''), true);
  assert.equal(shouldRunAt(new Date('2026-10-07T00:05:00+02:00'), '2026-10-07'), false);
  assert.equal(shouldRunAt(new Date('2026-10-07T15:00:00+02:00'), ''), false);
});

test('mail David, texte perso, pas de HTML promo', () => {
  const prev = process.env.BREVO_SENDER_EMAIL;
  delete process.env.BREVO_SENDER_EMAIL;
  const mail = buildBirthdayEmail({ first_name: 'Guillaume', last_name: 'CESSAC' });
  if (prev == null) delete process.env.BREVO_SENDER_EMAIL;
  else process.env.BREVO_SENDER_EMAIL = prev;
  assert.equal(mail.fromName, FROM_NAME);
  assert.equal(mail.fromName, 'Boxing Center');
  assert.equal(mail.fromEmail, 'suzinabot@gmail.com');
  assert.equal(mail.html, undefined);
  assert.equal(mail.headers['X-Transactional'], 'true');
  assert.match(mail.subject, /Guillaume, c’est David/);
  assert.doesNotMatch(mail.subject, /Boxing Center|anniversaire|offre/i);
  assert.match(mail.emailText, /Salut Guillaume,/);
  assert.match(mail.emailText, /très bel anniversaire 🎉/);
  assert.match(mail.emailText, /excellente journée et une très belle année à venir/);
  assert.doesNotMatch(mail.emailText, /Hâte de te revoir|plaisir de t’avoir|Profite bien/);
  assert.match(mail.emailText, /Sportivement,/);
  assert.match(mail.emailText, /David et toute l’équipe du Boxing Center/);
  assert.doesNotMatch(mail.emailText, /unsubscribe|desinscription|promo|29 euros/i);
});

test('anniversaire mail seulement, pas SMS', () => {
  const lib = fs.readFileSync(path.join(__dirname, '../storefront/lib/birthday-wishes.js'), 'utf8');
  const bot = fs.readFileSync(path.join(__dirname, '../bot/birthday-wishes.js'), 'utf8');
  assert.match(lib, /sms_disabled/);
  assert.doesNotMatch(lib, /await sendBirthdaySms/);
  assert.match(bot, /sendBirthdayWish\(member, \{ email: true \}\)/);
  assert.doesNotMatch(bot, /sms: Boolean\(out\.sms/);
});

test('parcours liste : zones BC 2/3/4/5/7, pas Balma, date sur la liste members', () => {
  const bot = fs.readFileSync(path.join(__dirname, '../bot/birthday-wishes.js'), 'utf8');
  const { zoneIds } = require('../bot/birthday-wishes');
  const zones = zoneIds().map(String).sort();
  assert.deepEqual(zones, ['2', '3', '4', '5', '7']);
  assert.match(bot, /staff\/v1\/members\?zoneId=/);
  assert.match(bot, /isBirthdayToday\(row\.birthdate/);
  assert.match(bot, /hydrateMember/);
});

test('ignore les fiches test', () => {
  assert.equal(isSkipMember({ first_name: 'TEST', last_name: 'TEST' }), true);
  assert.equal(isSkipMember({ first_name: 'Guillaume', last_name: 'CESSAC' }), false);
});

test('bot ops branche le poll minuit', () => {
  const src = fs.readFileSync(path.join(__dirname, '../bot/index.js'), 'utf8');
  assert.match(src, /maybeTriggerBirthdayWishes/);
  assert.match(src, /birthday-wishes/);
});

test('anniversaire passe par Brevo, pas Resend', () => {
  const src = fs.readFileSync(path.join(__dirname, '../storefront/lib/birthday-wishes.js'), 'utf8');
  assert.match(src, /sendEmailViaBrevo/);
  assert.match(src, /brevo-send/);
  assert.doesNotMatch(src, /resend-send|sendEmailViaResend/);
});
