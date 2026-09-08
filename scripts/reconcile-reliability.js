#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { listAllOrders } = require('../storefront/lib/order-persistence');
const { reconcileOrders } = require('../lib/reliability-reconcile');

async function main() {
  if (process.argv.includes('--apply')) {
    throw new Error('Ce rapport est volontairement read-only : --apply est interdit');
  }
  const orders = await listAllOrders();
  const report = reconcileOrders(orders);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.anomalies.some((item) => item.severity === 'critical')) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
