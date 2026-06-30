const crypto = require('crypto');

const COOKIE = 'bc_admin_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

function sessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.SITE_API_SECRET ||
    process.env.ADMIN_SECRET ||
    'change-me'
  );
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

function cookieFlags() {
  const secure =
    process.env.NODE_ENV === 'production' || String(process.env.VERCEL || '') === '1';
  return { httpOnly: true, sameSite: 'Lax', path: '/', secure };
}

async function setAdminSessionCookie(res, user) {
  const token = signJwt({
    email: user.email,
    role: user.role,
    name: user.name || '',
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  });

  const { secure, ...rest } = cookieFlags();
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    `Path=${rest.path}`,
    'HttpOnly',
    `SameSite=${rest.sameSite}`,
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function getAdminSession(req) {
  const token = parseCookie(req, COOKIE);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    return { email: payload.email, role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}

function clearAdminSessionCookie(res) {
  const { secure } = cookieFlags();
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = {
  setAdminSessionCookie,
  getAdminSession,
  clearAdminSessionCookie,
};
