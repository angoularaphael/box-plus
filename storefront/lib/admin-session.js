const { SignJWT, jwtVerify } = require('jose');

const COOKIE = 'bc_admin_session';

function secret() {
  const s =
    process.env.SESSION_SECRET ||
    process.env.SITE_API_SECRET ||
    process.env.ADMIN_SECRET ||
    'change-me';
  return new TextEncoder().encode(s);
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
  const token = await new SignJWT({
    email: user.email,
    role: user.role,
    name: user.name || '',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret());

  const { secure, ...rest } = cookieFlags();
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    `Path=${rest.path}`,
    'HttpOnly',
    `SameSite=${rest.sameSite}`,
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function getAdminSession(req) {
  const token = parseCookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
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
