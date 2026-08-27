'use strict';

/**
 * Analytics boutique — pageviews + événements funnel.
 * Sur Vercel le JSONL /tmp disparaît à chaque instance : on persiste dans Supabase.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir } = require('../../lib/utils');
const { logError } = require('../../lib/logger');

const DATA_DIR =
  process.env.BOXPLUS_ANALYTICS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-analytics' : path.join(ROOT, 'data', 'storefront', 'analytics'));

const PAGEVIEWS_FILE = path.join(DATA_DIR, 'pageviews.jsonl');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const MAX_LINES_READ = 50000;
const PAGE_SIZE = 1000;
const MAX_REMOTE_ROWS = 40000;
const STORE_CONFIG_PREFIX = 'pv:';

const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternal|whatsapp|telegram|preview|lighthouse|headless|phantom|puppeteer|playwright|ahrefs|semrush|yandex|bytespider|gptbot|claudebot|applebot/i;

let remoteTable = 'boxplus_pageviews'; // or 'store_config' after a missing-table error

function init() {
  ensureDir(DATA_DIR);
}

function useRemoteAnalytics() {
  return Boolean(
    (process.env.VERCEL ||
      process.env.BOXPLUS_ANALYTICS_REMOTE === '1' ||
      process.env.BOXPLUS_ORDERS_REMOTE === '1') &&
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function isBotUa(ua) {
  return BOT_UA.test(String(ua || ''));
}

function isSkippedPath(pagePath) {
  const p = String(pagePath || '').split('?')[0].toLowerCase();
  return (
    p.startsWith('/admin') ||
    p.startsWith('/api/') ||
    p.startsWith('/dev') ||
    p === '/robots.txt' ||
    p === '/sitemap.xml'
  );
}

function normalizeVid(vid) {
  const v = String(vid || '')
    .trim()
    .slice(0, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(v)) return '';
  return v;
}

function normalizePath(pagePath) {
  const raw = String(pagePath || '/').slice(0, 200);
  const noHash = raw.split('#')[0];
  if (!noHash.startsWith('/')) return `/${noHash}`;
  return noHash || '/';
}

function appendJsonl(file, row) {
  init();
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function readJsonl(file, limit = MAX_LINES_READ) {
  init();
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const slice = lines.length > limit ? lines.slice(-limit) : lines;
  const out = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

function isMissingTableError(error) {
  const msg = String(error?.message || error?.details || '');
  const code = String(error?.code || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /schema cache/i.test(msg) ||
    /does not exist/i.test(msg) ||
    /could not find the table/i.test(msg)
  );
}

async function insertDedicated(sb, row) {
  const { error } = await sb.from('boxplus_pageviews').insert({
    type: row.type || 'pageview',
    path: row.path,
    referrer: row.referrer || '',
    vid: row.vid || null,
    name: row.name || null,
    props: row.props || {},
    ua: row.ua || '',
    created_at: row.at,
  });
  return error;
}

async function insertStoreConfig(sb, row) {
  const key = `${STORE_CONFIG_PREFIX}${Date.now().toString(36)}:${crypto.randomBytes(6).toString('hex')}`;
  const { error } = await sb.from('boxplus_store_config').upsert(
    {
      key,
      payload: {
        type: row.type || 'pageview',
        path: row.path,
        referrer: row.referrer || '',
        vid: row.vid || '',
        name: row.name || '',
        props: row.props || {},
        ua: row.ua || '',
        at: row.at,
      },
      updated_at: row.at,
    },
    { onConflict: 'key' }
  );
  return error;
}

async function persistRemote(row) {
  if (!useRemoteAnalytics()) return;
  try {
    const { getSupabase } = require('./supabase');
    const sb = getSupabase();
    if (remoteTable === 'boxplus_pageviews') {
      const error = await insertDedicated(sb, row);
      if (!error) return;
      if (isMissingTableError(error)) {
        remoteTable = 'store_config';
      } else {
        logError('Analytics — insert pageviews', { error: error.message });
        return;
      }
    }
    const fallback = await insertStoreConfig(sb, row);
    if (fallback) logError('Analytics — insert store_config', { error: fallback.message });
  } catch (err) {
    logError('Analytics — persist remote', { error: err.message });
  }
}

async function loadDedicated(sb, days, typeFilter) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = [];
  for (let from = 0; from < MAX_REMOTE_ROWS; from += PAGE_SIZE) {
    let q = sb
      .from('boxplus_pageviews')
      .select('type,path,referrer,vid,name,props,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (typeFilter) q = q.eq('type', typeFilter);
    const { data, error } = await q;
    if (error) return { error, rows: [] };
    const batch = data || [];
    rows.push(
      ...batch.map((r) => ({
        type: r.type || 'pageview',
        path: r.path,
        referrer: r.referrer,
        vid: r.vid,
        name: r.name,
        props: r.props,
        at: r.created_at,
      }))
    );
    if (batch.length < PAGE_SIZE) break;
  }
  return { error: null, rows };
}

async function loadStoreConfig(sb, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = [];
  for (let from = 0; from < MAX_REMOTE_ROWS; from += PAGE_SIZE) {
    const { data, error } = await sb
      .from('boxplus_store_config')
      .select('key,payload,updated_at')
      .like('key', `${STORE_CONFIG_PREFIX}%`)
      .gte('updated_at', since)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { error, rows: [] };
    const batch = data || [];
    for (const r of batch) {
      const p = r.payload || {};
      rows.push({
        type: p.type || 'pageview',
        path: p.path,
        referrer: p.referrer,
        vid: p.vid,
        name: p.name,
        props: p.props,
        at: p.at || r.updated_at,
      });
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return { error: null, rows };
}

async function loadRemoteRows(days, typeFilter) {
  if (!useRemoteAnalytics()) return null;
  try {
    const { getSupabase } = require('./supabase');
    const sb = getSupabase();
    if (remoteTable === 'boxplus_pageviews') {
      const dedicated = await loadDedicated(sb, days, typeFilter);
      if (!dedicated.error) {
        return typeFilter ? dedicated.rows.filter((r) => r.type === typeFilter) : dedicated.rows;
      }
      if (isMissingTableError(dedicated.error)) remoteTable = 'store_config';
      else {
        logError('Analytics — lecture pageviews', { error: dedicated.error.message });
        return null;
      }
    }
    const fallback = await loadStoreConfig(sb, days);
    if (fallback.error) {
      logError('Analytics — lecture store_config', { error: fallback.error.message });
      return null;
    }
    return typeFilter ? fallback.rows.filter((r) => r.type === typeFilter) : fallback.rows;
  } catch (err) {
    logError('Analytics — lecture remote', { error: err.message });
    return null;
  }
}

function buildPageviewRow({ path: pagePath, referrer, ua, vid } = {}) {
  const p = normalizePath(pagePath);
  if (isBotUa(ua) || isSkippedPath(p)) return null;
  return {
    type: 'pageview',
    path: p,
    referrer: String(referrer || '').slice(0, 300),
    ua: String(ua || '').slice(0, 200),
    vid: normalizeVid(vid),
    at: new Date().toISOString(),
  };
}

function buildEventRow({ name, props = {}, path: pagePath, ua, vid } = {}) {
  return {
    type: 'event',
    name: String(name || 'event').slice(0, 80),
    props: typeof props === 'object' && props ? props : {},
    path: normalizePath(pagePath || ''),
    ua: String(ua || '').slice(0, 200),
    vid: normalizeVid(vid),
    at: new Date().toISOString(),
  };
}

function safeAppendJsonl(file, row) {
  try {
    appendJsonl(file, row);
  } catch {
    /* Vercel /tmp parfois illisible — le remote reste la source de vérité */
  }
}

