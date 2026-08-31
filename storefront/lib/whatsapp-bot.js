'use strict';

const DEFAULT_SMS_GATEWAY_URL = 'http://prem-eu2.bot-hosting.net:21724';

function smsGatewayUrl() {
  const raw = process.env.SMS_GATEWAY_URL || DEFAULT_SMS_GATEWAY_URL;
  let url = String(raw || '')
    .trim()
    .replace(/\/$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

function smsSecret() {
  return String(process.env.SMS_GATEWAY_SECRET || process.env.OUTBOUND_API_SECRET || '').trim();
}

function smsHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const secret = smsSecret();
  if (secret) headers['x-api-secret'] = secret;
  return headers;
}

async function smsFetch(path, { method = 'GET', body, timeoutMs = 18000 } = {}) {
  const base = smsGatewayUrl();
  if (!base) throw new Error('SMS_GATEWAY_URL manquant');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: smsHeaders(),
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

function toE164(raw) {
  const digits = toWhatsAppPhone(raw);
  if (!digits) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

async function getWhatsAppStatus() {
  const { isAllWhatsAppPaused, isPromoWhatsAppPaused, promoPauseReason, BATCH_SIZE } = require('./whatsapp-outbound');
  const outbound = {
    promoPaused: isPromoWhatsAppPaused(),
    allPaused: isAllWhatsAppPaused(),
    reason: promoPauseReason(),
    channel: 'sms',
    batchSize: BATCH_SIZE,
  };
  const url = smsGatewayUrl();
  if (!url) {
    return { configured: false, connected: false, error: 'SMS_GATEWAY_URL manquant', outbound, channel: 'sms' };
  }
  try {
    const data = await smsFetch('/api/health', { timeoutMs: 8000 });
    const ok = Boolean(data.ok);
    return {
      configured: true,
      reachable: true,
      host: new URL(url).host,
      connected: ok,
      connecting: false,
      hasQr: false,
      qr: null,
      pairingCode: null,
      qrError: null,
      build: 'sms-gateway',
      me: ok ? { id: 'sms-gateway', name: 'SMS Gateway' } : null,
      outbound,
      channel: 'sms',
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
      error: err.message || 'SMS gateway inaccessible',
      outbound,
      channel: 'sms',
    };
  }
}

async function startWhatsAppBot() {
  return getWhatsAppStatus();
}

async function stopWhatsAppBot() {
  return { ok: true, channel: 'sms', skipped: true };
}

async function logoutWhatsAppBot() {
  return { ok: true, channel: 'sms', skipped: true };
}

async function sendWhatsAppMessage(phone, message, { timeoutMs = 15000 } = {}) {
  const to = toE164(phone);
  if (!to) throw new Error('Numéro invalide');
  const { isAllWhatsAppPaused } = require('./whatsapp-outbound');
  if (isAllWhatsAppPaused()) throw new Error('Envois SMS en pause');
  const result = await smsFetch('/api/messages/send', {
    method: 'POST',
    body: { telephone: to, message, source: 'boutique' },
    timeoutMs,
  });
  return { sent: true, via: 'sms', ...result };
}

async function clearWhatsAppOutboundQueue() {
  return { ok: true, channel: 'sms', skipped: true };
}

module.exports = {
  DEFAULT_WHATSAPP_BOT_URL: DEFAULT_SMS_GATEWAY_URL,
  DEFAULT_WHATSAPP_BOT_SECRET: '',
  DEFAULT_SMS_GATEWAY_URL,
  whatsappBotUrl: smsGatewayUrl,
  toWhatsAppPhone,
  getWhatsAppStatus,
  startWhatsAppBot,
  stopWhatsAppBot,
  logoutWhatsAppBot,
  sendWhatsAppMessage,
  clearWhatsAppOutboundQueue,
};
