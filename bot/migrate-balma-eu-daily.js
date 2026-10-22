'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { logInfo, logWarn } = require('../lib/logger');
const { ROOT } = require('../lib/utils');
const { hasActiveBrowser } = require('./browser-pool');

function balmaMigrateDailyEnabled() {
  if (String(process.env.DAILY_OPS_SKIP_MIGRATION || '') === '1') return false;
  return String(process.env.BALMA_MIGRATE_DAILY || '') === '1';
}

function freeMemoryMb() {
  return os.freemem() / (1024 * 1024);
}

function hasEnoughMemoryForMigration() {
  const minMb = Number(process.env.BALMA_MIGRATE_MIN_FREE_MB || 280);
  if (!Number.isFinite(minMb) || minMb <= 0) return true;
  return freeMemoryMb() >= minMb;
}

/**
 * Lance le script boutique Balma / Etats-Unis -> Minimes (session Playwright separee).
 */
function runBalmaEuMigrationDaily() {
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'scripts', 'migrate-balma-boutique-to-minimes.js');
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, DECIPLUS_HEADLESS: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    const timeoutMs = Math.max(60000, Number(process.env.BALMA_MIGRATE_TIMEOUT_MS || 90 * 60 * 1000));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = (s) => String(s || '').slice(-4000);
      resolve({
        ok: code === 0,
        code,
        stdout: tail(stdout),
        stderr: tail(stderr),
      });
    });
  });
}

async function maybeRunBalmaEuMigrationDaily() {
  if (String(process.env.DAILY_OPS_DRY_RUN || process.env.DRY_RUN || '') === '1') {
    return { skipped: true, reason: 'dry_run' };
  }
  if (!balmaMigrateDailyEnabled()) {
    return { skipped: true, reason: 'balma_migrate_daily_off' };
  }
  if (hasActiveBrowser()) {
    return { skipped: true, reason: 'browser_still_open' };
  }
  if (!hasEnoughMemoryForMigration()) {
    const free = Math.round(freeMemoryMb());
    logWarn('Migration Balma / EU reportee (memoire)', { free_mb: free });
    return { skipped: true, reason: 'low_memory', free_mb: free };
  }
  logInfo('Migration quotidienne Balma / Etats-Unis -> Minimes (demarrage)');
  const out = await runBalmaEuMigrationDaily();
  if (!out.ok) {
    logWarn('Migration Balma / EU', { code: out.code, stderr: out.stderr?.slice(0, 400) });
  } else {
    logInfo('Migration Balma / EU terminee', { code: out.code });
  }
  return out;
}

module.exports = {
  balmaMigrateDailyEnabled,
  hasEnoughMemoryForMigration,
  runBalmaEuMigrationDaily,
  maybeRunBalmaEuMigrationDaily,
};
