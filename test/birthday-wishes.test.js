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
  buildBirthdaySms,
  firstNameOf,
  FROM_NAME,
  FROM_EMAIL,
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
  const mail = buildBirthdayEmail({ first_name: 'Guillaume', last_name: 'CESSAC' });
  assert.equal(mail.fromName, FROM_NAME);
  assert.equal(mail.fromEmail, FROM_EMAIL);
  assert.equal(mail.html, undefined);
  assert.equal(mail.headers, undefined);
  assert.match(mail.subject, /Guillaume, c’est David/);
  assert.doesNotMatch(mail.subject, /Boxing Center|anniversaire|offre/i);
  assert.match(mail.emailText, /Salut Guillaume,/);
  assert.match(mail.emailText, /David et toute l’equipe Boxing Center te souhaitent un joyeux anniversaire/);
  assert.match(mail.emailText, /David et toute l’equipe Boxing Center/);
  assert.doesNotMatch(mail.emailText, /unsubscribe|desinscription|promo|29 euros/i);
});

test('SMS signe David et l’equipe', () => {
  const sms = buildBirthdaySms({ first_name: 'Guillaume' });
  assert.match(sms, /Salut Guillaume/);
  assert.match(sms, /joyeux anniversaire/);
  assert.match(sms, /David et toute l’equipe Boxing Center/);
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
