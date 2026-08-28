'use strict';

const DEFAULT_WHATSAPP_BOT_URL = 'http://us3.bot-hosting.net:21819';
const DEFAULT_WHATSAPP_BOT_SECRET = 'bxp-boutique-wa-k8n4Qp2mL7xR';

function whatsappBotUrl() {
  const raw =
    process.env.WHATSAPP_BOT_URL ||
    process.env.WHATSAPP_REFERRAL_BOT_URL ||
    DEFAULT_WHATSAPP_BOT_URL;
  let url = String(raw || '')
    .trim()
    .replace(/\/$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

function botSecret() {
  return String(process.env.WHATSAPP_BOT_SECRET || DEFAULT_WHATSAPP_BOT_SECRET || '').trim();
}

function botHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const secret = botSecret();
  if (secret) headers['x-api-secret'] = secret;
  return headers;
}

async function botFetch(path, { method = 'GET', body, timeoutMs = 18000 } = {}) {
  const base = whatsappBotUrl();
  if (!base) throw new Error('WHATSAPP_BOT_URL manquant');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: botHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 180) || `HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function toWhatsAppPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 10) digits = `33${digits.slice(1)}`;
  if (digits.startsWith('330') && digits.length === 12) digits = `33${digits.slice(3)}`;
  return digits.length >= 10 ? digits : null;
}

async function getWhatsAppStatus({ includeQr = false } = {}) {
  const url = whatsappBotUrl();
  if (!url) {
    return { configured: false, connected: false, error: 'WHATSAPP_BOT_URL manquant' };
  }
  try {
    const data = await botFetch(includeQr ? '/api/status?qr=1' : '/api/status', {
      timeoutMs: includeQr ? 12000 : 8000,
    });
    return {
      configured: true,
      reachable: true,
      host: new URL(url).host,
      connected: Boolean(data.connected),
      connecting: Boolean(data.connecting),
      hasQr: Boolean(data.qr || data.hasQr),
      qr: data.qr || null,
      pairingCode: data.pairingCode || null,
      qrError: data.qrError || null,
      build: data.build || null,
      me: data.me || null,
    };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      host: (() => {
        try {
          return new URL(url).host;
        } catch {
          return url;
        }
      })(),
      connected: false,
      error: err.message || 'Bot inaccessible',
    };
  }
}

async function startWhatsAppBot(body = {}) {
  const pairing = String(body?.method || '').toLowerCase() === 'pair';
  return botFetch('/api/start', {
    method: 'POST',
    body: { method: 'qr', ...body },
    timeoutMs: pairing ? 25000 : 18000,
  });
}

async function stopWhatsAppBot() {
  return botFetch('/api/stop', { method: 'POST', timeoutMs: 8000 });
}

async function logoutWhatsAppBot() {
  return botFetch('/api/logout', { method: 'POST', timeoutMs: 10000 });
}

async function sendWhatsAppMessage(phone, message) {
  const to = toWhatsAppPhone(phone);
  if (!to) throw new Error('Numéro WhatsApp invalide');
  return botFetch('/api/send-message', {
    method: 'POST',
    body: { phone: to, message },
    timeoutMs: 45000,
  });
}

module.exports = {
  DEFAULT_WHATSAPP_BOT_URL,
  DEFAULT_WHATSAPP_BOT_SECRET,
  whatsappBotUrl,
  toWhatsAppPhone,
  getWhatsAppStatus,
  startWhatsAppBot,
  stopWhatsAppBot,
  logoutWhatsAppBot,
  sendWhatsAppMessage,
};
