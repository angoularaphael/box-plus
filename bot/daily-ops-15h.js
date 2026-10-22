'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');
const { logInfo, logWarn } = require('../lib/logger');
const { listPending } = require('../lib/queue');
const { login, gotoDeciplus } = require('./auth');
const { runWithSession, closeBrowser } = require('./browser-pool');
const { parisNow } = require('../storefront/lib/birthday-wishes');
const { runUnpaidDailyOps } = require('./unpaid-daily-ops');
const { maybeRunBalmaEuMigrationDaily } = require('./migrate-balma-eu-daily');

let dailyOpsRunning = false;

function stateFile() {
  const dir = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');
  return path.join(dir, 'daily-ops-15h-state.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { last_date: '' };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

function dailyOpsHour() {
  const n = Number(process.env.BOT_DAILY_OPS_HOUR);
  return Number.isFinite(n) ? n : 15;
}

function shouldRunDailyOps15h(now = new Date(), lastDateKey = '') {
  if (String(process.env.DAILY_OPS_RUN_NOW || '') === '1') return true;
  if (String(process.env.DAILY_OPS_DISABLED || '') === '1') return false;
  const today = parisNow(now);
  if (lastDateKey === today.dateKey) return false;
  return today.hour >= dailyOpsHour();
}

async function runDailyOps15h({ force = false } = {}) {
  const role = String(process.env.BOT_ROLE || 'all').toLowerCase();
  if (role === 'sales') return { skipped: true, reason: 'sales_bot' };
  if (dailyOpsRunning) return { skipped: true, reason: 'already_running' };

  const now = new Date();
  const today = parisNow(now);
  const state = loadState();
  if (!force && !shouldRunDailyOps15h(now, state.last_date)) {
    return { skipped: true, reason: 'not_due', today: today.dateKey, hour: today.hour };
  }
  if (listPending().length > 0) {
    return { skipped: true, reason: 'jobs_pending' };
  }

  dailyOpsRunning = true;
  const report = {
    date: today.dateKey,
    started_at: new Date().toISOString(),
    unpaid: null,
    migration: null,
  };

  try {
    report.unpaid = await runWithSession('daily-ops-unpaid', async (page) => {
      await gotoDeciplus(page, 'nextgen/home').catch(() => {});
      await login(page, { siteLabel: process.env.DECIPLUS_DEFAULT_SITE || 'Minimes' });
      return runUnpaidDailyOps(page);
    });

    await closeBrowser().catch(() => {});
    const settleMs = Number(process.env.DAILY_OPS_BROWSER_SETTLE_MS || 8000);
    if (settleMs > 0) {
      await new Promise((r) => setTimeout(r, settleMs));
    }

    report.migration = await maybeRunBalmaEuMigrationDaily();

    state.last_date = today.dateKey;
    state.last_run_at = new Date().toISOString();
    state.last_report = {
      unpaid_scanned: report.unpaid?.scanned,
      grace: report.unpaid?.grace?.length,
      resiliated: report.unpaid?.resiliated?.length,
      migration_ok: report.migration?.ok,
    };
    saveState(state);

    logInfo('Ops quotidien 15h', report.last_report);
    report.finished_at = new Date().toISOString();
    return report;
  } catch (err) {
    saveState(state);
    throw err;
  } finally {
    dailyOpsRunning = false;
  }
}

async function maybeRunDailyOps15h() {
  try {
    if (dailyOpsRunning) return { skipped: true, reason: 'already_running' };
    const state = loadState();
    if (!shouldRunDailyOps15h(new Date(), state.last_date)) return { skipped: true, reason: 'not_due' };
    return await runDailyOps15h();
  } catch (err) {
    logWarn('Ops quotidien 15h', { error: err.message });
    return { ok: false, error: err.message };
  }
}

function isDailyOpsRunning() {
  return dailyOpsRunning;
}

module.exports = {
  shouldRunDailyOps15h,
  runDailyOps15h,
  maybeRunDailyOps15h,
  isDailyOpsRunning,
  loadState,
  saveState,
};
