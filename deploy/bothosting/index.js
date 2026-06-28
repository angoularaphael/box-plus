#!/usr/bin/env node
/**
 * BotHosting / Pterodactyl — bootstrap BOXPLUS bot
 *
 * 1. Upload index.js + .env à la racine (/home/container/)
 * 2. Startup panel : node index.js
 * 3. Start → clone GitHub + install + bot
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const BOT_DIR = path.join(ROOT, 'boxi-deci-bot');
const REPO = process.env.BOT_REPO_URL || 'https://github.com/angoularaphael/boxi-deci-bot.git';
const BRANCH = process.env.BOT_REPO_BRANCH || 'main';

function log(msg) {
  console.log(`[BOXPLUS bootstrap] ${msg}`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    log('ATTENTION: .env manquant — crée /home/container/.env avant de lancer');
    return;
  }
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  }
}

function run(cmd, cwd = ROOT) {
  log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd, shell: true, env: process.env });
}

function resolvePath(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

function ensureDataPaths() {
  const dataRoot = resolvePath(process.env.BOT_DATA_DIR || 'data');
  const pw = resolvePath(process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(dataRoot, 'ms-playwright'));
  const tmp = resolvePath(process.env.TMPDIR || path.join(dataRoot, 'tmp'));
  fs.mkdirSync(pw, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'session'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'queue'), { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = pw;
  process.env.TMPDIR = tmp;
  process.env.BOT_DATA_DIR = dataRoot;
  process.env.BOT_SESSION_DIR = resolvePath(process.env.BOT_SESSION_DIR || path.join(dataRoot, 'session'));
  log(`Playwright → ${pw}`);
  log(`TMPDIR → ${tmp}`);
  log(`Session → ${process.env.BOT_SESSION_DIR}`);
}

function playwrightReady(basePath) {
  if (!fs.existsSync(basePath)) return false;
  return fs.readdirSync(basePath).some((n) => /chromium|headless/i.test(n));
}

function installPlaywright(botDir) {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const already = playwrightReady(base);
  if (!already) {
    run('rm -rf ~/.cache/ms-playwright 2>/dev/null || true', ROOT);
    for (const variant of ['chromium-headless-shell', 'chromium']) {
      try {
        log(`Installation Playwright: ${variant}`);
        run(`npx playwright install ${variant}`, botDir);
        if (playwrightReady(base)) break;
      } catch (err) {
        log(`Échec ${variant}: ${err.message || err}`);
      }
    }
  } else {
    log('Playwright déjà installé — skip navigateur');
  }
  if (!playwrightReady(base)) {
    throw new Error('Playwright non installé — vérifie df -h (disque plein ?)');
  }
  try {
    log('Installation Playwright: ffmpeg');
    run('npx playwright install ffmpeg', botDir);
  } catch (err) {
    log(`ffmpeg optionnel: ${err.message || err}`);
  }
}

loadEnvFile(ENV_FILE);
ensureDataPaths();
log(`.env ${fs.existsSync(ENV_FILE) ? 'OK' : 'MANQUANT'} (${ENV_FILE})`);

function ensureBotRepo() {
  if (!fs.existsSync(path.join(BOT_DIR, 'bot', 'index.js'))) {
    log(`Clone ${REPO} → ${BOT_DIR}`);
    run(`git clone --depth 1 --branch ${BRANCH} ${REPO} "${BOT_DIR}"`);
    return;
  }
  log('Mise à jour repo bot…');
  try {
    run(`git fetch origin && git reset --hard origin/${BRANCH}`, BOT_DIR);
  } catch {
    log('git pull ignoré — copie locale');
  }
}

ensureBotRepo();

if (!fs.existsSync(path.join(BOT_DIR, 'node_modules'))) {
  run('npm install --omit=dev --ignore-scripts', BOT_DIR);
}

installPlaywright(BOT_DIR);

const { installChromiumSystemDeps } = require(path.join(BOT_DIR, 'lib', 'playwright-host-deps'));
const depsDir = path.join(resolvePath(process.env.BOT_DATA_DIR || 'data'), 'system-libs');
installChromiumSystemDeps({ baseDir: depsDir, botDir: BOT_DIR, log: (m) => log(m) });

log('Démarrage bot Deciplus…');
run('node bot/index.js', BOT_DIR);
