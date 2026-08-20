/**
 * Boutique Boxing Center — bot WhatsApp dédié (Baileys).
 * Uniquement : QR, session, envoi de messages (parrainage Offre Duo).
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
const baileys = require('@whiskeysockets/baileys');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = baileys;

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '21819', 10) || 21819;
const HOST = process.env.HOST || '0.0.0.0';
const SITE_API_SECRET = String(process.env.SITE_API_SECRET || process.env.WHATSAPP_BOT_SECRET || '').trim();
const AUTH_DIR = process.env.WA_AUTH_DIR
  ? path.resolve(process.env.WA_AUTH_DIR)
  : path.join(__dirname, 'auth_info_baileys');
const MAX_RECONNECT_ATTEMPTS = 8;
const QR_REUSE_MS = 18000;
const BUILD = 'wa-link-2';

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

const silentLogger = pino({ level: 'silent' });

let sock = null;
let connectGen = 0;
let isConnected = false;
let isLinking = false;
let currentQrBase64 = null;
let qrGeneratedAt = 0;
let pairingCode = null;
let pendingPairPhone = null;
let pairingRequested = false;
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

function hasFreshQr() {
  return Boolean(currentQrBase64 && Date.now() - qrGeneratedAt < QR_REUSE_MS);
}

function clearAuthSession() {
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function isQrExpiredError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('qr') && (msg.includes('expir') || msg.includes('timeout'));
}

function disconnectCode(lastDisconnect) {
  return Number(lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || 0);
}

let cachedWaVersion;
let waVersionReady = false;

async function loadWaVersionOnce() {
  if (waVersionReady) return cachedWaVersion;
  if (typeof baileys.fetchLatestBaileysVersion !== 'function') {
    waVersionReady = true;
    return undefined;
  }
  try {
    const { version } = await Promise.race([
      baileys.fetchLatestBaileysVersion(),
      sleep(8000).then(() => {
        throw new Error('timeout version WA');
      }),
    ]);
    if (Array.isArray(version) && version.length) {
      cachedWaVersion = version;
      console.log('[boutique-bot] version WA', version.join('.'));
    }
  } catch (err) {
    console.warn('[boutique-bot] version WA par défaut:', err.message);
  }
  waVersionReady = true;
  return cachedWaVersion;
}

function wrapAuthKeys(keys) {
  if (typeof baileys.makeCacheableSignalKeyStore !== 'function') return keys;
  try {
    return baileys.makeCacheableSignalKeyStore(keys, silentLogger);
  } catch {
    return keys;
  }
}

async function destroySocket() {
  const old = sock;
  sock = null;
  if (!old) return;
  try {
    old.ev.removeAllListeners();
  } catch {
    /* ignore */
  }
  try {
    await Promise.race([old.end(undefined), sleep(400)]);
  } catch {
    /* ignore */
  }
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(delayMs, { clearAuth = false, countAttempt = true } = {}) {
  cancelReconnect();
  if (countAttempt) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      isLinking = false;
      qrError = 'Trop de tentatives. Clique Afficher le QR dans le backoffice boutique.';
      return;
    }
    reconnectAttempts += 1;
  }
  isLinking = true;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToWhatsApp({ force: true, clearAuth }).catch((err) => {
      console.error('[boutique-bot] reconnexion:', err.message);
    });
  }, delayMs);
}

async function requestPairingIfNeeded() {
  if (!pendingPairPhone || pairingRequested || !sock) return;
  if (sock.authState?.creds?.registered) return;
  if (typeof sock.requestPairingCode !== 'function') {
    qrError = 'Code d’association indisponible. Redémarre le bot boutique.';
    return;
  }
  pairingRequested = true;
  try {
    await sleep(250);
    const raw = await sock.requestPairingCode(pendingPairPhone);
    pairingCode = formatPairingCode(raw);
    currentQrBase64 = null;
    qrError = null;
    console.log('[boutique-bot] code d’association', pairingCode);
  } catch (err) {
    pairingRequested = false;
    qrError = err.message || 'Code d’association refusé';
    console.warn('[boutique-bot] pairing:', qrError);
  }
}

let connectMutex = Promise.resolve();

async function connectToWhatsApp(opts = {}) {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const prev = connectMutex;
  connectMutex = wait;
  await prev;
  try {
    return await connectToWhatsAppUnlocked(opts);
  } finally {
    release();
  }
}

