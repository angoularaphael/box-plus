#!/usr/bin/env node
/**
 * Supprime commandes BOXPLUS + fiche client gestion-manager pour un email.
 *
 * Usage:
 *   node scripts/purge-order-by-email.js kenisi9524@disiok.com
 *   node scripts/purge-order-by-email.js kenisi9524@disiok.com --execute
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');
const { getSupabase } = require('../storefront/lib/supabase');

const EMAIL = (process.argv[2] || '').trim().toLowerCase();
const EXECUTE = process.argv.includes('--execute');

function orderEmail(payload) {
  return (
    payload?.customer_short?.email ||
    payload?.customer?.email ||
    payload?.customer?.email ||
    ''
  )
    .trim()
    .toLowerCase();
}

function scanLocalOrders(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function purgeRemote(sb) {
  const report = { clients: [], inscriptions: [], materiel: [] };

  const { data: clients, error: clientErr } = await sb
    .from('portet_clients')
    .select('id, email, prenom, nom')
    .ilike('email', EMAIL);
  if (clientErr) throw clientErr;
  for (const row of clients || []) {
    report.clients.push(row);
    if (EXECUTE) {
      const { error } = await sb.from('portet_clients').delete().eq('id', row.id);
      if (error) throw error;
    }
  }

  const { data: inscRows, error: inscErr } = await sb
    .from('boxplus_orders')
    .select('order_id, payload');
  if (inscErr) throw inscErr;
  for (const row of inscRows || []) {
    if (orderEmail(row.payload) !== EMAIL) continue;
    report.inscriptions.push(row.order_id);
    if (EXECUTE) {
      const { error } = await sb.from('boxplus_orders').delete().eq('order_id', row.order_id);
      if (error) throw error;
    }
  }

  const { data: matRows, error: matErr } = await sb
    .from('boxplus_materiel_orders')
    .select('order_id, payload');
  if (matErr) throw matErr;
  for (const row of matRows || []) {
    if (orderEmail(row.payload) !== EMAIL) continue;
    report.materiel.push(row.order_id);
    if (EXECUTE) {
      const { error } = await sb
        .from('boxplus_materiel_orders')
        .delete()
        .eq('order_id', row.order_id);
      if (error) throw error;
    }
  }

  return report;
}

function purgeLocal() {
  const dirs = [
    path.join(ROOT, 'data', 'storefront', 'orders'),
    path.join(ROOT, 'data', 'storefront', 'materiel-orders'),
    path.join(ROOT, 'data', 'queue'),
  ];
  const removed = [];
  for (const dir of dirs) {
    for (const order of scanLocalOrders(dir)) {
      const email = orderEmail(order) || order.customer?.email;
      if (String(email || '').toLowerCase() !== EMAIL) continue;
      const file = path.join(dir, `${order.order_id || order.job_id}.json`);
      removed.push(file);
      if (EXECUTE && fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  return removed;
}

(async () => {
  if (!EMAIL || !EMAIL.includes('@')) {
    console.error('Usage: node scripts/purge-order-by-email.js email [--execute]');
    process.exit(1);
  }

  console.log(`\n=== Purge BOXPLUS / gestion-manager — ${EMAIL} (${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}) ===\n`);

  let remote = { clients: [], inscriptions: [], materiel: [] };
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    remote = await purgeRemote(getSupabase());
  } else {
    console.log('Supabase non configuré — skip remote');
  }

  const local = purgeLocal();

  console.log('Clients portet_clients:', remote.clients.length || 0);
  for (const c of remote.clients) {
    console.log(`  • ${c.id} — ${c.prenom || ''} ${c.nom || ''}`.trim());
  }
  console.log('Commandes inscription:', remote.inscriptions.length || 0, remote.inscriptions.join(', ') || '—');
  console.log('Commandes matériel:', remote.materiel.length || 0, remote.materiel.join(', ') || '—');
  console.log('Fichiers locaux:', local.length || 0);
  for (const f of local) console.log(`  • ${f}`);

  if (!EXECUTE) {
    console.log('\nDry-run — relancez avec --execute pour supprimer.');
  } else {
    console.log('\nSuppression terminée.');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
