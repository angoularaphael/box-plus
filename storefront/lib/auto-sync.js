const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { logInfo, logWarn } = require('../../lib/logger');
const { syncCatalogFromDeciplus } = require('../../lib/catalog-sync');
const { getStoreProducts } = require('./deciplus-sync');

const SYNC_FILE = path.join(ROOT, 'data', 'storefront', 'catalog-live.json');
const INTERVAL_MS = Number(process.env.STORE_SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000);
const STALE_MS = Number(process.env.STORE_SYNC_STALE_MS || 6 * 60 * 60 * 1000);

let syncing = false;
let timer = null;

function isSyncEnabled() {
  return String(process.env.STORE_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
}

function isCatalogStale() {
  const catalog = getStoreProducts({ preferLive: true });
  if (!catalog.synced_at) return true;
  const age = Date.now() - new Date(catalog.synced_at).getTime();
  return age > STALE_MS;
}

function canRunPlaywrightSync() {
  if (!process.env.DECIPLUS_USER || !process.env.DECIPLUS_PASSWORD) return false;
  if (process.env.VERCEL === '1' && String(process.env.STORE_SYNC_ON_VERCEL || 'false') !== 'true') {
    return false;
  }
  return true;
}

async function runCatalogSyncIfNeeded({ force = false } = {}) {
  if (!isSyncEnabled()) return { skipped: true, reason: 'disabled' };
  if (syncing) return { skipped: true, reason: 'in_progress' };
  if (!force && !isCatalogStale()) return { skipped: true, reason: 'fresh' };
  if (!canRunPlaywrightSync()) {
    logWarn('Sync auto ignorée (credentials Deciplus ou hébergement serverless sans Playwright)');
    return { skipped: true, reason: 'no_playwright' };
  }

  syncing = true;
  try {
    return await syncCatalogFromDeciplus({ force: true });
  } finally {
    syncing = false;
  }
}

function startAutoSync() {
  if (!isSyncEnabled()) {
    logInfo('Sync catalogue auto désactivée (STORE_SYNC_ENABLED=false)');
    return;
  }

  const catalog = getStoreProducts();
  logInfo('Catalogue boutique au démarrage', {
    source: catalog.synced_at ? 'deciplus-live' : 'static-fallback',
    count: catalog.products?.length || 0,
    synced_at: catalog.synced_at,
  });

  runCatalogSyncIfNeeded().catch((err) => {
    logWarn('Sync catalogue au démarrage en échec', { error: err.message });
  });

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    runCatalogSyncIfNeeded().catch((err) => {
      logWarn('Sync catalogue planifiée en échec', { error: err.message });
    });
  }, INTERVAL_MS);

  if (timer.unref) timer.unref();
}

module.exports = {
  startAutoSync,
  runCatalogSyncIfNeeded,
  isCatalogStale,
  SYNC_FILE,
};
