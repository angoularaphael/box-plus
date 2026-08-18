'use strict';

const { getSupabase } = require('./supabase');

async function summarizeSeanceOfferteVisits(days = 14) {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return { days: [], total: 0, flyer: 0, other: 0 };
  }
  if (!supabase) return { days: [], total: 0, flyer: 0, other: 0 };
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('seance_offerte_leads')
    .select('src,created_at')
    .eq('status', 'pageview')
    .gte('created_at', since);
  if (error || !Array.isArray(data)) return { days: [], total: 0, flyer: 0, other: 0 };
  const byDay = {};
  let flyer = 0;
  let other = 0;
  for (const r of data) {
    const day = String(r.created_at || '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { day, total: 0, flyer: 0, other: 0 };
    byDay[day].total += 1;
    if (r.src === 'flyer') {
      byDay[day].flyer += 1;
      flyer += 1;
    } else {
      byDay[day].other += 1;
      other += 1;
    }
  }
  return {
    days: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    total: flyer + other,
    flyer,
    other,
  };
}

module.exports = { summarizeSeanceOfferteVisits };
