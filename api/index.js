/**
 * Entrée Vercel — Express boutique Boxing Center
 */
const { createApp } = require('../storefront/server');
const { startAutoSync } = require('../storefront/lib/auto-sync');

const app = createApp();

if (process.env.VERCEL !== '1') {
  startAutoSync();
}

module.exports = app;
