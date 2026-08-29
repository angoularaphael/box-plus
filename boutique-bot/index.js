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
const BUILD = 'wa-send-5';
const BATCH_SIZE = Math.max(1, parseInt(process.env.WA_BATCH_SIZE || '10', 10) || 10);
const SEND_GAP_MS = Math.max(0, parseInt(process.env.WA_SEND_GAP_MS || '8000', 10) || 8000);
const BATCH_REST_MS = Math.max(
  60_000,
  parseInt(process.env.WA_BATCH_REST_MS || String(20 * 60 * 1000), 10) || 20 * 60 * 1000
);
const DEFAULT_RESTRICTED_UNTIL = '2026-08-30T08:00:00+02:00';

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
let lastMessageUpdates = [];
let outboundSentInBatch = 0;
let outboundLastSendAt = 0;
let outboundRestUntil = 0;
const outboundDropped = [];

const ACK_NAMES = {
  0: 'ERROR',
  1: 'PENDING',
  2: 'SERVER',
  3: 'DELIVERY',
  4: 'READ',
  5: 'PLAYED',
};

function rememberMessageUpdate(update) {
  lastMessageUpdates.unshift({
    at: new Date().toISOString(),
    id: update?.key?.id || null,
    remoteJid: update?.key?.remoteJid || null,
    status: update?.update?.status,
    statusName: ACK_NAMES[update?.update?.status] || null,
    stub: update?.update?.messageStubParameters || null,
  });
  lastMessageUpdates = lastMessageUpdates.slice(0, 20);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truthyFlag(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function falsyFlag(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

function isAllOutboundPaused() {
  return truthyFlag(process.env.WA_OUTBOUND_PAUSED || process.env.WHATSAPP_OUTBOUND_PAUSED);
}

function isPromoOutboundPaused(now = Date.now()) {
  if (isAllOutboundPaused()) return true;
  const flag = process.env.WHATSAPP_PROMO_PAUSED || process.env.WA_PROMO_PAUSED;
  if (falsyFlag(flag)) return false;
  if (truthyFlag(flag)) return true;
  const until = Date.parse(process.env.WHATSAPP_RESTRICTED_UNTIL || DEFAULT_RESTRICTED_UNTIL);
  return Number.isFinite(until) && now < until;
}

function outboundSnapshot() {
  const now = Date.now();
  return {
    promoPaused: isPromoOutboundPaused(now),
    allPaused: isAllOutboundPaused(),
    batchSize: BATCH_SIZE,
    sentInBatch: outboundSentInBatch,
    lastSendAt: outboundLastSendAt ? new Date(outboundLastSendAt).toISOString() : null,
    restUntil: outboundRestUntil > now ? new Date(outboundRestUntil).toISOString() : null,
    gapMs: SEND_GAP_MS,
    restMs: BATCH_REST_MS,
    dropped: outboundDropped.length,
  };
}

function clearOutboundLimiter() {
  outboundSentInBatch = 0;
  outboundLastSendAt = 0;
  outboundRestUntil = 0;
  outboundDropped.length = 0;
}

function admitOutbound(kind) {
  const now = Date.now();
  if (isAllOutboundPaused()) {
    return { ok: false, status: 423, error: 'WhatsApp boutique en pause' };
  }
  if (kind === 'promo' && isPromoOutboundPaused(now)) {
    return { ok: false, status: 423, error: 'WhatsApp promo en pause (compte restreint)' };
  }
  if (outboundRestUntil > now) {
    return {
      ok: false,
      status: 429,
      error: 'File WhatsApp : pause après 10 envois',
      retry_ms: outboundRestUntil - now,
      outbound: outboundSnapshot(),
    };
  }
  if (outboundLastSendAt && now - outboundLastSendAt < SEND_GAP_MS) {
    return {
      ok: false,
      status: 429,
      error: 'File WhatsApp : attendre entre deux messages',
      retry_ms: SEND_GAP_MS - (now - outboundLastSendAt),
      outbound: outboundSnapshot(),
    };
  }
  return { ok: true };
}

function recordOutboundSend() {
  outboundLastSendAt = Date.now();
  outboundSentInBatch += 1;
  if (outboundSentInBatch >= BATCH_SIZE) {
    outboundRestUntil = Date.now() + BATCH_REST_MS;
    outboundSentInBatch = 0;
  }
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
  sock.ev.on('messages.update', (updates) => {
    if (!Array.isArray(updates)) return;
    for (const update of updates) rememberMessageUpdate(update);
  });

  sock.ev.process(async (events) => {
    if (gen !== connectGen) return;

    if (events['creds.update']) {
      await saveCreds();
    }

    if (events['messages.update']) {
      for (const update of events['messages.update']) rememberMessageUpdate(update);
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
  const me = sock?.user || sock?.authState?.creds?.me || null;
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
    me: me
      ? {
          id: String(me.id || me.lid || '').split(':')[0],
          name: me.name || me.verifiedName || null,
        }
      : null,
    outbound: outboundSnapshot(),
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

function lidFromMapping(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.lid || value.id || null;
}

async function resolveWhatsAppJid(phone) {
  const digits = normalizePhone(phone);
  if (!digits || !sock) return { digits, jid: '', pnJid: '', lid: null, exists: false };
  const fallback = `${digits}@s.whatsapp.net`;
  let pnJid = fallback;
  let exists = null;

  if (typeof sock.onWhatsApp === 'function') {
    try {
      const found = await sock.onWhatsApp(fallback);
      const hit = Array.isArray(found) ? found.find((x) => x && x.exists) || found[0] : found;
      if (hit && hit.exists === false) {
        return { digits, jid: fallback, pnJid: fallback, lid: null, exists: false };
      }
      if (hit) {
        exists = hit.exists !== false;
        if (hit.jid) pnJid = String(hit.jid);
      }
    } catch {
      /* keep fallback */
    }
  }

  let lid = null;
  try {
    const map = sock.signalRepository?.lidMapping;
    if (map?.getLIDForPN) lid = lidFromMapping(await map.getLIDForPN(pnJid));
    else if (map?.getStoredLIDForPN) lid = lidFromMapping(await map.getStoredLIDForPN(pnJid));
  } catch {
    lid = null;
  }

  return {
    digits,
    jid: lid || pnJid,
    pnJid,
    lid,
    exists,
  };
}

function waitForMessageAck(msgId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let best = { ack: null, ackName: null, stub: null, waitMs: 0, timeout: true };

    const considerStored = () => {
      for (const previous of lastMessageUpdates) {
        if (previous.id !== msgId || previous.status == null) continue;
        best = {
          ack: previous.status,
          ackName: ACK_NAMES[previous.status] || String(previous.status),
          stub: previous.stub || null,
          waitMs: Date.now() - started,
          timeout: false,
        };
        if (previous.status === 0 || previous.status >= 3) return true;
      }
      return false;
    };

    const tick = setInterval(() => {
      if (considerStored()) {
        clearInterval(tick);
        clearTimeout(timer);
        resolve(best);
      }
    }, 150);

    const timer = setTimeout(() => {
      clearInterval(tick);
      considerStored();
      resolve({ ...best, waitMs: Date.now() - started, timeout: best.ack == null });
    }, timeoutMs);
  });
}

app.get('/api/last-acks', (req, res) => {
  if (!verifyApiSecret(req, res)) return;
  res.json({ ok: true, build: BUILD, items: lastMessageUpdates });
});

app.post('/api/queue/clear', (req, res) => {
  if (!verifyApiSecret(req, res)) return;
  clearOutboundLimiter();
  console.log('[boutique-bot] file WhatsApp vidée');
  res.json({ ok: true, success: true, message: 'File vidée', outbound: outboundSnapshot(), build: BUILD });
});

app.post('/api/send-message', async (req, res) => {
  if (!verifyApiSecret(req, res)) return;
  if (!isConnected || !sock) return res.status(503).json({ error: 'Bot not connected' });
  const { phone, message, kind: rawKind } = req.body || {};
  const kind = String(rawKind || 'transactional').toLowerCase() === 'promo' ? 'promo' : 'transactional';
  if (!message) return res.status(400).json({ error: 'message required' });
  const gate = admitOutbound(kind);
  if (!gate.ok) {
    outboundDropped.push({ at: new Date().toISOString(), kind, error: gate.error });
    if (outboundDropped.length > 50) outboundDropped.splice(0, outboundDropped.length - 50);
    return res.status(gate.status).json({ ok: false, ...gate, kind });
  }
  const resolved = await resolveWhatsAppJid(phone);
  if (!resolved.jid) return res.status(400).json({ error: 'phone required' });
  if (resolved.exists === false) {
    return res.status(400).json({
      ok: false,
      error: 'Ce numéro n’a pas WhatsApp',
      phone: resolved.digits,
      exists: false,
    });
  }
  try {
    if (typeof sock.presenceSubscribe === 'function') {
      await sock.presenceSubscribe(resolved.jid).catch(() => {});
    }
    const sent = await Promise.race([
      sock.sendMessage(resolved.jid, { text: String(message) }),
      sleep(20000).then(() => {
        throw new Error('WhatsApp send timeout 20s');
      }),
    ]);
    const msgId = sent?.key?.id || null;
    recordOutboundSend();
    const ack = msgId ? await waitForMessageAck(msgId, 10000) : { ack: null, timeout: true, waitMs: 0 };
    const failed = ack.ack === 0;
    const delivered = Number(ack.ack) >= 3;
    res.status(failed ? 502 : 200).json({
      ok: !failed,
      success: !failed,
      phone: resolved.digits,
      jid: resolved.jid,
      pnJid: resolved.pnJid,
      lid: resolved.lid,
      exists: resolved.exists,
      id: msgId,
      ack: ack.ack,
      ackName: ack.ackName || null,
      stub: ack.stub || null,
      delivered,
      ackTimeout: Boolean(ack.timeout),
      ackWaitMs: ack.waitMs || 0,
      outbound: outboundSnapshot(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, phone: resolved.digits, jid: resolved.jid });
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

function startStoreNudgePoll() {
  const store = String(process.env.STORE_URL || process.env.BOXPLUS_STORE_URL || 'https://boutique.boxingcenter.fr')
    .trim()
    .replace(/\/$/, '');
  const secret = SITE_API_SECRET;
  if (!store || !secret) {
    console.warn('[boutique-bot] poll relances inscription : STORE_URL / secret manquant');
    return;
  }
  const interval = Math.max(30000, parseInt(process.env.STORE_NUDGE_POLL_MS || '60000', 10) || 60000);
  const tick = async () => {
    if (!isConnected) return;
    try {
      const res = await fetch(`${store}/api/cron/inscription-nudges`, {
        method: 'GET',
        headers: { 'x-api-secret': secret },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        console.warn('[boutique-bot] relances inscription HTTP', res.status);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.count) {
        console.log('[boutique-bot] relances inscription', { count: data.count });
      }
    } catch (err) {
      console.warn('[boutique-bot] relances inscription:', err.message);
    }
  };
  setTimeout(tick, 8000);
  setInterval(tick, interval);
  console.log('[boutique-bot] relances 30 min / 29 € →', `${store}/api/cron/inscription-nudges`, 'every', interval, 'ms');
}

function startConcoursWaRetry() {
  const url = String(process.env.CONCOURS_CRON_URL || '').trim();
  const secret = String(process.env.CONCOURS_CRON_SECRET || '').trim();
  if (!url) return;
  const interval = Math.max(30000, parseInt(process.env.CONCOURS_CRON_MS || '60000', 10) || 60000);
  const tick = async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      if (!res.ok) {
        console.warn('[boutique-bot] concours retry HTTP', res.status);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.processed || data.sent || data.errors) {
        console.log('[boutique-bot] concours WA retry', data);
      }
    } catch (err) {
      console.warn('[boutique-bot] concours retry:', err.message);
    }
  };
  setTimeout(tick, 12000);
  setInterval(tick, interval);
  console.log('[boutique-bot] concours WA retry →', url, 'every', interval, 'ms');
}

app.listen(PORT, HOST, () => {
  console.log(`[boutique-bot] http://${HOST}:${PORT} build=${BUILD}`);
  console.log('[boutique-bot] QR : backoffice boutique → WhatsApp');
  if (!SITE_API_SECRET) console.warn('[boutique-bot] SITE_API_SECRET manquant');
  startConcoursWaRetry();
  startStoreNudgePoll();
});
