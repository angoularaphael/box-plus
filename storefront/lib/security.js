'use strict';

const crypto = require('crypto');

const INSECURE_SECRETS = new Set(['', 'change-me', 'change-me-in-production']);

let devSessionFallback = '';

function isProductionRuntime() {
  return (
    String(process.env.NODE_ENV || '').toLowerCase() === 'production' ||
    String(process.env.VERCEL || '') === '1'
  );
}

function isDemoCheckoutAllowed() {
  if (String(process.env.STORE_DEMO_ENABLED || 'false') !== 'true') return false;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return false;
  return true;
}

function secretsEqual(provided, expected) {
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (!b.length) return false;
  const a = Buffer.from(String(provided || ''), 'utf8');
  const ha = crypto.createHmac('sha256', b).update(a).digest();
  const hb = crypto.createHmac('sha256', b).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hmacEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function configuredSecret(...candidates) {
  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (value && !INSECURE_SECRETS.has(value)) return value;
  }
  return '';
}

function sessionSecret() {
  const fromEnv = configuredSecret(
    process.env.SESSION_SECRET,
    process.env.SITE_API_SECRET,
    process.env.ADMIN_SECRET
  );
  if (fromEnv) return fromEnv;
  if (isProductionRuntime()) return '';
  if (!devSessionFallback) devSessionFallback = crypto.randomBytes(32).toString('hex');
  return devSessionFallback;
}

function sanitizeOrderId(id) {
  const s = String(id || '').trim();
  if (!s || s.length < 4 || s.length > 80) return null;
  if (s.includes('..') || s.includes('/') || s.includes('\\')) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return s;
}

function sanitizePaymentId(id) {
  const s = String(id || '').trim();
  if (!s || s.length < 6 || s.length > 200) return null;
  if (s.includes('..') || s.includes('/') || s.includes('\\')) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

function maskIban(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  if (s.length < 8) return '••••';
  return `${s.slice(0, 4)} •••• •••• ${s.slice(-4)}`;
}

function redactOrderForClient(order) {
  if (!order) return order;
  const { access_token, ...rest } = order;
  const safe = { ...rest };
  const iban = order.payment?.iban || order.customer_full?.iban || '';
  const masked = maskIban(iban);
  const hasIban = Boolean(iban);
  if (safe.payment) {
    safe.payment = { ...safe.payment };
    delete safe.payment.iban;
    if (hasIban) {
      safe.payment.has_iban = true;
      safe.payment.iban_masked = masked;
    }
  }
  if (safe.customer_full) {
    safe.customer_full = { ...safe.customer_full };
    delete safe.customer_full.iban;
    if (hasIban) {
      safe.customer_full.has_iban = true;
      safe.customer_full.iban_masked = masked;
    }
  }
  if (safe.documents?.photo_base64) {
    safe.documents = {
      ...safe.documents,
      photo_base64: true,
      has_photo: true,
    };
  }
  if (safe.signature?.image_base64) {
    safe.signature = { ...safe.signature, image_base64: true };
  }
  return safe;
}

function clientIp(req) {
  const vercel = String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (vercel) return vercel;
  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fwd.length) {
    return isProductionRuntime() ? fwd[fwd.length - 1] : fwd[0];
  }
  return req.socket?.remoteAddress || 'unknown';
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;
const loginFails = new Map();

function pruneLoginFails(now) {
  for (const [ip, row] of loginFails) {
    if (now - row.start > LOGIN_WINDOW_MS) loginFails.delete(ip);
  }
}

function loginLocked(req) {
  pruneLoginFails(Date.now());
  const row = loginFails.get(clientIp(req));
  return Boolean(row && row.count >= LOGIN_MAX);
}

function recordLoginFail(req) {
  const now = Date.now();
  pruneLoginFails(now);
  const ip = clientIp(req);
  const row = loginFails.get(ip);
  if (!row || now - row.start > LOGIN_WINDOW_MS) {
    loginFails.set(ip, { start: now, count: 1 });
    return;
  }
  row.count += 1;
}

function clearLoginFails(req) {
  loginFails.delete(clientIp(req));
}

function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // camera=(self) : photo adhérent via getUserMedia sur /inscription
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (isProductionRuntime()) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  if (typeof next === 'function') next();
}

const PHOTO_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function photoExtForMime(mime) {
  return PHOTO_MIME_EXT[String(mime || '').toLowerCase()] || null;
}

function looksLikeAllowedImage(buf, mime) {
  if (!buf || buf.length < 12) return false;
  const kind = String(mime || '').toLowerCase();
  if (kind === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (kind === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (kind === 'image/webp') {
    return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function publicServerError() {
  return 'Une erreur est survenue';
}

module.exports = {
  isProductionRuntime,
  isDemoCheckoutAllowed,
  secretsEqual,
  hmacEqual,
  configuredSecret,
  sessionSecret,
  sanitizeOrderId,
  sanitizePaymentId,
  maskIban,
  redactOrderForClient,
  clientIp,
  loginLocked,
  recordLoginFail,
  clearLoginFails,
  applySecurityHeaders,
  photoExtForMime,
  looksLikeAllowedImage,
  publicServerError,
  PHOTO_MIME_EXT,
};
