'use strict';

const { pickBotBase } = require('./bot-forward');
const { getJobId } = require('./normalize');

function botSecret() {
  return process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';
}

function jobIdCandidates(order = {}) {
  const ids = new Set();
  const orderId = String(order.order_id || '').trim();
  if (orderId) {
    ids.add(orderId);
    ids.add(getJobId({ ...order, order_id: orderId, action: order.action || 'sale' }));
    ids.add(getJobId({ ...order, order_id: orderId, action: 'balma_switch' }));
    ids.add(`${orderId}#balma_switch`);
  }
  const jobId = String(order.job_id || '').trim();
  if (jobId) ids.add(jobId);
  return [...ids];
}

function allBotBases(order = {}) {
  const bases = new Set();
  try {
    const primary = pickBotBase(order);
    if (primary) bases.add(primary.replace(/\/$/, ''));
  } catch {
    /* ops URL manquante */
  }
  for (const key of ['BOXPLUS_BOT_URL', 'BOXPLUS_BOT_URL_SALES_2', 'BOXPLUS_BOT_URL_OPS']) {
    const v = String(process.env[key] || '')
      .trim()
      .replace(/\/$/, '');
    if (v) bases.add(v);
  }
  return [...bases];
}

/**
 * Lit le statut traité côté bot (processed-orders.json).
 */
async function fetchBotProcessed(jobId, order = {}) {
  const candidates = jobId ? [String(jobId)] : jobIdCandidates(order);
  for (const id of candidates) {
    const record = await fetchBotProcessedOne(id, order);
    if (record) return record;
  }
  return null;
}

async function fetchBotProcessedOne(jobId, order = {}) {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const secret = botSecret();
  if (!secret) return null;
  const bases = allBotBases(order);
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`, {
        headers: { 'x-sync-secret': secret },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.processed) continue;
      const rec = body.processed;
      if (rec.deciplus_member_id || rec.deciplus_sale_id || rec.status === 'success') {
        return rec;
      }
      // garder un record même sans IDs si aucun autre base n'en a
      if (!rec.deciplus_member_id && !rec.deciplus_sale_id) {
        /* try next base */
        continue;
      }
      return rec;
    } catch {
      /* next base */
    }
  }
  // Second pass : accepter un record sans IDs (au moins le statut)
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`, {
        headers: { 'x-sync-secret': secret },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.processed) return body.processed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function fetchJobActionIds(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;
  try {
    const { getSupabase } = require('../storefront/lib/supabase');
    const sb = getSupabase();
    const { data, error } = await sb
      .from('boxplus_job_actions')
      .select('status, lifecycle_state, member_id, sale_id, error_message, updated_at')
      .eq('order_id', id)
      .eq('action', 'sale')
      .maybeSingle();
    if (error || !data) return null;
    const memberId = data.member_id ? String(data.member_id) : '';
    const saleId = data.sale_id ? String(data.sale_id) : '';
    if (!memberId && !saleId) return null;
    return {
      status: data.status || null,
      deciplus_member_id: memberId || null,
      deciplus_sale_id: saleId || null,
      error: data.error_message || null,
      source: 'job_actions',
    };
  } catch {
    return null;
  }
}

function mapBotStatus(record = {}) {
  const st = String(record.status || '').toLowerCase();
  if (st === 'success') return 'success';
  if (st === 'manual_review') return 'manual_review';
  if (st === 'error' || st === 'rejected') return 'error';
  if (record.deciplus_sale_id || record.sale_id) return 'success';
  return st || null;
}

/**
 * Applique member_id / sale_id depuis le bot (ou job_actions) vers la commande boutique.
 */
async function syncOrderFromBotProcessed(orderId, { applyBotSaleStatus, order = null } = {}) {
  if (!applyBotSaleStatus) {
    ({ applyBotSaleStatus } = require('../storefront/lib/order-lifecycle'));
  }
  let record = await fetchBotProcessed(null, { ...(order || {}), order_id: orderId });
  if (!record || (!record.deciplus_member_id && !record.deciplus_sale_id)) {
    const fromJobs = await fetchJobActionIds(orderId);
    if (fromJobs) {
      record = {
        ...(record || {}),
        ...fromJobs,
        deciplus_member_id: fromJobs.deciplus_member_id || record?.deciplus_member_id || null,
        deciplus_sale_id: fromJobs.deciplus_sale_id || record?.deciplus_sale_id || null,
      };
    }
  }
  if (!record) return { synced: false, reason: 'no_processed_record' };
  const memberId = record.deciplus_member_id ? String(record.deciplus_member_id) : '';
  const saleId = record.deciplus_sale_id ? String(record.deciplus_sale_id) : '';
  if (!memberId && !saleId) {
    return { synced: false, reason: 'no_deciplus_ids', record };
  }
  const updated = await applyBotSaleStatus(orderId, {
    status: mapBotStatus(record),
    deciplus_member_id: memberId || undefined,
    deciplus_sale_id: saleId || undefined,
    error: record.error || null,
  });
  return {
    synced: Boolean(updated),
    order_id: orderId,
    deciplus_member_id: memberId || null,
    deciplus_sale_id: saleId || null,
    bot_status: mapBotStatus(record),
    source: record.source || 'bot_processed',
  };
}

module.exports = {
  fetchBotProcessed,
  syncOrderFromBotProcessed,
  mapBotStatus,
  allBotBases,
};
