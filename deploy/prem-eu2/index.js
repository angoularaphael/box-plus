# =============================================================================
# Bot ventes Eddy — prem-eu2.bot-hosting.net:21871
# =============================================================================
# Inscriptions (vendeur Deciplus EDDY). Même procédure que Raphaël sur eu1:20311.
# Ops / résils restent sur :21268 (BOXPLUS_BOT_URL_OPS).
#
# Upload sur le serveur :
#   /home/container/index.js  (ce fichier)
#   /home/container/.env      (voir .env.example)
#
# Startup panel : node index.js
#
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const BOT_DIR = path.join(ROOT, 'boxi-deci-bot');
const REPO = process.env.BOT_REPO_URL || 'https://github.com/angoularaphael/boxi-deci-bot.git';
const BRANCH = process.env.BOT_REPO_BRANCH || 'main';

function log(msg) {
  console.log(`[BOXPLUS ventes Eddy eu2] ${msg}`);
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

function run(cmd, cwd = ROOT) {
  log(`> ${cmd}`);
  require('child_process').execSync(cmd, { stdio: 'inherit', cwd, shell: true, env: process.env });
}

function ensureDataPaths() {
  const dataRoot = path.join(ROOT, 'data');
  const pw = path.join(dataRoot, 'ms-playwright');
  const tmp = path.join(dataRoot, 'tmp');
  fs.mkdirSync(pw, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'session'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'queue'), { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = pw;
  process.env.TMPDIR = tmp;
  process.env.BOT_DATA_DIR = dataRoot;
  process.env.BOT_SESSION_DIR = path.join(dataRoot, 'session');
  process.env.BOXPLUS_QUEUE_DIR = path.join(dataRoot, 'queue');
}

loadEnvFile(ENV_FILE);

process.env.BOT_ROLE = process.env.BOT_ROLE || 'sales';
process.env.BOT_ID = process.env.BOT_ID || 'eddy';
process.env.BOT_HTTP_PORT = process.env.BOT_HTTP_PORT || process.env.PORT || '21871';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.BOT_CATALOG_PUSH_ENABLED = process.env.BOT_CATALOG_PUSH_ENABLED || 'false';
process.env.ALERT_EMAIL = process.env.ALERT_EMAIL || 'boxingcentertls@gmail.com';

ensureDataPaths();
log(`BOT_ROLE=${process.env.BOT_ROLE} BOT_ID=${process.env.BOT_ID} PORT=${process.env.BOT_HTTP_PORT}`);

function ensureBotRepo() {
  if (!fs.existsSync(path.join(BOT_DIR, 'bot', 'index.js'))) {
    log(`Clone ${REPO} → ${BOT_DIR}`);
    run(`git clone --depth 1 --branch ${BRANCH} ${REPO} "${BOT_DIR}"`);
    return;
  }
  log('Mise à jour repo…');
  try {
    run(`git fetch origin && git reset --hard origin/${BRANCH}`, BOT_DIR);
  } catch {
    log('git pull ignoré');
  }
}

ensureBotRepo();
run('npm install --omit=dev --no-fund --no-audit', BOT_DIR);

const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
const hasPw = fs.existsSync(base) && fs.readdirSync(base).some((n) => /chromium/i.test(n));
if (!hasPw) {
  run('npx playwright install chromium-headless-shell', BOT_DIR);
}

log('Démarrage bot ventes Eddy Deciplus…');
run('node start.js', BOT_DIR);