function trackPageview(input) {
  const row = buildPageviewRow(input);
  if (!row) return null;
  safeAppendJsonl(PAGEVIEWS_FILE, row);
  persistRemote(row).catch(() => {});
  return row;
}

function trackEvent(input) {
  const row = buildEventRow(input);
  safeAppendJsonl(EVENTS_FILE, row);
  persistRemote(row).catch(() => {});
  return row;
}

async function trackPageviewAsync(input) {
  const row = buildPageviewRow(input);
  if (!row) return null;
  safeAppendJsonl(PAGEVIEWS_FILE, row);
  await persistRemote(row);
  return row;
}

async function trackEventAsync(input) {
  const row = buildEventRow(input);
  safeAppendJsonl(EVENTS_FILE, row);
  await persistRemote(row);
  return row;
}

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

function summarizeFromRows(rows = [], days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const byPath = {};
  const byDay = {};
  const visitors = new Set();
  let pageviews = 0;
  for (const r of rows) {
    const t = new Date(r.at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    if ((r.type || 'pageview') !== 'pageview') continue;
    pageviews += 1;
    const p = r.path || '/';
    byPath[p] = (byPath[p] || 0) + 1;
    const d = dayKey(r.at);
    byDay[d] = (byDay[d] || 0) + 1;
    visitors.add(r.vid || `anon:${r.at}:${pageviews}`);
  }
  const top_pages = Object.entries(byPath)
    .map(([pathKey, count]) => ({ path: pathKey, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const daily = Object.entries(byDay)
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return {
    total: visitors.size,
    pageviews,
    unique_visitors: visitors.size,
    top_pages,
    daily,
    days,
  };
}

function summarizeVisitsSync(days = 30) {
  return summarizeFromRows(readJsonl(PAGEVIEWS_FILE), days);
}

async function summarizeVisits(days = 30) {
  const remote = await loadRemoteRows(days, 'pageview');
  if (Array.isArray(remote)) return summarizeFromRows(remote, days);
  return summarizeVisitsSync(days);
}

const FUNNEL_STEPS = [
  { step: 1, label: 'Offre' },
  { step: 2, label: 'Salle' },
  { step: 3, label: 'Identité' },
  { step: 4, label: 'Paiement' },
  { step: 5, label: 'IBAN' },
  { step: 6, label: 'Dossier' },
  { step: 7, label: 'Signature' },
  { step: 8, label: 'Confirmé' },
];

function summarizeFunnelFromOrders(orders = []) {
  const counts = {};
  for (let i = 1; i <= 8; i += 1) counts[i] = 0;
  let started = 0;
  let paid = 0;
  let confirmed = 0;
  let abandoned = 0;

  for (const o of orders) {
    const step = Math.min(8, Math.max(1, Number(o.step) || 1));
    started += 1;
    for (let s = 1; s <= step; s += 1) counts[s] += 1;
    if (o.payment?.status === 'paid') paid += 1;
    if (step >= 8 || o.signature?.signed_at) confirmed += 1;
    else abandoned += 1;
  }

  const funnel = FUNNEL_STEPS.map((f, idx) => {
    const reached = counts[f.step] || 0;
    const prev = idx === 0 ? started : counts[FUNNEL_STEPS[idx - 1].step] || 0;
    const drop = prev > 0 ? Math.round(((prev - reached) / prev) * 100) : 0;
    return {
      step: f.step,
      label: f.label,
      reached,
      drop_pct_from_prev: idx === 0 ? 0 : drop,
    };
  });

  return {
    started,
    paid,
    confirmed,
    abandoned,
    conversion_pct: started ? Math.round((confirmed / started) * 100) : 0,
    funnel,
  };
}

function summarizeFunnelEventsFromRows(rows = [], days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const filtered = rows.filter((r) => {
    const t = new Date(r.at).getTime();
    return !Number.isNaN(t) && t >= cutoff && r.name === 'funnel_step';
  });
  const byStep = {};
  for (const r of filtered) {
    const step = Number(r.props?.step) || 0;
    if (step < 1 || step > 8) continue;
    byStep[step] = (byStep[step] || 0) + 1;
  }
  return {
    events: filtered.length,
    by_step: FUNNEL_STEPS.map((f) => ({
      step: f.step,
      label: f.label,
      events: byStep[f.step] || 0,
    })),
  };
}

function summarizeFunnelEventsSync(days = 30) {
  return summarizeFunnelEventsFromRows(readJsonl(EVENTS_FILE), days);
}

async function summarizeFunnelEvents(days = 30) {
  const remote = await loadRemoteRows(days, 'event');
  if (Array.isArray(remote)) return summarizeFunnelEventsFromRows(remote, days);
  return summarizeFunnelEventsSync(days);
}

module.exports = {
  trackPageview,
  trackEvent,
  trackPageviewAsync,
  trackEventAsync,
  summarizeVisits,
  summarizeVisitsSync,
  summarizeFromRows,
  summarizeFunnelFromOrders,
  summarizeFunnelEvents,
  summarizeFunnelEventsSync,
  FUNNEL_STEPS,
  isBotUa,
  isSkippedPath,
  normalizeVid,
  normalizePath,
};
