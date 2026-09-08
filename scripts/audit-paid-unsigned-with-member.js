#!/usr/bin/env node
'use strict';
/**
 * Audit récurrent : payé + non signé + fiche Deciplus déjà posée (anomalie type Lina).
 * Ne pas lancer de vente Deciplus sur ces dossiers tant qu'ils ne signent pas.
 *
 *   node scripts/audit-paid-unsigned-with-member.js
 *   node scripts/audit-paid-unsigned-with-member.js --since=2026-08-01
 *   node scripts/audit-paid-unsigned-with-member.js --json
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { isPaidUnsignedWithMember } = require('../storefront/lib/deciplus-sale-reconcile');

const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-01';
const JSON_ONLY = process.argv.includes('--json');
const OUT = path.join(__dirname, '..', 'data', `audit-paid-unsigned-with-member-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function isTest(name, email) {
  return /\btest\b|boxplus-test|@boxplus-test\.local/i.test(`${name} ${email}`);
}

function isMateriel(p) {
  if (/^MAT-/i.test(String(p.order_id || ''))) return true;
  const snap = p.product_snapshot || {};
  return snap.tab === 'materiel' || /materiel/i.test(String(snap.sale_type || ''));
}

function isActionOrder(p) {
  const id = String(p.order_id || '');
  return /^(COACH|CHANGE|VERIFY|CANCEL|rl-)/i.test(id);
}

async function loadRows() {
  const sb = getSupabase();
  const since = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const rows = [];
  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (!/^BC-/i.test(p.order_id)) continue;
    if (isMateriel(p) || isActionOrder(p)) continue;
    if (!isPaidUnsignedWithMember(p)) continue;
    const name = rowName(p);
    const email = p.customer_short?.email || p.customer_full?.email || '';
    if (isTest(name, email)) continue;
    rows.push({
      order_id: p.order_id,
      created_at: r.created_at,
      paid_at: p.payment?.paid_at || null,
      name,
      email,
      gym: p.customer_full?.gym || p.gym || '',
      product: p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || '',
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      bot_error: p.bot_error || null,
    });
  }
  return rows;
}

async function main() {
  const rows = await loadRows();
  const report = {
    at: new Date().toISOString(),
    since: SINCE,
    total: rows.length,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Anomalies payé+non signé+fiche : ${rows.length} (depuis ${SINCE})`);
  if (!rows.length) {
    console.log('Aucun dossier type Lina détecté.');
    console.log('JSON', OUT);
    return;
  }

  console.log('');
  console.log('| Nom | Salle | Membre | Vente | bot_status | Commande |');
  console.log('|-----|-------|--------|-------|------------|----------|');
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${r.gym || '—'} | ${r.member_id || '—'} | ${r.sale_id || '—'} | ${r.bot_status || '—'} | ${r.order_id} |`
    );
  }
  console.log('\nJSON', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
