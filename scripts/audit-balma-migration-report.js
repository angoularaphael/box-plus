#!/usr/bin/env node
'use strict';
/**
 * Rapport Supabase : cohorte Balma / États-Unis, risques migration, EN ATTENTE.
 *   node scripts/audit-balma-migration-report.js
 *   node scripts/audit-balma-migration-report.js --since=2026-08-01
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { isAventureOrder } = require('../lib/aventure-policy');
const { isBalmaRetourOrder } = require('../lib/balma');
const { isOffre29Product } = require('../lib/sale-contract-match');

const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-01';
const OUT = path.join(__dirname, '..', 'data', `audit-balma-migration-report-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function orderGym(p) {
  return String(p.customer_full?.gym || p.gym || p.customer?.gym || '').toLowerCase();
}

function isCohort(p) {
  const g = orderGym(p);
  return g === 'etats-unis' || g === 'balma' || isAventureOrder(p) || isBalmaRetourOrder(p);
}

function productLabel(p) {
  return p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || p.product_id || '';
}

(async () => {
  const sb = getSupabase();
  const sinceIso = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, payload, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const paid = [];
  const cohort = [];
  const legacyBalmaRisk = [];
  const manualReview = [];
  const offre29EtatsUnis = [];

  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (!/^BC-/i.test(p.order_id)) continue;
    const pay = String(p.payment?.status || '').toLowerCase();
    if (pay !== 'paid') continue;

    const item = {
      order_id: p.order_id,
      name: rowName(p),
      gym: orderGym(p),
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      product: productLabel(p),
      bot_status: p.bot_status || null,
      created_at: r.created_at,
    };
    paid.push(item);

    if (!isCohort(p)) continue;
    cohort.push(item);

    const mid = Number(p.deciplus_member_id || 0);
    if (mid > 0 && mid < 15000 && (item.gym === 'etats-unis' || item.gym === 'balma')) {
      legacyBalmaRisk.push(item);
    }
    if (String(p.bot_status || '').toLowerCase() === 'manual_review') {
      manualReview.push(item);
    }
    if (item.gym === 'etats-unis' && isOffre29Product({
      id: p.product_id || p.product_snapshot?.id,
      name: p.product_snapshot?.name || p.product_name,
      display_name: p.product_snapshot?.display_name,
    })) {
      offre29EtatsUnis.push(item);
    }
  }

  const report = {
    at: new Date().toISOString(),
    since: SINCE,
    totals: {
      commandes_payees: paid.length,
      cohorte_balma_etats_unis: cohort.length,
      risque_ancien_membre_balma: legacyBalmaRisk.length,
      manual_review: manualReview.length,
      offre29_etats_unis: offre29EtatsUnis.length,
    },
    legacy_balma_risk: legacyBalmaRisk,
    manual_review: manualReview,
    offre29_etats_unis: offre29EtatsUnis,
    by_gym: cohort.reduce((acc, x) => {
      acc[x.gym] = (acc[x.gym] || 0) + 1;
      return acc;
    }, {}),
    by_bot_status: cohort.reduce((acc, x) => {
      const k = x.bot_status || 'null';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ file: OUT, totals: report.totals }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
