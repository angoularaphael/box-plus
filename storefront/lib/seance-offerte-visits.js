'use strict';

const { getSupabase } = require('./supabase');

async function summarizeSeanceOfferteVisits(days = 14) {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return emptySummary();
  }
  if (!supabase) return emptySummary();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [visitsRes, leadsRes] = await Promise.all([
    supabase
      .from('seance_offerte_leads')
      .select('src,created_at')
      .eq('status', 'pageview')
      .gte('created_at', since),
    supabase
      .from('tunnel_leads')
      .select('created_at,meta')
      .eq('tunnel', 'seance_essai')
      .gte('created_at', since),
  ]);

  const clicks = summarizeVisitRows(visitsRes.error ? [] : visitsRes.data);
  const inscriptions = summarizeInscriptionRows(leadsRes.error ? [] : leadsRes.data);
  return {
    ...clicks,
    clicks,
    inscriptions,
    conversion_pct: conversionPct(clicks.total, inscriptions.total),
  };
}

function emptyBucket() {
  return { days: [], total: 0, flyer: 0, email: 0, whatsapp: 0, other: 0, other_sources: [] };
}

function emptySummary() {
  const clicks = emptyBucket();
  const inscriptions = emptyBucket();
  return {
    ...clicks,
    clicks,
    inscriptions,
    conversion_pct: 0,
  };
}

const SOURCE_LABELS = {
  flyer: 'Flyer QR',
  affiche: 'Flyer QR',
  email: 'E-mail David',
  mail: 'E-mail David',
  newsletter: 'E-mail David',
  whatsapp: 'WhatsApp',
  wa: 'WhatsApp',
  direct: 'Accès direct',
  meta: 'Meta',
  story: 'Story Instagram',
  fb: 'Facebook',
  porte: 'Accroche-porte',
  print: 'Support print',
};

function visitSourceLabel(src) {
  const raw = String(src || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (SOURCE_LABELS[raw]) return SOURCE_LABELS[raw];
  if (!raw) return 'Accès direct';
  return raw;
}

function classifyVisitSrc(src) {
  const s = String(src || '').toLowerCase();
  if (s === 'flyer' || s === 'affiche' || s === 'qr') return 'flyer';
  if (s === 'email' || s === 'mail' || s === 'newsletter') return 'email';
  if (s === 'whatsapp' || s === 'wa') return 'whatsapp';
  return 'other';
}

function campaignSrcOf(row = {}) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return row.utm?.source || row.utm_source || row.src || meta.src || meta.source || '';
}

function summarizeVisitRows(data) {
  const byDay = {};
  const otherCounts = {};
  let flyer = 0;
  let email = 0;
  let whatsapp = 0;
  let other = 0;
  for (const r of data || []) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { day, total: 0, flyer: 0, email: 0, whatsapp: 0, other: 0 };
    byDay[day].total += 1;
    const kind = classifyVisitSrc(r.src);
    byDay[day][kind] += 1;
    if (kind === 'flyer') flyer += 1;
    else if (kind === 'email') email += 1;
    else if (kind === 'whatsapp') whatsapp += 1;
    else {
      other += 1;
      const label = visitSourceLabel(r.src);
      otherCounts[label] = (otherCounts[label] || 0) + 1;
    }
  }
  return {
    days: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    total: flyer + email + whatsapp + other,
    flyer,
    email,
    whatsapp,
    other,
    other_sources: Object.entries(otherCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

function summarizeInscriptionRows(data) {
  return summarizeVisitRows(
    (data || []).map((row) => ({
      src: campaignSrcOf(row),
      created_at: row.created_at,
    }))
  );
}

function conversionPct(clicks, inscriptions) {
  const c = Number(clicks) || 0;
  const n = Number(inscriptions) || 0;
  if (c <= 0) return n > 0 ? 100 : 0;
  return Math.round((1000 * n) / c) / 10;
}

module.exports = {
  summarizeSeanceOfferteVisits,
  classifyVisitSrc,
  summarizeVisitRows,
  summarizeInscriptionRows,
  campaignSrcOf,
  visitSourceLabel,
  conversionPct,
};
