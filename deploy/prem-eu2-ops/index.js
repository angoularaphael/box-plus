#!/usr/bin/env node
/**
 * Bot operations Eddy — prem-eu2.bot-hosting.net:21268
 *
 * Resils, verifs, echeancier, nudges, anniversaires (BOT_ROLE=ops).
 * Les inscriptions restent sur :21871 (Eddy ventes) et eu1 (Raphael).
 *
 * Upload sur le serveur :
 *   /home/container/index.js  (ce fichier)
 *   /home/container/.env      (voir .env.example)
 *
 * Startup panel : node index.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const BOT_DIR = path.join(ROOT, 'boxi-deci-bot');

function log(msg) {
  console.log(`[BOXPLUS ops Eddy eu2] ${msg}`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    log(`ATTENTION: .env manquant (${filePath})`);
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

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
};

function run(cmd, cwd = ROOT, { timeoutMs = 0 } = {}) {
  log(`> ${cmd}`);
  const opts = { stdio: 'inherit', cwd, shell: true, env: GIT_ENV };
  if (timeoutMs > 0) opts.timeout = timeoutMs;
  execSync(cmd, opts);
}

function normalizeRepoUrl(raw) {
  let u = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!u) return 'https://github.com/angoularaphael/box-plus.git';
  u = u.replace(/\.gita$/i, '.git');
  u = u.replace(/\.git\s+a$/i, '.git');
  if (!/\.git$/i.test(u) && /github\.com/i.test(u)) u = `${u.replace(/\/$/, '')}.git`;
  return u;
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
  process.env.BOXPLUS_QUEUE_DIR = path.join(dataRoot, 'queue');
  log(`Playwright -> ${pw}`);
  log(`TMPDIR -> ${tmp}`);
  log(`Session -> ${process.env.BOT_SESSION_DIR}`);
}

function installPlaywright(botDir) {
  run('rm -rf ~/.cache/ms-playwright 2>/dev/null || true', ROOT);
  const { installPlaywrightBrowser, hasBrowserInstalled, expectedExecutable } = require(path.join(
    botDir,
    'lib',
    'playwright-install'
  ));
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (hasBrowserInstalled(base, botDir)) {
    log(`Playwright deja installe (executable OK) — ${expectedExecutable(botDir)}`);
    return;
  }
  log(`Playwright manquant ou dossier incomplet — purge + reinstall (${expectedExecutable(botDir) || base})`);
  installPlaywrightBrowser({ botDir, force: true });
}

loadEnvFile(ENV_FILE);

process.env.BOT_ROLE = process.env.BOT_ROLE || 'ops';
process.env.BOT_ID = process.env.BOT_ID || 'eddy-ops';
process.env.BOT_HTTP_PORT = process.env.BOT_HTTP_PORT || process.env.PORT || '21268';
process.env.PORT = process.env.BOT_HTTP_PORT;
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.BOT_CATALOG_PUSH_ENABLED = process.env.BOT_CATALOG_PUSH_ENABLED || 'false';
process.env.ALERT_EMAIL = process.env.ALERT_EMAIL || 'boxingcentertls@gmail.com';

ensureDataPaths();
log(`.env ${fs.existsSync(ENV_FILE) ? 'OK' : 'MANQUANT'} (${ENV_FILE})`);
log(`BOT_ROLE=${process.env.BOT_ROLE} BOT_ID=${process.env.BOT_ID} PORT=${process.env.BOT_HTTP_PORT}`);

function repoSettings() {
  const configured = normalizeRepoUrl(process.env.BOT_REPO_URL || '');
  const wanted = 'https://github.com/angoularaphael/box-plus.git';
  const repo =
    !configured || /boxi-deci-bot\.git/i.test(configured) ? wanted : normalizeRepoUrl(configured);
  if (process.env.BOT_REPO_URL && repo !== normalizeRepoUrl(process.env.BOT_REPO_URL)) {
    log(`BOT_REPO_URL corrige -> ${repo}`);
  }
  if (/boxi-deci-bot\.git/i.test(process.env.BOT_REPO_URL || '')) {
    log('BOT_REPO_URL boxi-deci-bot ignore — chargement de box-plus');
  }
  return { repo, branch: String(process.env.BOT_REPO_BRANCH || 'main').trim() || 'main' };
}

function gitOrigin(dir) {
  try {
    return execSync('git remote get-url origin', { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function cloneBotRepo(repo, branch) {
  const timeoutMs = Number(process.env.BOT_GIT_CLONE_TIMEOUT_MS || 600000);
  const attempts = Number(process.env.BOT_GIT_CLONE_ATTEMPTS || 3);
  const cloneCmd =
    `git -c http.lowSpeedLimit=500 -c http.lowSpeedTime=30 clone --depth 1 --single-branch --branch ${branch} "${repo}" "${BOT_DIR}"`;
  let lastErr = null;
  for (let n = 1; n <= attempts; n += 1) {
    if (fs.existsSync(BOT_DIR)) {
      fs.rmSync(BOT_DIR, { recursive: true, force: true });
    }
    log(`Clone tentative ${n}/${attempts} (${Math.round(timeoutMs / 1000)}s max)`);
    try {
      run(cloneCmd, ROOT, { timeoutMs });
      if (fs.existsSync(path.join(BOT_DIR, 'bot', 'index.js'))) return;
      lastErr = new Error('Clone termine mais bot/index.js absent');
    } catch (err) {
      lastErr = err;
      log(`Clone echoue: ${String(err.message || err).slice(0, 220)}`);
    }
  }
  throw lastErr || new Error('git clone impossible');
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
    log(`Clone ${repo} -> ${BOT_DIR}`);
    cloneBotRepo(repo, branch);
    return;
  }
  log('Mise a jour repo…');
  try {
    run(`git fetch origin && git reset --hard origin/${branch}`, BOT_DIR, { timeoutMs: 300000 });
  } catch (err) {
    log(`git pull ignore (${String(err.message || err).slice(0, 120)})`);
  }
}

ensureBotRepo();
run('npm install --omit=dev --no-fund --no-audit --ignore-scripts', BOT_DIR);
run('npm install playwright imapflow mailparser --no-save --ignore-scripts --no-fund --no-audit', BOT_DIR);
installPlaywright(BOT_DIR);

const depsFile = path.join(BOT_DIR, 'lib', 'playwright-host-deps.js');
if (fs.existsSync(depsFile)) {
  const { installChromiumSystemDeps } = require(depsFile);
  const depsDir = path.join(resolvePath(process.env.BOT_DATA_DIR || 'data'), 'system-libs');
  installChromiumSystemDeps({ baseDir: depsDir, botDir: BOT_DIR, log: (m) => log(m) });
}

log('Demarrage bot operations Eddy Deciplus…');
run('node start.js', BOT_DIR);
