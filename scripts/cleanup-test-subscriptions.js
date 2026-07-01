#!/usr/bin/env node
/**
 * Résilie les abonnements / ventes test Deciplus créés par BOXPLUS.
 *
 * Usage:
 *   node scripts/cleanup-test-subscriptions.js              # dry-run (liste seulement)
 *   node scripts/cleanup-test-subscriptions.js --execute    # annule les ventes actives
 *   node scripts/cleanup-test-subscriptions.js --execute --ids 20931,20932
 *   node scripts/cleanup-test-subscriptions.js --scan-range 20899-20950
 *   node scripts/cleanup-test-subscriptions.js --extra-ids data/cleanup-extra-member-ids.txt
 */
require('dotenv').config();

const path = require('path');
const { login } = require('../bot/auth');
const { runWithSession } = require('../bot/browser-pool');
const {
  collectMemberIdsFromFile,
  runTestCleanup,
} = require('../bot/test-cleanup');

function parseArgs(argv) {
  const execute = argv.includes('--execute');
  const includeAll = argv.includes('--all');
  const idsIdx = argv.indexOf('--ids');
  const rangeIdx = argv.indexOf('--scan-range');
  const extraIdx = argv.indexOf('--extra-ids');

  const manualIds =
    idsIdx >= 0 && argv[idsIdx + 1]
      ? argv[idsIdx + 1].split(/[,\s;]+/).filter((id) => /^\d+$/.test(id))
      : [];

  const scanRange =
    rangeIdx >= 0 && argv[rangeIdx + 1]
      ? argv[rangeIdx + 1]
      : process.env.CLEANUP_SCAN_ID_RANGE || '20899-20950';

  const extraFile =
    extraIdx >= 0 && argv[extraIdx + 1]
      ? argv[extraIdx + 1]
      : path.join(__dirname, '..', 'data', 'cleanup-extra-member-ids.txt');

  const extraIds = [...manualIds, ...collectMemberIdsFromFile(extraFile)];

  return {
    execute,
    onlyTest: !includeAll,
    extraIds: [...new Set(extraIds)],
    scanRange,
    includeProcessed: true,
    includeSearch: true,
  };
}

function printReport(outcome) {
  console.log(`\n=== Nettoyage ventes test Deciplus (${outcome.execute ? 'EXECUTE' : 'DRY-RUN'}) ===\n`);
  console.log(`Membres ciblés: ${outcome.total}\n`);

  for (const row of outcome.results) {
    const label = [row.prenom, row.nom].filter(Boolean).join(' ') || '—';
    console.log(`• Membre ${row.member_id} — ${label} (${row.email || 'email ?'}) [${row.source || 'mix'}]`);
    if (row.has_consulter) {
      console.log('  → vente(s) active(s) détectée(s)');
    } else {
      console.log('  → aucune vente active (Consulter absent)');
    }
    if (outcome.execute) {
      console.log(`  → annulées: ${row.cancelled_count ?? 0}${row.reason ? ` (${row.reason})` : ''}`);
    }
  }

  if (!outcome.execute) {
    console.log('\nAucune modification — relancez avec --execute pour annuler les ventes.');
  }
}

(async () => {
  const options = parseArgs(process.argv.slice(2));

  console.log('Options:', {
    execute: options.execute,
    extraIds: options.extraIds,
    scanRange: options.scanRange,
    onlyTest: options.onlyTest,
  });

  const outcome = await runWithSession('cleanup-test', async (page) => {
    await login(page);
    return runTestCleanup(page, options);
  });

  printReport(outcome);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
