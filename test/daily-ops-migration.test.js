'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  balmaMigrateDailyEnabled,
  maybeRunBalmaEuMigrationDaily,
} = require('../bot/migrate-balma-eu-daily');

test('migration quotidienne desactivee sans BALMA_MIGRATE_DAILY=1', async () => {
  const prev = process.env.BALMA_MIGRATE_DAILY;
  const prevSkip = process.env.DAILY_OPS_SKIP_MIGRATION;
  delete process.env.BALMA_MIGRATE_DAILY;
  delete process.env.DAILY_OPS_SKIP_MIGRATION;
  assert.equal(balmaMigrateDailyEnabled(), false);
  const out = await maybeRunBalmaEuMigrationDaily();
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'balma_migrate_daily_off');
  if (prev !== undefined) process.env.BALMA_MIGRATE_DAILY = prev;
  if (prevSkip !== undefined) process.env.DAILY_OPS_SKIP_MIGRATION = prevSkip;
});

test('DAILY_OPS_SKIP_MIGRATION=1 bloque meme avec BALMA_MIGRATE_DAILY=1', () => {
  const prevDaily = process.env.BALMA_MIGRATE_DAILY;
  const prevSkip = process.env.DAILY_OPS_SKIP_MIGRATION;
  process.env.BALMA_MIGRATE_DAILY = '1';
  process.env.DAILY_OPS_SKIP_MIGRATION = '1';
  assert.equal(balmaMigrateDailyEnabled(), false);
  if (prevDaily !== undefined) process.env.BALMA_MIGRATE_DAILY = prevDaily;
  else delete process.env.BALMA_MIGRATE_DAILY;
  if (prevSkip !== undefined) process.env.DAILY_OPS_SKIP_MIGRATION = prevSkip;
  else delete process.env.DAILY_OPS_SKIP_MIGRATION;
});
