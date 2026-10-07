#!/usr/bin/env node
/**
 * Bot ventes Raphael — 172.81.128.14:22189
 *
 * Upload sur le serveur :
 *   /home/container/index.js  (ce fichier)
 *   /home/container/.env
 *
 * Startup panel : node index.js
 * Clone box-plus, installe Playwright, vendeur Deciplus RAPHAEL.
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

function playwrightCli(botDir) {
  return path.join(botDir, 'node_modules', 'playwright', 'cli.js');
}

function runPlaywrightInstall(botDir, variant) {
  const cli = playwrightCli(botDir);
  if (!fs.existsSync(cli)) {
    throw new Error('playwright/cli.js absent — npm install a échoué ?');
  }
  run(`node "${cli}" install ${variant}`, botDir);
}

function installPlaywright(botDir) {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const already = playwrightReady(base);
  if (!already) {
    run('rm -rf ~/.cache/ms-playwright 2>/dev/null || true', ROOT);
    for (const variant of ['chromium-headless-shell', 'chromium']) {
      try {
        log(`Installation Playwright: ${variant}`);
        runPlaywrightInstall(botDir, variant);
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
}

loadEnvFile(ENV_FILE);
process.env.BOT_ROLE = process.env.BOT_ROLE || 'sales';
process.env.BOT_ID = process.env.BOT_ID || 'raphael';
process.env.BOT_HTTP_PORT = process.env.BOT_HTTP_PORT || process.env.PORT || '22189';
process.env.PORT = process.env.BOT_HTTP_PORT;
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.ALERT_EMAIL = process.env.ALERT_EMAIL || 'boxingcentertls@gmail.com';
ensureDataPaths();
log(`.env ${fs.existsSync(ENV_FILE) ? 'OK' : 'MANQUANT'} (${ENV_FILE})`);
log(`BOT_ROLE=${process.env.BOT_ROLE} BOT_ID=${process.env.BOT_ID} PORT=${process.env.BOT_HTTP_PORT}`);

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
  if (!fs.existsSync(path.join(BOT_DIR, 'bot', 'index.js')) || wrong) {
    if (fs.existsSync(BOT_DIR)) {
      log(`Ancien depot retire (${origin || 'incomplet'})`);
      fs.rmSync(BOT_DIR, { recursive: true, force: true });
    }
    log(`Clone ${repo} → ${BOT_DIR}`);
    run(`git clone --depth 1 --branch ${branch} ${repo} "${BOT_DIR}"`);
    return;
  }
  log('Mise à jour repo bot…');
  try {
    run(`git fetch origin && git reset --hard origin/${branch}`, BOT_DIR);
  } catch {
    log('git pull ignoré — copie locale');
  }
}

ensureBotRepo();

run('npm install --omit=dev --no-fund --no-audit --ignore-scripts', BOT_DIR);
run('npm install playwright imapflow mailparser --no-save --ignore-scripts --no-fund --no-audit', BOT_DIR);

installPlaywright(BOT_DIR);

const { installChromiumSystemDeps } = require(path.join(BOT_DIR, 'lib', 'playwright-host-deps'));
const depsDir = path.join(resolvePath(process.env.BOT_DATA_DIR || 'data'), 'system-libs');
installChromiumSystemDeps({ baseDir: depsDir, botDir: BOT_DIR, log: (m) => log(m) });

log('Démarrage bot Deciplus…');
run('node start.js', BOT_DIR);
