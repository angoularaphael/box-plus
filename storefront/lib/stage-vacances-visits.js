'use strict';

const { getSupabase } = require('./supabase');
const { fetchAllSince } = require('./seance-offerte-visits');

function normalizeStageSrc(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '');
  if (!s || s === 'direct') return 'direct';
  if (s === 'mail' || s === 'email' || s === 'newsletter') return 'mail';
  if (s === 'sms' || s === 'texto') return 'sms';
  if (s === 'ig' || s === 'insta' || s === 'instagram' || s === 'story') return 'ig';
  return 'other';
}

function emptyBucket() {
  return { days: [], total: 0, mail: 0, sms: 0, ig: 0, other: 0, direct: 0 };
}

function emptySummary() {
  const clicks = emptyBucket();
  const sales = emptyBucket();
  return { clicks, sales, paid_total: 0, revenue_cents: 0, conversion_pct: 0 };
}

function summarizeVisitRows(data) {
  const byDay = {};
  const counts = { mail: 0, sms: 0, ig: 0, other: 0, direct: 0 };
  for (const r of data || []) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day) continue;
    const kind = normalizeStageSrc(r.src);
    if (!byDay[day]) byDay[day] = { day, total: 0, mail: 0, sms: 0, ig: 0, other: 0, direct: 0 };
    byDay[day].total += 1;
    byDay[day][kind] = (byDay[day][kind] || 0) + 1;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  const total = Object.values(counts).reduce((n, v) => n + v, 0);
  return {
    days: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    total,
    mail: counts.mail,
    sms: counts.sms,
    ig: counts.ig,
    other: counts.other,
    direct: counts.direct,
  };
}

function summarizeSalesRows(orders) {
  const paid = (orders || []).filter(
    (o) => o.payment?.status === 'paid' || ['paid', 'form_pending', 'complete'].includes(o.status)
  );
  const rows = paid.map((o) => ({
    src: o.marketing?.src || 'direct',
    created_at: o.payment?.paid_at || o.updated_at || o.created_at,
    amount_cents: o.amount_cents,
  }));
  const sales = summarizeVisitRows(rows);
  const revenue_cents = paid.reduce((n, o) => n + (Number(o.amount_cents) || 0), 0);
  return { sales, paid_total: paid.length, revenue_cents };
}

async function summarizeStageVacancesVisits(days = 14) {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return emptySummary();
  }
  if (!supabase) return emptySummary();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const [visits, orders] = await Promise.all([
      fetchAllSince(supabase, 'stage_visits', {
        select: 'src,created_at',
        since,
        filters: [(q) => q.eq('status', 'pageview')],
      }),
      fetchAllSince(supabase, 'stage_orders', {
        select: 'status,payment,marketing,amount_cents,created_at,updated_at',
        since,
      }),
    ]);
    const clicks = summarizeVisitRows(visits);
    const { sales, paid_total, revenue_cents } = summarizeSalesRows(orders);
    const conv =
      clicks.total > 0 ? Math.round((1000 * paid_total) / clicks.total) / 10 : paid_total > 0 ? 100 : 0;
    return { clicks, sales, paid_total, revenue_cents, conversion_pct: conv };
  } catch {
    return emptySummary();
  }
}

module.exports = {
  summarizeStageVacancesVisits,
  normalizeStageSrc,
};
