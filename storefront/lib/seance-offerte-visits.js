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

function leadSrc(row = {}) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return meta.src || meta.source || row.src || '';
}

function isDryRunLead(row = {}) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return Boolean(row.dry_run || meta.dry_run);
}

function toEmailLeadRow(row = {}) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return {
    id: meta.id || row.id,
    prenom: row.prenom || meta.prenom || '',
    nom: row.nom || meta.nom || '',
    salle: meta.salle_label || row.salle || meta.salle || '',
    jour: meta.jour_nom || meta.jour || '',
    visit_date: meta.visit_date || null,
    status: meta.status || row.status || null,
    has_sale: Boolean(meta.has_sale),
    created_at: row.created_at || meta.created_at || null,
  };
}

function summarizeEmailInscriptions(leads, visitSummary = {}) {
  const real = (leads || []).filter((row) => row && !isDryRunLead(row));
  const emailLeads = real.filter((row) => classifyVisitSrc(leadSrc(row)) === 'email');
  const clicks = Number(visitSummary.email || 0);
  const inscribed = emailLeads.length;
  return {
    total: real.length,
    email: inscribed,
    other: real.length - inscribed,
    just_clicked: Math.max(0, clicks - inscribed),
    conversion_pct: clicks ? Math.round((inscribed / clicks) * 1000) / 10 : 0,
    leads: emailLeads
      .map(toEmailLeadRow)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
  };
}

async function loadSeanceEssaiLeads() {
  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return [];
  }
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('tunnel_leads')
    .select('id,prenom,nom,email,salle,created_at,meta')
    .eq('tunnel', 'seance_essai')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function summarizeSeanceOfferteFunnel(days = 14) {
  const visits = await summarizeSeanceOfferteVisits(days);
  const leads = await loadSeanceEssaiLeads();
  return {
    ...visits,
    inscriptions: summarizeEmailInscriptions(leads, visits),
  };
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
  summarizeSeanceOfferteFunnel,
  summarizeEmailInscriptions,
  classifyVisitSrc,
  summarizeVisitRows,
  visitSourceLabel,
  leadSrc,
};
