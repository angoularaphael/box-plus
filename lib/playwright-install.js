/**
 * Install Playwright browser — léger pour hébergeurs (chromium-headless-shell).
 * Vérifie l'exécutable attendu par la version de playwright installée,
 * pas seulement la présence d'un ancien dossier chromium (sinon skip + failover).
 *
 * Cas fréquent BotHosting : un dossier chromium_headless_shell-XXXX existe mais
 * le binaire manque → `playwright install` skip → launch échoue en boucle.
 * On purge alors les dossiers incomplets avant de réinstaller.
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

function expectedExecutable(botDir = process.cwd()) {
  const pw = resolvePlaywright(botDir);
  if (!pw?.chromium) return null;
  try {
    return pw.chromium.executablePath() || null;
  } catch {
    return null;
  }
}

/** True seulement si le binaire exact attendu par playwright est présent. */
function hasBrowserInstalled(basePath, botDir = process.cwd()) {
  const exe = expectedExecutable(botDir);
  return Boolean(exe && fs.existsSync(exe));
}

function listBrowserDirs(basePath) {
  if (!fs.existsSync(basePath)) return [];
  try {
    return fs
      .readdirSync(basePath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /chromium|headless|firefox|webkit/i.test(e.name))
      .map((e) => path.join(basePath, e.name));
  } catch {
    return [];
  }
}

/** Supprime les dossiers navigateur incomplets / obsolètes sous PLAYWRIGHT_BROWSERS_PATH. */
function purgeIncompleteBrowsers(basePath, botDir = process.cwd()) {
  const exe = expectedExecutable(botDir);
  if (exe && fs.existsSync(exe)) return { purged: false, exe };
  const dirs = listBrowserDirs(basePath);
  for (const dir of dirs) {
    try {
      console.warn(`[BOXPLUS] Purge navigateur Playwright incomplet: ${dir}`);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[BOXPLUS] Purge impossible ${dir}:`, err.message || err);
    }
  }
  return { purged: dirs.length > 0, exe, removed: dirs };
}

function installPlaywrightBrowser(opts = {}) {
  const botDir = opts.botDir || opts.cwd || process.cwd();
  const base = browsersPath(botDir);
  process.env.PLAYWRIGHT_BROWSERS_PATH = base;
  fs.mkdirSync(base, { recursive: true });

  const exeBefore = expectedExecutable(botDir);
  if (hasBrowserInstalled(base, botDir) && !opts.force) {
    console.log(`[BOXPLUS] Playwright déjà installé (${exeBefore})`);
    return { installed: true, skipped: true, path: base, executable: exeBefore };
  }

  if (exeBefore && !fs.existsSync(exeBefore)) {
    console.warn(`[BOXPLUS] Exécutable attendu absent: ${exeBefore}`);
  }
  purgeIncompleteBrowsers(base, botDir);

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
        timeout: Number(process.env.PLAYWRIGHT_INSTALL_TIMEOUT_MS || 10 * 60 * 1000),
      });
      const exe = expectedExecutable(botDir);
      if (exe && fs.existsSync(exe)) {
        console.log(`[BOXPLUS] Playwright OK — ${exe}`);
        return { installed: true, skipped: false, path: base, variant, executable: exe };
      }
      console.warn(
        `[BOXPLUS] Install ${variant} terminée mais binaire toujours absent (${exe || 'path inconnu'})`
      );
      purgeIncompleteBrowsers(base, botDir);
    } catch (err) {
      console.warn(`[BOXPLUS] Échec install ${variant}:`, err.message || err);
      purgeIncompleteBrowsers(base, botDir);
    }
  }

  const exe = expectedExecutable(botDir);
  throw new Error(
    `Playwright non installé (attendu: ${exe || 'chromium'} sous ${base}). Disque plein (ENOSPC) ou réseau bloqué ?`
  );
}

module.exports = {
  installPlaywrightBrowser,
  browsersPath,
  hasBrowserInstalled,
  expectedExecutable,
  purgeIncompleteBrowsers,
  resolvePlaywright,
};
