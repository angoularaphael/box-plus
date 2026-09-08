#!/usr/bin/env node
'use strict';
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const { getSupabase } = require('../storefront/lib/supabase');
const { isAventureOrder } = require('../lib/aventure-policy');
const { isBalmaRetourOrder } = require('../lib/balma');

function name(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function gym(p) {
  return String(p.customer_full?.gym || p.gym || p.customer?.gym || '').toLowerCase();
}

(async () => {
  const sb = getSupabase();
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id,created_at,payload')
      .gte('created_at', '2026-08-01T00:00:00.000Z')
      .order('created_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 500) break;
    from += 500;
  }
  const hits = [];
  for (const r of rows) {
    const p = r.payload || {};
    const g = gym(p);
    const av = isAventureOrder(p) || isBalmaRetourOrder(p);
    const why = [];
    if (g === 'etats-unis') why.push('gym_etats_unis');
    if (g === 'balma') why.push('gym_balma');
    if (av) why.push('aventure_balma');
    if (!why.length) continue;
    hits.push({
      order_id: r.order_id,
      created: r.created_at,
      name: name(p),
      gym: g,
      why,
      source: p.source || null,
      aventure: Boolean(p.aventure),
      product: p.product_id || p.product_name || p.product_snapshot?.name || null,
      amount: p.payment?.amount ?? null,
      pay: p.payment?.status || null,
      signed: Boolean(p.signature?.signed_at),
      member: p.deciplus_member_id || null,
      sale: p.deciplus_sale_id || null,
      bot: p.bot_status || null,
      err: String(p.bot_error || '').slice(0, 80) || null,
    });
  }
  const paid = hits.filter((h) => String(h.pay).toLowerCase() === 'paid');
  const byGym = {};
  for (const h of hits) {
    const k = h.gym || '(vide)';
    byGym[k] = (byGym[k] || 0) + 1;
  }
  console.log(
    JSON.stringify(
      {
        total_orders: rows.length,
        cohort: hits.length,
        paid: paid.length,
        signed_paid: paid.filter((h) => h.signed).length,
        by_gym: byGym,
        list: hits,
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
