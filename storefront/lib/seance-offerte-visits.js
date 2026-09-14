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
  const { data, error } = await supabase
    .from('seance_offerte_leads')
    .select('src,created_at')
    .eq('status', 'pageview')
    .gte('created_at', since);
  if (error || !Array.isArray(data)) return emptySummary();
  return summarizeVisitRows(data);
}

function emptySummary() {
  return { days: [], total: 0, flyer: 0, email: 0, other: 0, other_sources: [] };
}

const SOURCE_LABELS = {
  flyer: 'Flyer QR',
  affiche: 'Flyer QR',
  email: 'E-mail David',
  mail: 'E-mail David',
  newsletter: 'E-mail David',
  direct: 'Accès direct',
  wa: 'WhatsApp',
  meta: 'Meta',
  story: 'Story Instagram',
  fb: 'Facebook',
  porte: 'Accroche-porte',
  print: 'Support print',
};

function visitSourceLabel(src) {
  const raw = String(src || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (SOURCE_LABELS[raw]) return SOURCE_LABELS[raw];
  if (!raw) return 'Accès direct';
  return raw;
}

function classifyVisitSrc(src) {
  const s = String(src || '').toLowerCase();
  if (s === 'flyer' || s === 'affiche') return 'flyer';
  if (s === 'email' || s === 'mail' || s === 'newsletter') return 'email';
  return 'other';
}

function summarizeVisitRows(data) {
  const byDay = {};
  const otherCounts = {};
  let flyer = 0;
  let email = 0;
  let other = 0;
  for (const r of data || []) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { day, total: 0, flyer: 0, email: 0, other: 0 };
    byDay[day].total += 1;
    const kind = classifyVisitSrc(r.src);
    byDay[day][kind] += 1;
    if (kind === 'flyer') flyer += 1;
    else if (kind === 'email') email += 1;
    else {
      other += 1;
      const label = visitSourceLabel(r.src);
      otherCounts[label] = (otherCounts[label] || 0) + 1;
    }
  }
  return {
    days: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    total: flyer + email + other,
    flyer,
    email,
    other,
    other_sources: Object.entries(otherCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

module.exports = {
  summarizeSeanceOfferteVisits,
  classifyVisitSrc,
  summarizeVisitRows,
  visitSourceLabel,
};
