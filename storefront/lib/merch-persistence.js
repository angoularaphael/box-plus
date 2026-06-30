const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { logError } = require('../../lib/logger');
const { getSupabase } = require('./supabase');

const MERCH_KEY = 'merch';
const BUNDLED_MERCH = path.join(ROOT, 'storefront', 'storefront-merch.json');
const MERCH_FILE =
  process.env.BOXPLUS_MERCH_FILE ||
  (process.env.VERCEL ? '/tmp/boxplus-merch.json' : BUNDLED_MERCH);

const BUNDLED_CATALOG = path.join(ROOT, 'data', 'storefront', 'materiel-catalog.json');
const CATALOG_FILE =
  process.env.BOXPLUS_MATERIEL_CATALOG_FILE ||
  (process.env.VERCEL ? '/tmp/boxplus-materiel-catalog.json' : BUNDLED_CATALOG);

let merchHydrated = false;
let merchHydratePromise = null;

function useRemoteStore() {
  return Boolean(
    (process.env.VERCEL || process.env.BOXPLUS_MERCH_REMOTE === '1') &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function seedMerchFile() {
  if (fs.existsSync(MERCH_FILE)) return;
  if (fs.existsSync(BUNDLED_MERCH)) {
    fs.copyFileSync(BUNDLED_MERCH, MERCH_FILE);
    return;
  }
  writeJson(MERCH_FILE, { featured_home: [], products: {}, materiel_overrides: {} });
}

function seedCatalogFile() {
  if (fs.existsSync(CATALOG_FILE)) return;
  if (fs.existsSync(BUNDLED_CATALOG)) {
    fs.copyFileSync(BUNDLED_CATALOG, CATALOG_FILE);
  }
}

async function loadFromRemote(key) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_store_config')
    .select('payload')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.payload || null;
}

async function saveToRemote(key, payload) {
  const sb = getSupabase();
  const { error } = await sb.from('boxplus_store_config').upsert(
    {
      key,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) throw error;
}

function loadMerch() {
  seedMerchFile();
  return readJson(MERCH_FILE, readJson(BUNDLED_MERCH, { featured_home: [], products: {}, materiel_overrides: {} }));
}

async function loadMerchFresh() {
  if (useRemoteStore()) {
    try {
      const remote = await loadFromRemote(MERCH_KEY);
      if (remote) {
        writeJson(MERCH_FILE, remote);
        return remote;
      }
    } catch (err) {
      logError('Chargement merch Supabase', { error: err.message });
    }
  }
  return loadMerch();
}

async function hydrateMerchOnce() {
  if (merchHydrated) return loadMerch();
  if (!merchHydratePromise) {
    merchHydratePromise = loadMerchFresh()
      .then((data) => {
        merchHydrated = true;
        return data;
      })
      .finally(() => {
        merchHydratePromise = null;
      });
  }
  return merchHydratePromise;
}

function saveMerch(data) {
  writeJson(MERCH_FILE, data);
  if (useRemoteStore()) {
    saveToRemote(MERCH_KEY, data).catch((err) => {
      logError('Sauvegarde merch Supabase', { error: err.message });
    });
  }
  return data;
}

async function saveMerchAsync(data) {
  writeJson(MERCH_FILE, data);
  if (!useRemoteStore()) return { data, remote_saved: false };

  try {
    await saveToRemote(MERCH_KEY, data);
    return { data, remote_saved: true };
  } catch (err) {
    logError('Sauvegarde merch Supabase', { error: err.message });
    return {
      data,
      remote_saved: false,
      warning:
        'Sauvegarde locale uniquement — exécutez la migration boxplus_store_config dans Supabase pour persister sur Vercel.',
    };
  }
}

function loadMaterielCatalogLocal() {
  seedCatalogFile();
  return readJson(CATALOG_FILE, readJson(BUNDLED_CATALOG, { products: [], categories: [] }));
}

function saveMaterielCatalog(data) {
  writeJson(CATALOG_FILE, data);
  return data;
}

module.exports = {
  MERCH_FILE,
  CATALOG_FILE,
  useRemoteStore,
  loadMerch,
  loadMerchFresh,
  hydrateMerchOnce,
  saveMerch,
  saveMerchAsync,
  loadMaterielCatalogLocal,
  saveMaterielCatalog,
};