async function connectToWhatsAppUnlocked({ force = false, clearAuth = false } = {}) {
  if (isConnected && sock && !force) return;
  if (isLinking && !force) return;

  const gen = ++connectGen;
  isLinking = true;
  qrError = null;
  pairingRequested = false;
  cancelReconnect();
  await destroySocket();

  if (clearAuth) {
    clearAuthSession();
    currentQrBase64 = null;
    qrGeneratedAt = 0;
    pairingCode = null;
  }
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  if (!waVersionReady) await loadWaVersionOnce();
  const version = cachedWaVersion;
  const socketConf = {
    auth: {
      creds: state.creds,
      keys: wrapAuthKeys(state.keys),
    },
    logger: silentLogger,
    browser: waBrowser(),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    qrTimeout: 90_000,
  };
  if (version) socketConf.version = version;

  sock = makeWASocket(socketConf);

  sock.ev.process(async (events) => {
    if (gen !== connectGen) return;

    if (events['creds.update']) {
      await saveCreds();
    }

    if (!events['connection.update']) return;
    const { connection, lastDisconnect, qr } = events['connection.update'];

    if (qr) {
      if (pendingPairPhone && !sock?.authState?.creds?.registered) {
        await requestPairingIfNeeded();
      } else {
        try {
          currentQrBase64 = await qrcode.toDataURL(qr);
          qrGeneratedAt = Date.now();
          qrError = null;
          reconnectAttempts = 0;
          console.log('[boutique-bot] QR prêt — scanne tout de suite');
        } catch (err) {
          qrError = err.message;
        }
      }
    }

    if (connection === 'open') {
      isConnected = true;
      isLinking = false;
      currentQrBase64 = null;
      pairingCode = null;
      pendingPairPhone = null;
      pairingRequested = false;
      qrError = null;
      reconnectAttempts = 0;
      cancelReconnect();
      console.log('[boutique-bot] WhatsApp connecté');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = disconnectCode(lastDisconnect);
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const restartRequired =
        statusCode === DisconnectReason.restartRequired || statusCode === 515;
      console.warn('[boutique-bot] close', statusCode || lastDisconnect?.error?.message || '');

      if (loggedOut) {
        isLinking = false;
        currentQrBase64 = null;
        pairingCode = null;
        pendingPairPhone = null;
        pairingRequested = false;
        reconnectAttempts = 0;
        clearAuthSession();
        qrError = 'Session WhatsApp expirée. Clique Afficher le QR.';
        return;
      }

      if (isQrExpiredError(lastDisconnect?.error)) {
        currentQrBase64 = null;
        pairingCode = null;
        scheduleReconnect(1500, { clearAuth: true, countAttempt: true });
        return;
      }

      if (restartRequired) {
        reconnectAttempts = 0;
        scheduleReconnect(0, { clearAuth: false, countAttempt: false });
        return;
      }

      scheduleReconnect(3000, { clearAuth: false, countAttempt: true });
    }
  });
}

function publicStatus(includeQr) {
  return {
    ok: true,
    service: 'boxplus-boutique-bot',
    build: BUILD,
    connected: isConnected,
    connecting: isLinking && !isConnected,
    hasQr: Boolean(currentQrBase64),
    qr: includeQr || !isConnected ? currentQrBase64 : null,
    pairingCode,
    qrError,
  };
}

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'boxplus-boutique-bot', build: BUILD, status: '/api/status' });
});

app.get('/api/status', (req, res) => {
  const includeQr = String(req.query.qr || '') === '1';
  res.json(publicStatus(includeQr));
});

app.post('/api/start', async (req, res) => {
  if (isConnected) {
    return res.json({ ok: true, success: true, message: 'Already connected', connected: true, build: BUILD });
  }
  const method = String(req.body?.method || 'qr').toLowerCase();
  const forceQr = req.body?.forceQr === true;
  const phone = normalizePhone(req.body?.phone);

  if (method !== 'pair') pendingPairPhone = null;

  if (!forceQr && method !== 'pair' && isLinking && hasFreshQr()) {
    return res.json({
      ...publicStatus(true),
      success: true,
      message: 'QR ready',
    });
  }

  reconnectAttempts = 0;
  qrError = null;

  if (method === 'pair') {
    if (!phone || phone.length < 10) {
      return res.status(400).json({ ok: false, error: 'Numéro WhatsApp requis (06…)' });
    }
    pendingPairPhone = phone;
    pairingCode = null;
    pairingRequested = false;
    currentQrBase64 = null;
    await connectToWhatsApp({ force: true, clearAuth: true });
    const deadline = Date.now() + 14000;
    while (Date.now() < deadline && !isConnected && !pairingCode && !qrError) {
      await sleep(200);
    }
    if (!pairingCode && !isConnected) {
      return res.status(502).json({
        ok: false,
        error: qrError || 'Code d’association pas encore prêt. Réessaie.',
        ...publicStatus(true),
      });
    }
    return res.json({
      ...publicStatus(true),
      success: true,
      message: 'Pairing code ready',
    });
  }

  const clearAuth = forceQr || !hasRegisteredSession();
  await connectToWhatsApp({ force: true, clearAuth });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !isConnected && !currentQrBase64 && !qrError) {
    await sleep(200);
  }
  res.json({
    ...publicStatus(true),
    success: true,
    message: currentQrBase64 ? 'QR ready' : isConnected ? 'Already connected' : 'Connection started',
  });
});

app.post('/api/stop', async (_req, res) => {
  cancelReconnect();
  isLinking = false;
  pendingPairPhone = null;
  pairingRequested = false;
  await destroySocket();
  isConnected = false;
  currentQrBase64 = null;
  pairingCode = null;
  res.json({ ok: true, success: true, message: 'Stopped', build: BUILD });
});

app.post('/api/logout', async (_req, res) => {
  cancelReconnect();
  isLinking = false;
  pendingPairPhone = null;
  pairingRequested = false;
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
  res.json({ ok: true, success: true, message: 'Logged out', build: BUILD });
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
loadWaVersionOnce().catch(() => {});

setTimeout(() => {
  if (hasRegisteredSession()) {
    console.log('[boutique-bot] session existante — reconnexion');
    connectToWhatsApp({ force: true, clearAuth: false }).catch((err) => {
      console.error('[boutique-bot] auto-connect:', err.message);
    });
  }
}, 1500);

app.listen(PORT, HOST, () => {
  console.log(`[boutique-bot] http://${HOST}:${PORT} build=${BUILD}`);
  console.log('[boutique-bot] QR : backoffice boutique → WhatsApp');
  if (!SITE_API_SECRET) console.warn('[boutique-bot] SITE_API_SECRET manquant');
});
