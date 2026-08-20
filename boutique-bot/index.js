/**
 * Boutique Boxing Center — bot WhatsApp dédié (Baileys).
 * Uniquement : QR, session, envoi de messages (parrainage Offre Duo).
 * Pas de campagnes, pas de Deciplus, pas de commandes admin.
 *
 * Bot Hosting : coller bootstrap.js en /home/container/index.js
 * (il clone box-plus et lance ce fichier).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '21819', 10) || 21819;
const HOST = process.env.HOST || '0.0.0.0';
const SITE_API_SECRET = String(process.env.SITE_API_SECRET || process.env.WHATSAPP_BOT_SECRET || '').trim();
const AUTH_DIR = process.env.WA_AUTH_DIR
  ? path.resolve(process.env.WA_AUTH_DIR)
  : path.join(__dirname, 'auth_info_baileys');
const MAX_RECONNECT_ATTEMPTS = 8;

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

let sock = null;
let isConnected = false;
let isLinking = false;
let currentQrBase64 = null;
let pairingCode = null;
let qrError = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waBrowser() {
  try {
    return Browsers.ubuntu('Chrome');
  } catch {
    return ['Ubuntu', 'Chrome', '22.04.4'];
  }
}

function formatPairingCode(code) {
  const raw = String(code || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return raw.replace(/(.{4})/g, '$1 ').trim();
}

function normalizePhone(input) {
  let d = String(input || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 10) d = `33${d.slice(1)}`;
  if (d.startsWith('330') && d.length === 12) d = `33${d.slice(3)}`;
  return d;
}

function phoneToJid(phone) {
  const p = normalizePhone(phone);
  return p ? `${p}@s.whatsapp.net` : '';
}

function verifyApiSecret(req, res) {
  if (!SITE_API_SECRET) {
    res.status(500).json({ error: 'SITE_API_SECRET manquant sur le bot' });
    return false;
  }
  const secret =
    req.headers['x-api-secret'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (secret !== SITE_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function hasRegisteredSession() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    return Boolean(creds.registered || creds.me);
  } catch {
    return false;
  }
}

function clearAuthSession() {
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function isQrExpiredError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('qr') && (msg.includes('expir') || msg.includes('timeout'));
}

async function destroySocket() {
  const old = sock;
  sock = null;
  if (!old) return;
  try {
    old.ev.removeAllListeners();
    await old.end(undefined);
  } catch (err) {
    console.warn('[boutique-bot] fermeture socket:', err.message);
  }
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(delayMs, { clearAuth = false } = {}) {
  cancelReconnect();
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    isLinking = false;
    qrError = 'Trop de tentatives. Clique Afficher le QR dans le backoffice boutique.';
    return;
  }
  reconnectAttempts += 1;
  isLinking = true;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToWhatsApp({ force: true, clearAuth }).catch((err) => {
      console.error('[boutique-bot] reconnexion:', err.message);
    });
  }, delayMs);
}

async function connectToWhatsApp({ force = false, clearAuth = false } = {}) {
  if (isConnected && sock && !force) return;
  if (isLinking && !force) return;

  isLinking = true;
  qrError = null;
  cancelReconnect();
  await destroySocket();

  if (clearAuth) {
    clearAuthSession();
    currentQrBase64 = null;
    pairingCode = null;
  }
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: waBrowser(),
    qrTimeout: 120000,
    connectTimeoutMs: 60000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        currentQrBase64 = await qrcode.toDataURL(qr);
        qrError = null;
        reconnectAttempts = 0;
        console.log('[boutique-bot] QR prêt — scanne depuis /admin/#whatsapp');
      } catch (err) {
        qrError = err.message;
      }
    }
    if (connection === 'open') {
      isConnected = true;
      isLinking = false;
      currentQrBase64 = null;
      pairingCode = null;
      qrError = null;
      reconnectAttempts = 0;
      cancelReconnect();
      console.log('[boutique-bot] WhatsApp connecté');
    }
    if (connection === 'close') {
      isConnected = false;
      const statusCode = Number(lastDisconnect?.error?.output?.statusCode);
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const restartRequired =
        statusCode === DisconnectReason.restartRequired || statusCode === 515;
      console.warn('[boutique-bot] close', statusCode || lastDisconnect?.error?.message || '');
      const old = sock;
      sock = null;
      try {
        old?.ev.removeAllListeners();
      } catch {
        /* ignore */
      }
      if (loggedOut) {
        isLinking = false;
        currentQrBase64 = null;
        pairingCode = null;
        reconnectAttempts = 0;
        clearAuthSession();
        try {
          await old?.end(undefined);
        } catch {
          /* ignore */
        }
        qrError = 'Session WhatsApp expirée. Clique Afficher le QR.';
        return;
      }
      if (!restartRequired) {
        try {
          await old?.end(undefined);
        } catch {
          /* ignore */
        }
      }
      if (isQrExpiredError(lastDisconnect?.error)) {
        currentQrBase64 = null;
        pairingCode = null;
        scheduleReconnect(2000, { clearAuth: true });
        return;
      }
      scheduleReconnect(restartRequired ? 400 : 4000, { clearAuth: false });
    }
  });
}

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'boxplus-boutique-bot', status: '/api/status' });
});

