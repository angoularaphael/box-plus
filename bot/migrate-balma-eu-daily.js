'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { logInfo, logWarn } = require('../lib/logger');
const { ROOT } = require('../lib/utils');

/**
 * Lance le script boutique Balma / Etats-Unis -> Minimes (session Playwright separee).
 */
function runBalmaEuMigrationDaily() {
  return new Promise((resolve) => {
    const script = path.join(ROOT, 'scripts', 'migrate-balma-boutique-to-minimes.js');
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env, DECIPLUS_HEADLESS: process.env.DECIPLUS_HEADLESS || 'true' },
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
    const timeoutMs = Number(process.env.BALMA_MIGRATE_TIMEOUT_MS || 90 * 60 * 1000);
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
  if (String(process.env.DAILY_OPS_SKIP_MIGRATION || '') === '1') {
    return { skipped: true, reason: 'disabled' };
  }
  if (String(process.env.DAILY_OPS_DRY_RUN || process.env.DRY_RUN || '') === '1') {
    return { skipped: true, reason: 'dry_run' };
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
  runBalmaEuMigrationDaily,
  maybeRunBalmaEuMigrationDaily,
};
