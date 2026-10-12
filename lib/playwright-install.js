/**
 * Install Playwright browser — léger pour hébergeurs (chromium-headless-shell).
 * Vérifie l'exécutable attendu par la version de playwright installée,
 * pas seulement la présence d'un ancien dossier chromium (sinon skip + failover).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function browsersPath(cwd = process.cwd()) {
  const custom = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (custom) return custom;
  return path.join(cwd, 'data', 'ms-playwright');
}

function resolvePlaywright(botDir = process.cwd()) {
  try {
    return require(path.join(botDir, 'node_modules', 'playwright'));
  } catch {
    try {
      return require('playwright');
    } catch {
      return null;
    }
  }
}

/** True seulement si le binaire exact attendu par playwright est présent. */
function hasBrowserInstalled(basePath, botDir = process.cwd()) {
  const pw = resolvePlaywright(botDir);
  if (pw?.chromium) {
    try {
      const exe = pw.chromium.executablePath();
      if (exe && fs.existsSync(exe)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function installPlaywrightBrowser(opts = {}) {
  const botDir = opts.botDir || opts.cwd || process.cwd();
  const base = browsersPath(botDir);
  process.env.PLAYWRIGHT_BROWSERS_PATH = base;
  fs.mkdirSync(base, { recursive: true });

  if (hasBrowserInstalled(base, botDir) && !opts.force) {
    console.log(`[BOXPLUS] Playwright déjà installé (${base})`);
    return { installed: true, skipped: true, path: base };
  }

  const variants = ['chromium-headless-shell', 'chromium'];
  for (const variant of variants) {
    try {
      console.log(`[BOXPLUS] Installation Playwright: ${variant} → ${base}`);
      const cli = path.join(botDir, 'node_modules', 'playwright', 'cli.js');
      const cmd = fs.existsSync(cli)
        ? `node "${cli}" install ${variant}`
        : `npx playwright install ${variant}`;
      execSync(cmd, {
        stdio: 'inherit',
        cwd: botDir,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: base },
      });
      if (hasBrowserInstalled(base, botDir)) {
        return { installed: true, skipped: false, path: base, variant };
      }
    } catch (err) {
      console.warn(`[BOXPLUS] Échec install ${variant}:`, err.message || err);
    }
  }

  throw new Error(
    'Playwright non installé — disque plein (ENOSPC) ? Libère de l’espace ou augmente le quota hébergeur.'
  );
}

module.exports = {
  installPlaywrightBrowser,
  browsersPath,
  hasBrowserInstalled,
  resolvePlaywright,
};
