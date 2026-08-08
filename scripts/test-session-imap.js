#!/usr/bin/env node
/**
 * Test local avant BotHosting :
 * 1) IMAP (boîte code Deciplus)
 * 2) Session existante (token + ping API)
 * 3) Reconnexion auto si expirée (+ lecture code email si demandé)
 *
 * Usage: node scripts/test-session-imap.js
 */
'use strict';

require('dotenv').config();

// Test local : Chromium visible optionnel ; headless plus stable en CI
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.BOT_AUTH_COOLDOWN_MS = process.env.BOT_AUTH_COOLDOWN_MS || '1000';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const path = require('path');
const fs = require('fs');
const {
  launchBrowser,
  saveSession,
  login,
  isLoggedIn,
  getAccessToken,
  gotoDeciplus,
  STORAGE_FILE,
  isVerificationScreen,
} = require('../bot/auth');
const { isImapOtpConfigured, fetchDeciplusEmailCode } = require('../bot/deciplus-otp-imap');
const { closeBrowser } = require('../bot/browser-pool');

const API_BASE = 'https://api.deciplus.pro/staff/v1';

function ok(label) {
  console.log(`  ✅ ${label}`);
}
function ko(label, detail) {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
}
function info(label) {
  console.log(`  … ${label}`);
}

async function pingApi(page, token) {
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  const referer = new URL('nextgen/home', base).href;
  const response = await page.context().request.get(`${API_BASE}/product/getAvailableProducts?all=true`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'x-access-token': token,
      'Deciplus-Client-Type': 'manager',
    },
    Referer: referer,
  });
  return { ok: response.ok(), status: response.status() };
}

async function main() {
  console.log('\n=== Test session Deciplus + IMAP OTP ===\n');
  console.log(`USER      : ${process.env.DECIPLUS_USER}`);
  console.log(`IMAP     : ${process.env.DECIPLUS_IMAP_USER || '(non configuré)'}`);
  console.log(`Session  : ${STORAGE_FILE}`);
  console.log(`Exists   : ${fs.existsSync(STORAGE_FILE)}`);
  console.log('');

  // ── 1) IMAP ──────────────────────────────────────────────
  console.log('1) Test IMAP');
  if (!isImapOtpConfigured()) {
    ko('IMAP non configuré (DECIPLUS_IMAP_USER / PASS)');
    process.exit(1);
  }
  ok(`IMAP configuré (${process.env.DECIPLUS_IMAP_USER})`);

  info('Connexion IMAP seule (sans consommer un code)…');
  try {
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({
      host: process.env.DECIPLUS_IMAP_HOST || 'imap.gmail.com',
      port: Number(process.env.DECIPLUS_IMAP_PORT || 993),
      secure: true,
      auth: {
        user: process.env.DECIPLUS_IMAP_USER,
        pass: process.env.DECIPLUS_IMAP_PASS,
      },
      logger: false,
      tls: { rejectUnauthorized: false },
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
    await client.logout().catch(() => {});
    ok('Connexion IMAP Gmail OK');
  } catch (err) {
    ko('Connexion IMAP', err.message);
    process.exit(1);
  }

  // ── 2) Session actuelle ──────────────────────────────────
  console.log('\n2) Session persistée');
  const { browser, context, page, loadedStorageMtimeMs } = await launchBrowser();
  let sessionAlive = false;
  try {
    await gotoDeciplus(page, 'nextgen/home');
    await page.waitForTimeout(1500);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const onVerify = await isVerificationScreen(page).catch(() => false);
    const token = await getAccessToken(page);
    const logged = await isLoggedIn(page).catch(() => false);
    console.log(`  URL     : ${page.url()}`);
    console.log(`  logged  : ${logged}`);
    console.log(`  verify  : ${onVerify}`);
    console.log(`  token   : ${token ? `${String(token).slice(0, 12)}…` : '(absent)'}`);

    if (token) {
      const ping = await pingApi(page, token);
      if (ping.ok) {
        ok(`Token accepté par l’API Deciplus (HTTP ${ping.status}) — session encore valide`);
        sessionAlive = true;
      } else {
        ko(`Token rejeté par l’API (HTTP ${ping.status}) — session expirée / invalide`);
      }
    } else {
      ko('Pas de token dans localStorage — session expirée ou absente');
    }

    // ── 3) Reconnexion si besoin ───────────────────────────
    console.log('\n3) Reconnexion auto (si besoin)');
    if (sessionAlive) {
      ok('Rien à faire — session bonne');
    } else {
      info('login()… (IMAP lit le code si Deciplus le demande)');
      await login(page, { siteLabel: process.env.DECIPLUS_DEFAULT_SITE || 'Minimes' });
      await gotoDeciplus(page, 'nextgen/home');
      const token2 = await getAccessToken(page);
      if (!token2) {
        ko('Toujours pas de token après login');
        process.exitCode = 1;
      } else {
        const ping2 = await pingApi(page, token2);
        if (ping2.ok) {
          ok(`Reconnecté — API OK (HTTP ${ping2.status})`);
          await saveSession(context, { loadedMtimeMs: loadedStorageMtimeMs });
          ok(`Session sauvegardée → ${path.relative(process.cwd(), STORAGE_FILE)}`);
          sessionAlive = true;
        } else {
          ko(`Token obtenu mais API refuse (HTTP ${ping2.status})`);
          process.exitCode = 1;
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await closeBrowser().catch(() => {});
  }

  console.log('\n=== Résultat ===');
  if (sessionAlive && process.exitCode !== 1) {
    console.log('OK — prêt pour BotHosting (upload .env + redémarrage + éventuellement storage-state.json)\n');
  } else {
    console.log('ÉCHEC — corriger IMAP / identifiants avant BotHosting\n');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
