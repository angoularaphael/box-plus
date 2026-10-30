'use strict';

const crypto = require('crypto');

function signCheckoutToken(secret, sessionId, profileId, expiresUnix) {
  return crypto.createHmac('sha256', String(secret)).update(`${sessionId}.${expiresUnix}.${profileId}`).digest('hex');
}

function verifyCheckoutToken(secret, sessionId, profileId, expiresUnix, provided) {
  if (!secret || !sessionId || !profileId || !Number.isFinite(expiresUnix) || !provided) return false;
  const expected = signCheckoutToken(secret, sessionId, profileId, expiresUnix);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(provided).trim().toLowerCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseAppCheckoutQuery(query = {}) {
  const sessionId = typeof query.cs === 'string' ? query.cs.trim() : '';
  const profileId = typeof query.pid === 'string' ? query.pid.trim() : '';
  const expiresUnix = Number(typeof query.exp === 'string' ? query.exp : query.exp);
  const signature = typeof query.sig === 'string' ? query.sig.trim() : '';
  const offerSlug = typeof query.offer === 'string' ? query.offer.trim().toLowerCase().slice(0, 80) : '';
  const club = typeof query.club === 'string' ? query.club.trim().toLowerCase() : '';
  if (!sessionId || !profileId || !signature || !offerSlug || !club) return null;
  return { sessionId, profileId, expiresUnix, signature, offerSlug, club };
}

module.exports = { signCheckoutToken, verifyCheckoutToken, parseAppCheckoutQuery };
