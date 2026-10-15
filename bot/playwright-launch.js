/**
 * Lancement Playwright adapté aux hébergeurs Linux (BotHosting, KataBump).
 */
const { chromium } = require('playwright');
const { logWarn } = require('../lib/logger');
const { sleep } = require('../lib/utils');
const { installChromiumSystemDeps } = require('../lib/playwright-host-deps');
const path = require('path');

function isHostedBot() {
  if (process.platform !== 'linux') return false;
  return Boolean(
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
      process.env.BOXPLUS_HOSTED === '1' ||
      process.cwd().startsWith('/home/container')
  );
}

function getChromiumLaunchOptions() {
  const hosted = isHostedBot();
  const headless =
    String(process.env.DECIPLUS_HEADLESS ?? (hosted ? 'true' : 'false')).toLowerCase() !== 'false';
  const slowMo = headless ? 0 : Number(process.env.DECIPLUS_SLOW_MO || 100);

  const args = hosted
    ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--disable-extensions',
        '--disable-background-networking',
        '--mute-audio',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI,BackForwardCache',
        '--renderer-process-limit=2',
      ]
    : [];

  if (String(process.env.PLAYWRIGHT_SINGLE_PROCESS || 'false').toLowerCase() === 'true') {
    args.push('--single-process', '--no-zygote');
  }

  const opts = {
    headless,
    slowMo: slowMo > 0 ? slowMo : undefined,
    args,
    timeout: Number(process.env.PLAYWRIGHT_LAUNCH_TIMEOUT || 120000),
  };
  const channel = String(process.env.DECIPLUS_BROWSER_CHANNEL || '').trim();
  if (channel && !headless) {
    opts.channel = channel;
  }
  return opts;
}

function isMissingBrowserExecutable(err) {
  const msg = String(err?.message || err || '');
  return /Executable doesn't exist|browserType\.launch/i.test(msg) && /ms-playwright|chromium/i.test(msg);
}

function ensurePlaywrightBrowserInstalled({ force = false } = {}) {
  const {
    installPlaywrightBrowser,
    hasBrowserInstalled,
    expectedExecutable,
    browsersPath,
  } = require('../lib/playwright-install');
  const botDir = process.cwd();
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || browsersPath(botDir);
  process.env.PLAYWRIGHT_BROWSERS_PATH = base;
  if (!force && hasBrowserInstalled(base, botDir)) return false;
  logWarn('Playwright exécutable absent ou forcé — purge + installation', {
    expected: expectedExecutable(botDir),
    browsers: base,
    force,
  });
  installPlaywrightBrowser({ botDir, force: true });
  return true;
}

async function launchChromiumWithRetry(maxAttempts = 3) {
  if (isHostedBot()) {
    const dataRoot = process.env.BOT_DATA_DIR || path.join(process.cwd(), 'data');
    installChromiumSystemDeps({
      baseDir: path.join(dataRoot, 'system-libs'),
      botDir: process.cwd(),
    });
    try {
      ensurePlaywrightBrowserInstalled();
    } catch (installErr) {
      logWarn('Pré-install Playwright échouée', { error: installErr.message || installErr });
    }
  }

  const opts = getChromiumLaunchOptions();
  let lastError = null;
  let reinstallTried = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const browser = await chromium.launch(opts);
      if (!browser.isConnected()) {
        throw new Error('Navigateur déconnecté immédiatement après launch');
      }
      return browser;
    } catch (err) {
      lastError = err;
      logWarn(`Playwright launch ${attempt}/${maxAttempts} échoué`, {
        error: err.message,
        headless: opts.headless,
      });
      if (!reinstallTried && isMissingBrowserExecutable(err)) {
        reinstallTried = true;
        try {
          logWarn('Playwright exécutable manquant — purge + réinstall navigateur');
          ensurePlaywrightBrowserInstalled({ force: true });
        } catch (installErr) {
          logWarn('Réinstall Playwright échouée', { error: installErr.message || installErr });
        }
      }
      if (attempt < maxAttempts) {
        await sleep(4000 * attempt);
      }
    }
  }

  throw lastError || new Error('Impossible de lancer Chromium');
}

module.exports = {
  getChromiumLaunchOptions,
  launchChromiumWithRetry,
  isHostedBot,
};
