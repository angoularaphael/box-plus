#!/usr/bin/env node
'use strict';
/**
 * Test manuel du job ops 15h (impayés + migration Balma/EU).
 *
 *   node scripts/ops-daily-15h.js
 *   DAILY_OPS_RUN_NOW=1 node scripts/ops-daily-15h.js
 *   DRY_RUN=1 node scripts/ops-daily-15h.js
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';

const { closeBrowser } = require('../bot/browser-pool');
const { runDailyOps15h } = require('../bot/daily-ops-15h');

(async () => {
  const report = await runDailyOps15h({ force: String(process.env.DAILY_OPS_RUN_NOW || '') === '1' });
  console.log(JSON.stringify(report, null, 2));
  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
