#!/usr/bin/env node
'use strict';

const { extractOtpCode, looksLikeDeciplusOtpMail } = require('../bot/deciplus-otp-imap');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(extractOtpCode('Votre code : 482913') === '482913', 'labeled 6 digits');
assert(extractOtpCode('Code de vérification Deciplus 193847') === '193847', 'deciplus phrasing');
assert(
  looksLikeDeciplusOtpMail({
    subject: 'Votre code Deciplus',
    from: 'noreply@deciplus.pro',
    text: 'Code : 123456',
  }),
  'detect deciplus mail'
);
assert(
  !looksLikeDeciplusOtpMail({
    subject: 'Newsletter promo',
    from: 'promo@shop.com',
    text: 'Bonjour',
  }),
  'reject unrelated'
);

console.log('OK deciplus OTP unit');
