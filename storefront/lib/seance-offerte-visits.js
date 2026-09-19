'use strict';

const { getSupabase } = require('./supabase');

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

/**
 * Supabase plafonne à 1000 lignes par défaut — sans pagination les stats
 * séances offertes « n’avancent plus » une fois le plafond atteint.
 */
async function fetchAllSince(sb, table, { select, filters = [], since, orderCol = 'created_at' } = {}) {
  const out = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let q = sb.from(table).select(select).gte(orderCol, since).order(orderCol, { ascending: true });
    for (const apply of filters) q = apply(q);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

async function summarizeSeanceOfferteVisits(days = 14) {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return emptySummary();
  }
  if (!supabase) return emptySummary();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let visits = [];
  let leads = [];
  try {
    [visits, leads] = await Promise.all([
      fetchAllSince(supabase, 'seance_offerte_leads', {
        select: 'src,created_at',
        since,
        filters: [(q) => q.eq('status', 'pageview')],
      }),
      fetchAllSince(supabase, 'tunnel_leads', {
        select: 'created_at,meta',
        since,
        filters: [(q) => q.eq('tunnel', 'seance_essai')],
      }),
    ]);
  } catch {
    return emptySummary();
  }

  const clicks = summarizeVisitRows(visits);
  const inscriptions = summarizeInscriptionRows(leads);
  return {
    ...clicks,
    clicks,
    inscriptions,
    conversion_pct: conversionPct(clicks.total, inscriptions.total),
  };
}

function emptyBucket() {
  return { days: [], total: 0, flyer: 0, email: 0, whatsapp: 0, sms: 0, other: 0, other_sources: [] };
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
  sms: 'SMS',
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
  if (s === 'sms' || s === 'texto') return 'sms';
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
  let sms = 0;
  let other = 0;
  for (const r of data || []) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { day, total: 0, flyer: 0, email: 0, whatsapp: 0, sms: 0, other: 0 };
    byDay[day].total += 1;
    const kind = classifyVisitSrc(r.src);
    byDay[day][kind] += 1;
    if (kind === 'flyer') flyer += 1;
    else if (kind === 'email') email += 1;
    else if (kind === 'whatsapp') whatsapp += 1;
    else if (kind === 'sms') sms += 1;
    else {
      other += 1;
      const label = visitSourceLabel(r.src);
      otherCounts[label] = (otherCounts[label] || 0) + 1;
    }
  }
  return {
    days: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    total: flyer + email + whatsapp + sms + other,
    flyer,
    email,
    whatsapp,
    sms,
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
  fetchAllSince,
};
