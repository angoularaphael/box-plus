'use strict';

const crypto = require('crypto');

const COOKIE = 'bc_studio';
const MAX_AGE_SEC = 60 * 60 * 12;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 8;
const failsByIp = new Map();

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.SITE_API_SECRET ||
    process.env.ADMIN_SECRET ||
    'change-me'
  );
}

function expectedCode() {
  return String(process.env.DEV_UNLOCK_CODE || '302006').trim();
}

function base64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signJwt(payload) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('invalid token');
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  if (parts[2] !== expected) throw new Error('invalid signature');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('expired');
  }
  return payload;
}

function parseCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function cookieSecure() {
  return process.env.NODE_ENV === 'production' || String(process.env.VERCEL || '') === '1';
}

function setDevSessionCookie(res) {
  const token = signJwt({
    k: 'studio',
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  });
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (cookieSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearDevSessionCookie(res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'Max-Age=0', 'SameSite=Lax'];
  if (cookieSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getDevSession(req) {
  const token = parseCookie(req, COOKIE);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    if (payload.k !== 'studio') return null;
    return { ok: true };
  } catch {
    return null;
  }
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

function pruneFails(now) {
  for (const [ip, row] of failsByIp) {
    if (now - row.start > FAIL_WINDOW_MS) failsByIp.delete(ip);
  }
}

function unlockLocked(req) {
  pruneFails(Date.now());
  const row = failsByIp.get(clientIp(req));
  return Boolean(row && row.count >= FAIL_MAX);
}

function recordUnlockFail(req) {
  const now = Date.now();
  pruneFails(now);
  const ip = clientIp(req);
  const row = failsByIp.get(ip);
  if (!row || now - row.start > FAIL_WINDOW_MS) {
    failsByIp.set(ip, { start: now, count: 1 });
    return;
  }
  row.count += 1;
}

function clearUnlockFails(req) {
  failsByIp.delete(clientIp(req));
}

function codesMatch(input) {
  const expected = expectedCode();
  const a = Buffer.from(String(input || '').trim());
  const b = Buffer.from(expected);
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  getDevSession,
  setDevSessionCookie,
  clearDevSessionCookie,
  codesMatch,
  unlockLocked,
  recordUnlockFail,
  clearUnlockFails,
};
