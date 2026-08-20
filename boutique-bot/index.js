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
  fetchLatestBaileysVersion,
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
let qrError = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

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
  }
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version = [2, 3000, 1015901307];
  try {
    version = (await fetchLatestBaileysVersion()).version;
  } catch {
    console.warn('[boutique-bot] version WA par défaut');
  }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Boxplus Boutique', 'Chrome', '120.0.0.0'],
    qrTimeout: 60000,
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
      qrError = null;
      reconnectAttempts = 0;
      cancelReconnect();
      console.log('[boutique-bot] WhatsApp connecté');
    }
    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      await destroySocket();
      if (loggedOut) {
        isLinking = false;
        currentQrBase64 = null;
        reconnectAttempts = 0;
        clearAuthSession();
        return;
      }
      if (isQrExpiredError(lastDisconnect?.error)) {
        currentQrBase64 = null;
        scheduleReconnect(2500, { clearAuth: true });
        return;
      }
      const delay = statusCode === DisconnectReason.restartRequired ? 1500 : 5000;
      scheduleReconnect(delay, { clearAuth: false });
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
    qrError,
  });
});

app.post('/api/start', async (req, res) => {
  if (isConnected) return res.json({ ok: true, success: true, message: 'Already connected', connected: true });
  reconnectAttempts = 0;
  qrError = null;
  currentQrBase64 = null;
  const wantsQr = req.body?.forceQr === true || String(req.body?.method || '').toLowerCase() === 'qr';
  const clearAuth = wantsQr || !hasRegisteredSession();
  await connectToWhatsApp({ force: true, clearAuth });
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline && !isConnected && !currentQrBase64 && !qrError) {
    await new Promise((r) => setTimeout(r, 200));
  }
  res.json({
    ok: true,
    success: true,
    message: currentQrBase64 ? 'QR ready' : isConnected ? 'Already connected' : 'Connection started',
    connected: isConnected,
    hasQr: Boolean(currentQrBase64),
    qr: currentQrBase64,
    qrError,
  });
});

app.post('/api/stop', async (_req, res) => {
  cancelReconnect();
  isLinking = false;
  await destroySocket();
  isConnected = false;
  currentQrBase64 = null;
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
