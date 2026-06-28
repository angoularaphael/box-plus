#!/usr/bin/env node
/**
 * Rapport console — test toutes les offres (unit + API demo optionnelle).
 * Usage: node scripts/test-all-offers.js [--live]
 */
require('dotenv').config();

const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const live = process.argv.includes('--live');

console.log('=== Tests unitaires (toutes les offres) ===\n');
try {
  execSync('node --test test/all-offers.test.js', { cwd: ROOT, stdio: 'inherit' });
} catch {
  process.exit(1);
}

if (live) {
  console.log('\n=== Rapport détaillé API demo ===\n');
  process.env.STORE_TEST_LIVE = '1';
  require('../test/all-offers-live-report.js');
}

console.log('\n✅ Toutes les offres OK');