app.get('/api/status', (req, res) => {
  const includeQr = String(req.query.qr || '') === '1';
  res.json({
    ok: true,
    service: 'boxplus-boutique-bot',
    connected: isConnected,
    connecting: isLinking && !isConnected,
    hasQr: Boolean(currentQrBase64),
    qr: includeQr || !isConnected ? currentQrBase64 : null,
    pairingCode,
    qrError,
  });
});

app.post('/api/start', async (req, res) => {
  if (isConnected) {
    return res.json({ ok: true, success: true, message: 'Already connected', connected: true });
  }
  const method = String(req.body?.method || 'qr').toLowerCase();
  const forceQr = req.body?.forceQr === true;
  const phone = normalizePhone(req.body?.phone);

  if (!forceQr && method !== 'pair' && isLinking && (currentQrBase64 || pairingCode)) {
    return res.json({
      ok: true,
      success: true,
      message: 'QR ready',
      connected: false,
      connecting: true,
      hasQr: Boolean(currentQrBase64),
      qr: currentQrBase64,
      pairingCode,
      qrError,
    });
  }

  reconnectAttempts = 0;
  qrError = null;
  const clearAuth = forceQr || method === 'pair' || !hasRegisteredSession();
  await connectToWhatsApp({ force: true, clearAuth });

  if (method === 'pair') {
    if (!phone || phone.length < 10) {
      return res.status(400).json({ ok: false, error: 'Numéro WhatsApp requis (06…)' });
    }
    if (!sock?.requestPairingCode) {
      return res.status(500).json({
        ok: false,
        error: 'Code d’association indisponible. Redémarre le bot boutique.',
      });
    }
    try {
      await sleep(400);
      const raw = await sock.requestPairingCode(phone);
      pairingCode = formatPairingCode(raw);
      currentQrBase64 = null;
      console.log('[boutique-bot] code d’association', pairingCode);
    } catch (err) {
      qrError = err.message;
      return res.status(500).json({ ok: false, error: err.message });
    }
    return res.json({
      ok: true,
      success: true,
      message: 'Pairing code ready',
      connecting: true,
      pairingCode,
      qrError,
    });
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !isConnected && !currentQrBase64 && !qrError) {
    await sleep(200);
  }
  res.json({
    ok: true,
    success: true,
    message: currentQrBase64 ? 'QR ready' : isConnected ? 'Already connected' : 'Connection started',
    connected: isConnected,
    connecting: isLinking && !isConnected,
    hasQr: Boolean(currentQrBase64),
    qr: currentQrBase64,
    pairingCode,
    qrError,
  });
});

app.post('/api/stop', async (_req, res) => {
  cancelReconnect();
  isLinking = false;
  await destroySocket();
  isConnected = false;
  currentQrBase64 = null;
  pairingCode = null;
  res.json({ ok: true, success: true, message: 'Stopped' });
});

app.post('/api/logout', async (_req, res) => {
  cancelReconnect();
  isLinking = false;
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      console.warn('[boutique-bot] logout:', err.message);
    }
  }
  await destroySocket();
  isConnected = false;
  currentQrBase64 = null;
  pairingCode = null;
  clearAuthSession();
  res.json({ ok: true, success: true, message: 'Logged out' });
});

app.post('/api/send-message', async (req, res) => {
  if (!verifyApiSecret(req, res)) return;
  if (!isConnected || !sock) return res.status(503).json({ error: 'Bot not connected' });
  const { phone, message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  const jid = phoneToJid(phone);
  if (!jid) return res.status(400).json({ error: 'phone required' });
  try {
    await sock.sendMessage(jid, { text: String(message) });
    res.json({ ok: true, success: true, phone: normalizePhone(phone) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

setTimeout(() => {
  if (hasRegisteredSession()) {
    console.log('[boutique-bot] session existante — reconnexion');
    connectToWhatsApp({ force: true, clearAuth: false }).catch((err) => {
      console.error('[boutique-bot] auto-connect:', err.message);
    });
  }
}, 1500);

app.listen(PORT, HOST, () => {
  console.log(`[boutique-bot] http://${HOST}:${PORT}`);
  console.log('[boutique-bot] QR : backoffice boutique → WhatsApp');
  if (!SITE_API_SECRET) console.warn('[boutique-bot] SITE_API_SECRET manquant');
});
