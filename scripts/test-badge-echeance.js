#!/usr/bin/env node
require('dotenv').config();

const { runWithSession } = require('../bot/browser-pool');
const { login } = require('../bot/auth');
const { enforceBadgeEcheance } = require('../bot/sale');

const memberId = process.argv[2];
if (!memberId) {
  console.error('Usage: node scripts/test-badge-echeance.js <memberId>');
  process.exit(1);
}

runWithSession('test-badge-echeance', async (page) => {
  await login(page);
  const result = await enforceBadgeEcheance(page, memberId, {
    badge_timing: 'deferred',
    prelevement_delay_days: 3,
    badge_validity_months: 13,
    paiement_comptant: false,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
