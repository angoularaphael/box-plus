'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  parseOtpMessage,
  selectOtpMailboxes,
} = require('../bot/deciplus-otp-imap');

const FIXTURES = path.join(__dirname, 'fixtures');

test('extrait un OTP 3+3 depuis un email texte synthétique', async () => {
  const source = fs.readFileSync(path.join(FIXTURES, 'deciplus-otp-text.eml'));
  const parsed = await parseOtpMessage(source);
  assert.equal(parsed.matches, true);
  assert.equal(parsed.code, '482913');
  assert.equal(parsed.hasText, true);
});

test('extrait un OTP depuis un email HTML synthétique', async () => {
  const source = fs.readFileSync(path.join(FIXTURES, 'deciplus-otp-html.eml'));
  const parsed = await parseOtpMessage(source);
  assert.equal(parsed.matches, true);
  assert.equal(parsed.code, '731456');
  assert.equal(parsed.hasHtml, true);
});

test('sélectionne INBOX, Tous les messages et Spam via special-use', () => {
  const selected = selectOtpMailboxes([
    { path: '[Gmail]/Spam', specialUse: '\\Junk' },
    { path: 'INBOX', specialUse: '\\Inbox' },
    { path: '[Gmail]/Tous les messages', specialUse: '\\All' },
    { path: '[Gmail]/Corbeille', specialUse: '\\Trash' },
  ]);
  assert.deepEqual(selected, [
    { path: 'INBOX', role: 'inbox' },
    { path: '[Gmail]/Tous les messages', role: 'all' },
    { path: '[Gmail]/Spam', role: 'spam' },
  ]);
});
