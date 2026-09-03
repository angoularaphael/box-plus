'use strict';

const DEFAULT_SMS_GATEWAY_URL = 'http://prem-eu2.bot-hosting.net:21724';

let cachedToken = null;
let cachedTokenAt = 0;

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

function smsAdminEmail() {
  return String(
    process.env.SMS_GATEWAY_EMAIL || process.env.ADMIN_EMAIL || 'angoularaphael05@gmail.com'
  ).trim();
}

function smsAdminPassword() {
  return String(process.env.SMS_GATEWAY_PASSWORD || process.env.ADMIN_PASSWORD || 'Fareno12').trim();
}

function smsHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value) headers[key] = value;
  }
  const secret = smsSecret();
  if (secret && !headers['x-api-secret'] && !headers.Authorization) {
    headers['x-api-secret'] = secret;
  }
  return headers;
}

async function smsFetch(path, { method = 'GET', body, timeoutMs = 18000, headers: extra } = {}) {
  const base = smsGatewayUrl();
  if (!base) throw new Error('SMS_GATEWAY_URL manquant');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: smsHeaders(extra),
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

function toGsmSafe(text) {
  return String(text || '')
    .replace(/€/g, 'euros')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ê/g, 'e')
    .replace(/Ê/g, 'E')
    .replace(/î/g, 'i')
    .replace(/Î/g, 'I')
    .replace(/ô/g, 'o')
    .replace(/Ô/g, 'O')
    .replace(/â/g, 'a')
    .replace(/Â/g, 'A')
    .replace(/\*/g, '')
    .replace(/~/g, '-')
    .replace(/[🚀🔥💥⏳🥊🚨]/g, '')
    .replace(/ +/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

async function smsGatewayToken(timeoutMs = 18000) {
  if (cachedToken && Date.now() - cachedTokenAt < 50 * 60 * 1000) return cachedToken;
  const email = smsAdminEmail();
  const password = smsAdminPassword();
  if (!email || !password) {
    throw new Error('SMS_GATEWAY_EMAIL / SMS_GATEWAY_PASSWORD manquants (repli campagne)');
  }
  const data = await smsFetch('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    timeoutMs,
  });
  if (!data?.token) throw new Error('Login SMS gateway sans token');
  cachedToken = data.token;
  cachedTokenAt = Date.now();
  return cachedToken;
}

async function sendViaCampaignQueue(telephone, message, { timeoutMs = 25000, source = 'boutique' } = {}) {
  const text = toGsmSafe(message);
  if (!text) throw new Error('Message vide');
  const token = await smsGatewayToken(timeoutMs);
  const auth = { Authorization: `Bearer ${token}` };
  const campaign = await smsFetch('/api/campaigns', {
    method: 'POST',
    timeoutMs,
    headers: auth,
    body: {
      name: `Boutique SMS ${source} ${Date.now()}`.slice(0, 80),
      message: text,
    },
  });
  if (!campaign?.id) throw new Error('Création campagne SMS échouée');
  const digits = String(telephone || '').replace(/\D/g, '');
  await smsFetch(`/api/campaigns/${campaign.id}/contacts`, {
    method: 'POST',
    timeoutMs,
    headers: auth,
    body: { prenom: 'Client', nom: source || '-', telephone: digits },
  });
  const start = await smsFetch(`/api/campaigns/${campaign.id}/start`, {
    method: 'POST',
    timeoutMs,
    headers: auth,
  });
  if (!start?.queued) {
    throw new Error(start?.error || 'SMS non mis en file (campagne)');
  }
  return {
    sent: true,
    queued: true,
    via: 'sms-campaign',
    campaignId: campaign.id,
    telephone,
    queuedCount: start.queued,
  };
}

function shouldFallbackToCampaign(err) {
  const msg = String(err?.message || '');
  if (/envois sms en pause/i.test(msg)) return false;
  if (/fetch failed|UND_ERR|ECONNRESET|ETIMEDOUT|timeout|socket/i.test(msg)) return false;
  return true;
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

async function sendWhatsAppMessage(phone, message, { timeoutMs = 20000, source = 'boutique' } = {}) {
  const to = toE164(phone);
  if (!to) throw new Error('Numéro invalide');
  const { isAllWhatsAppPaused } = require('./whatsapp-outbound');
  if (isAllWhatsAppPaused()) throw new Error('Envois SMS en pause');
  try {
    const result = await smsFetch('/api/messages/send', {
      method: 'POST',
      body: { telephone: to, message, source },
      timeoutMs,
    });
    return { sent: true, via: 'sms', ...result };
  } catch (err) {
    if (!shouldFallbackToCampaign(err)) throw err;
    return sendViaCampaignQueue(to, message, { timeoutMs: Math.max(timeoutMs, 25000), source });
  }
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
