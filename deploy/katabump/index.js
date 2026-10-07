#!/usr/bin/env node
/**
 * KataBump / Pterodactyl — bootstrap BOXPLUS bot
 * Upload avec .env → Startup: node index.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const BOT_DIR = path.join(ROOT, 'boxi-deci-bot');

function log(msg) {
  console.log(`[BOXPLUS bootstrap] ${msg}`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
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

function ensureDataPaths() {
  const dataRoot = path.join(ROOT, 'data');
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(dataRoot, 'ms-playwright');
  const tmp = process.env.TMPDIR || path.join(dataRoot, 'tmp');
  fs.mkdirSync(pw, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'session'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'queue'), { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = pw;
  process.env.TMPDIR = tmp;
  process.env.BOT_DATA_DIR = process.env.BOT_DATA_DIR || dataRoot;
  process.env.BOT_SESSION_DIR = process.env.BOT_SESSION_DIR || path.join(dataRoot, 'session');
  log(`Playwright → ${pw}`);
  log(`TMPDIR → ${tmp}`);
}

function playwrightReady(basePath) {
  if (!fs.existsSync(basePath)) return false;
  return fs.readdirSync(basePath).some((n) => /chromium|headless/i.test(n));
}

function installPlaywright(botDir) {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (playwrightReady(base)) {
    log('Playwright déjà installé — skip');
    return;
  }
  run('rm -rf ~/.cache/ms-playwright 2>/dev/null || true', ROOT);
  for (const variant of ['chromium-headless-shell', 'chromium']) {
    try {
      log(`Installation Playwright: ${variant}`);
      run(`npx playwright install ${variant}`, botDir);
      if (playwrightReady(base)) return;
    } catch (err) {
      log(`Échec ${variant}: ${err.message || err}`);
    }
  }
  throw new Error('Playwright non installé — ENOSPC ? Vérifie df -h et augmente le disque KataBump.');
}

loadEnvFile(ENV_FILE);
ensureDataPaths();
log(fs.existsSync(ENV_FILE) ? `.env chargé (${ENV_FILE})` : 'Pas de .env');

function repoSettings() {
  const configured = process.env.BOT_REPO_URL || '';
  const wanted = 'https://github.com/angoularaphael/box-plus.git';
  const repo = !configured || /boxi-deci-bot\.git/i.test(configured) ? wanted : configured;
  if (configured && repo !== configured) {
    log('BOT_REPO_URL boxi-deci-bot ignore — chargement de box-plus');
  }
  return { repo, branch: process.env.BOT_REPO_BRANCH || 'main' };
}

function gitOrigin(dir) {
  try {
    return execSync('git remote get-url origin', { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function ensureBotRepo() {
  const { repo, branch } = repoSettings();
  const origin = fs.existsSync(BOT_DIR) ? gitOrigin(BOT_DIR) : '';
  const wrong = Boolean(origin) && /box-plus\.git/i.test(repo) && !/box-plus\.git/i.test(origin);
  if (!fs.existsSync(path.join(BOT_DIR, 'start.js')) || wrong) {
    if (fs.existsSync(BOT_DIR)) {
      log(`Ancien depot retire (${origin || 'incomplet'})`);
      fs.rmSync(BOT_DIR, { recursive: true, force: true });
    }
    log(`Clone ${repo}`);
    run(`git clone --depth 1 --branch ${branch} ${repo} "${BOT_DIR}"`);
    return;
  }
  log('Mise à jour repo bot…');
  try {
    run(`git fetch origin && git reset --hard origin/${branch}`, BOT_DIR);
  } catch {
    log('git pull ignoré');
  }
}

ensureBotRepo();

run('npm install --omit=dev --no-fund --no-audit', BOT_DIR);

installPlaywright(BOT_DIR);

log('Démarrage bot Deciplus…');
run('node start.js', BOT_DIR);
