'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { logError, logInfo } = require('../../lib/logger');
const { getSupabase } = require('./supabase');

const CONFIG_KEY = 'site_maintenance';
const DEFAULT_MESSAGE =
  'Le ring est fermé le temps d’une maintenance. On revient très vite — Boxing Center Toulouse.';

const FILE =
  process.env.BOXPLUS_MAINTENANCE_FILE ||
  (process.env.VERCEL
    ? '/tmp/boxplus-maintenance.json'
    : path.join(ROOT, 'data', 'storefront', 'maintenance.json'));

let memory = null;

function envForcedOn() {
  const v = String(process.env.SITE_MAINTENANCE || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

function useRemoteStore() {
  return Boolean(
    (process.env.VERCEL || process.env.BOXPLUS_MERCH_REMOTE === '1') &&
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function readFileState() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeFileState(state) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    logError('Maintenance — écriture fichier', { error: err.message });
  }
}

function normalize(raw = {}, source = 'memory') {
  const enabled = Boolean(raw.enabled);
  const message = String(raw.message || DEFAULT_MESSAGE).trim().slice(0, 280) || DEFAULT_MESSAGE;
  return {
    enabled,
    message,
    updated_at: raw.updated_at || null,
    updated_by: raw.updated_by || null,
    source,
    env_forced: envForcedOn(),
  };
}

async function loadFromRemote() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_store_config')
    .select('payload')
    .eq('key', CONFIG_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.payload || null;
}

async function saveToRemote(payload) {
  const sb = getSupabase();
  const { error } = await sb.from('boxplus_store_config').upsert(
    {
      key: CONFIG_KEY,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) throw error;
}

async function getMaintenance() {
  if (envForcedOn()) {
    return normalize({ enabled: true, message: DEFAULT_MESSAGE }, 'env');
  }
  if (memory && Date.now() - (memory._ts || 0) < 4000) {
    return normalize(memory, 'memory');
  }
  if (useRemoteStore()) {
    try {
      const remote = await loadFromRemote();
      if (remote) {
        memory = { ...remote, _ts: Date.now() };
        writeFileState(remote);
        return normalize(remote, 'remote');
      }
    } catch (err) {
      logError('Maintenance — lecture Supabase', { error: err.message });
    }
  }
  const file = readFileState();
  if (file) {
    memory = { ...file, _ts: Date.now() };
    return normalize(file, 'file');
  }
  if (memory) return normalize(memory, 'memory');
  return normalize({ enabled: false }, 'default');
}

async function setMaintenance({ enabled, message, user } = {}) {
  if (envForcedOn() && enabled === false) {
    const current = await getMaintenance();
    return {
      ...current,
      warning: 'SITE_MAINTENANCE=1 est posé sur le serveur — décoche la variable Vercel pour rouvrir.',
    };
  }
  const prev = await getMaintenance();
  const next = normalize({
    enabled: Boolean(enabled),
    message: message != null ? message : prev.message,
    updated_at: new Date().toISOString(),
    updated_by: user || null,
  });
  memory = { ...next, _ts: Date.now() };
  writeFileState(next);
  let remote_saved = false;
  if (useRemoteStore()) {
    try {
      await saveToRemote(next);
      remote_saved = true;
    } catch (err) {
      logError('Maintenance — sauvegarde Supabase', { error: err.message });
    }
  }
  logInfo('Maintenance boutique', { enabled: next.enabled, remote_saved });
  return { ...next, remote_saved };
}

function isMaintenanceBypass(req) {
  const p = String(req.path || req.url || '').split('?')[0];
  if (p.startsWith('/admin')) return true;
  if (p.startsWith('/api/admin')) return true;
  if (p.startsWith('/api/auth')) return true;
  if (p === '/api/maintenance') return true;
  if (p.startsWith('/api/webhooks') || p.startsWith('/api/stripe/webhook') || /webhook/i.test(p)) {
    return true;
  }
  if (p.startsWith('/api/internal') || p.startsWith('/api/cron')) return true;
  if (p.startsWith('/api/sitemap') || p === '/sitemap.xml' || p === '/robots.txt') return true;
  if (/\.(css|js|mjs|map|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp4|webm)$/i.test(p)) return true;
  if (
    p.startsWith('/img/') ||
    p.startsWith('/css/') ||
    p.startsWith('/js/') ||
    p.startsWith('/fonts/') ||
    p.startsWith('/media/') ||
    p.startsWith('/favicon')
  ) {
    return true;
  }
  return false;
}

function maintenancePageHtml(state = {}) {
  const msg = String(state.message || DEFAULT_MESSAGE)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Maintenance — Boxing Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Montserrat:wght@500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/maintenance.css" />
</head>
<body class="bc-maint">
  <main class="bc-maint__ring">
    <p class="bc-maint__kicker">Boxing Center · Toulouse</p>
    <p class="bc-maint__gong">GONG</p>
    <h1>Round suspendu</h1>
    <p class="bc-maint__copy">${msg}</p>
    <p class="bc-maint__foot">Le back-office reste ouvert pour l’équipe.</p>
  </main>
</body>
</html>`;
}

module.exports = {
  DEFAULT_MESSAGE,
  getMaintenance,
  setMaintenance,
  isMaintenanceBypass,
  maintenancePageHtml,
  envForcedOn,
};
