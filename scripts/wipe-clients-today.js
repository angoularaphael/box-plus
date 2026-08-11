#!/usr/bin/env node
/**
 * Liste (dry-run) ou purge les clients / commandes créés « aujourd’hui » (Europe/Paris).
 *
 * Usage:
 *   node scripts/wipe-clients-today.js
 *   node scripts/wipe-clients-today.js --execute
 *
 * Ne supprime rien sans --execute. Après dry-run, valider la liste puis relancer avec --execute.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');
const { getSupabase } = require('../storefront/lib/supabase');

const EXECUTE = process.argv.includes('--execute');
const TZ = 'Europe/Paris';

function parisDayKey(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoDay(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return parisDayKey(d);
}

function orderEmail(payload) {
  return (
    payload?.customer_short?.email ||
    payload?.customer?.email ||
    payload?.email ||
    ''
  )
    .trim()
    .toLowerCase();
}

function orderCreatedAt(payload) {
  return payload?.created_at || payload?.updated_at || payload?.signature?.signed_at || null;
}

function scanLocalOrders(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { file: path.join(dir, f), payload };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function listRemote(sb, today) {
  const report = { clients: [], inscriptions: [], materiel: [] };

  const { data: clients, error: clientErr } = await sb
    .from('portet_clients')
    .select('id, email, prenom, nom, source, created_at, salle')
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59.999`);
  if (clientErr) {
    // fallback sans filtre serveur strict (timezone)
    const { data: all, error } = await sb
      .from('portet_clients')
      .select('id, email, prenom, nom, source, created_at, salle')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    report.clients = (all || []).filter((r) => isoDay(r.created_at) === today);
  } else {
    report.clients = (clients || []).filter((r) => isoDay(r.created_at) === today);
  }

  const { data: inscRows, error: inscErr } = await sb
    .from('boxplus_orders')
    .select('order_id, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (inscErr) throw inscErr;
  for (const row of inscRows || []) {
    const created = row.created_at || orderCreatedAt(row.payload);
    if (isoDay(created) !== today) continue;
    report.inscriptions.push({
      order_id: row.order_id,
      email: orderEmail(row.payload),
      created_at: created,
      name: `${row.payload?.customer_short?.first_name || ''} ${row.payload?.customer_short?.last_name || ''}`.trim(),
    });
  }

  const { data: matRows, error: matErr } = await sb
    .from('boxplus_materiel_orders')
    .select('order_id, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!matErr) {
    for (const row of matRows || []) {
      const created = row.created_at || orderCreatedAt(row.payload);
      if (isoDay(created) !== today) continue;
      report.materiel.push({
        order_id: row.order_id,
        email: orderEmail(row.payload),
        created_at: created,
      });
    }
  }

  return report;
}

async function deleteRemote(sb, report) {
  for (const c of report.clients) {
    const { error } = await sb.from('portet_clients').delete().eq('id', c.id);
    if (error) throw error;
  }
  for (const o of report.inscriptions) {
    const { error } = await sb.from('boxplus_orders').delete().eq('order_id', o.order_id);
    if (error) throw error;
  }
  for (const o of report.materiel) {
    const { error } = await sb.from('boxplus_materiel_orders').delete().eq('order_id', o.order_id);
    if (error) throw error;
  }
}

function listLocal(today) {
  const dirs = [
    path.join(ROOT, 'data', 'storefront', 'orders'),
    path.join(ROOT, 'data', 'storefront', 'materiel-orders'),
  ];
  const found = [];
  for (const dir of dirs) {
    for (const { file, payload } of scanLocalOrders(dir)) {
      const created = orderCreatedAt(payload);
      if (isoDay(created) !== today) continue;
      found.push({
        file,
        order_id: payload.order_id,
        email: orderEmail(payload),
        created_at: created,
      });
    }
  }
  return found;
}

(async () => {
  const today = parisDayKey();
  console.log(`\n=== Wipe clients du jour (${today} ${TZ}) — ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} ===\n`);

  let remote = { clients: [], inscriptions: [], materiel: [] };
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = getSupabase();
    remote = await listRemote(sb, today);
    if (EXECUTE) await deleteRemote(sb, remote);
  } else {
    console.log('Supabase non configuré — skip remote (définir SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)\n');
  }

  const local = listLocal(today);
  if (EXECUTE) {
    for (const row of local) {
      if (fs.existsSync(row.file)) fs.unlinkSync(row.file);
    }
  }

  console.log(`portet_clients (${remote.clients.length})`);
  for (const c of remote.clients) {
    console.log(
      `  - ${c.id} | ${c.prenom || ''} ${c.nom || ''} | ${c.email || '—'} | ${c.source || ''} | ${c.created_at || ''}`
    );
  }
  console.log(`\nboxplus_orders (${remote.inscriptions.length})`);
  for (const o of remote.inscriptions) {
    console.log(`  - ${o.order_id} | ${o.name || ''} | ${o.email || '—'} | ${o.created_at || ''}`);
  }
  console.log(`\nboxplus_materiel_orders (${remote.materiel.length})`);
  for (const o of remote.materiel) {
    console.log(`  - ${o.order_id} | ${o.email || '—'} | ${o.created_at || ''}`);
  }
  console.log(`\nLocal files (${local.length})`);
  for (const o of local) {
    console.log(`  - ${o.file} | ${o.email || '—'} | ${o.created_at || ''}`);
  }

  const total =
    remote.clients.length + remote.inscriptions.length + remote.materiel.length + local.length;
  console.log(`\nTotal: ${total} élément(s).`);
  if (!EXECUTE) {
    console.log('Dry-run uniquement. Relancer avec --execute après validation de la liste.\n');
  } else {
    console.log('Suppression effectuée.\n');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
