'use strict';

/**
 * Analytics boutique — pageviews + événements funnel (stockage local /tmp ou data/).
 */
const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir } = require('../../lib/utils');

const DATA_DIR =
  process.env.BOXPLUS_ANALYTICS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-analytics' : path.join(ROOT, 'data', 'storefront', 'analytics'));

const PAGEVIEWS_FILE = path.join(DATA_DIR, 'pageviews.jsonl');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const MAX_LINES_READ = 50000;

function init() {
  ensureDir(DATA_DIR);
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

function trackPageview({ path: pagePath, referrer, ua } = {}) {
  const row = {
    type: 'pageview',
    path: String(pagePath || '/').slice(0, 200),
    referrer: String(referrer || '').slice(0, 300),
    ua: String(ua || '').slice(0, 200),
    at: new Date().toISOString(),
  };
  appendJsonl(PAGEVIEWS_FILE, row);
  return row;
}

function trackEvent({ name, props = {}, path: pagePath } = {}) {
  const row = {
    type: 'event',
    name: String(name || 'event').slice(0, 80),
    props: typeof props === 'object' && props ? props : {},
    path: String(pagePath || '').slice(0, 200),
    at: new Date().toISOString(),
  };
  appendJsonl(EVENTS_FILE, row);
  return row;
}

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

function summarizeVisits(days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const rows = readJsonl(PAGEVIEWS_FILE);
  const byPath = {};
  const byDay = {};
  let total = 0;
  for (const r of rows) {
    const t = new Date(r.at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    total += 1;
    const p = r.path || '/';
    byPath[p] = (byPath[p] || 0) + 1;
    const d = dayKey(r.at);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const top_pages = Object.entries(byPath)
    .map(([pathKey, count]) => ({ path: pathKey, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const daily = Object.entries(byDay)
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { total, top_pages, daily, days };
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

function summarizeFunnelEvents(days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const rows = readJsonl(EVENTS_FILE).filter((r) => {
    const t = new Date(r.at).getTime();
    return !Number.isNaN(t) && t >= cutoff && r.name === 'funnel_step';
  });
  const byStep = {};
  for (const r of rows) {
    const step = Number(r.props?.step) || 0;
    if (step < 1 || step > 8) continue;
    byStep[step] = (byStep[step] || 0) + 1;
  }
  return {
    events: rows.length,
    by_step: FUNNEL_STEPS.map((f) => ({
      step: f.step,
      label: f.label,
      events: byStep[f.step] || 0,
    })),
  };
}

module.exports = {
  trackPageview,
  trackEvent,
  summarizeVisits,
  summarizeFunnelFromOrders,
  summarizeFunnelEvents,
  FUNNEL_STEPS,
};
