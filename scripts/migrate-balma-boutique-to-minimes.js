#!/usr/bin/env node
'use strict';
/**
 * Fiches encore sur Balma (zone 1) avec un contrat actif,
 * et un abonnement payé via la boutique
 * → Minimes (zone 2) uniquement.
 *
 * Jamais l'inverse : la destination est figée sur idz=2.
 *
 *   node scripts/migrate-balma-boutique-to-minimes.js --check
 *   node scripts/migrate-balma-boutique-to-minimes.js
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { isCartePrestationOrder } = require('../lib/catalog-sale');
const { login, getAccessToken, gotoDeciplus } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');

const CHECK = process.argv.includes('--check');
const ONLY = new Set(
  (process.argv.find((arg) => arg.startsWith('--ids=')) || '')
    .slice(6)
    .split(',')
    .map((id) => id.replace(/\D/g, ''))
    .filter(Boolean)
);
const ZONE_BALMA = '1';
const ZONE_MINIMES = '2';
const OUT = path.join(__dirname, '..', 'data', `migrate-balma-boutique-${Date.now()}.json`);
const LOG = path.join(__dirname, '..', 'data', 'migrate-balma-boutique.log');

if (ZONE_BALMA !== '1' || ZONE_MINIMES !== '2') {
  throw new Error('Direction interdite : seule Balma (1) vers Minimes (2) est autorisée');
}

function logLine(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.log(line);
  try {
    fs.appendFileSync(LOG, `${line}\n`);
  } catch {
    /* disk */
  }
}

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameKey(first, last) {
  return fold(`${first || ''} ${last || ''}`);
}

function dayKey(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function apiHeaders(token) {
  return {
    'x-access-token': token,
    'Deciplus-Client-Type': 'manager',
    Accept: 'application/json',
  };
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

function isBoutiqueSubscription(order) {
  const status = String(order.payment?.status || '').toLowerCase();
  if (status !== 'paid') return false;
  if (!/^BC-/i.test(String(order.order_id || ''))) return false;
  const email = String(order.customer_short?.email || order.customer_full?.email || order.customer?.email || '');
  if (/boxplus-test\.local|example\.com/i.test(email)) return false;
  const snap = order.product_snapshot || {};
  const id = String(order.product_id || snap.id || snap.legacy_id || '').toLowerCase();
  const name = String(snap.display_name || snap.name || order.product_name || '');
  const category = String(snap.category || order.category || '');
  const saleType = String(order.sale_type || snap.sale_type || '').toLowerCase();
  if (isCartePrestationOrder(order)) return false;
  if (saleType === 'materiel' || saleType === 'none') return false;
  if (id === 'badge' || id === 'association') return false;
  if (/\bbadge\b/i.test(name) && !/offre|abo|29|259|saison/i.test(name)) return false;
  if (/^materiel|textile|equipement/i.test(category)) return false;
  if (category === 'Abonnements' || saleType === 'abonnement') return true;
  return /offre|abo|saison|boxe educative|baby boxe|training camp|cours illimit|comptant/i.test(`${id} ${name}`);
}

async function loadBoutiqueSubscriptions() {
  const sb = getSupabase();
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, payload, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 500) break;
    from += 500;
  }

  const byMember = new Map();
  for (const row of rows) {
    const payload = row.payload || {};
    payload.order_id = payload.order_id || row.order_id;
    if (!isBoutiqueSubscription(payload)) continue;
    const cs = payload.customer_short || {};
    const cf = payload.customer_full || {};
    const first = cs.first_name || cf.first_name || payload.customer?.first_name || '';
    const last = cs.last_name || cf.last_name || payload.customer?.last_name || '';
    const item = {
      order_id: payload.order_id,
      first_name: first,
      last_name: last,
      email: cs.email || cf.email || '',
      birthdate: dayKey(cf.birthdate || cf.birth_date || cf.dob || payload.customer?.birthdate),
      member_id: String(payload.deciplus_member_id || '').replace(/\D/g, '') || null,
      product: String(payload.product_snapshot?.display_name || payload.product_snapshot?.name || payload.product_name || '').slice(0, 80),
      created_at: row.created_at,
    };
    const key = item.member_id || nameKey(first, last) || item.order_id;
    const prev = byMember.get(key);
    if (!prev || String(row.created_at) > String(prev.created_at)) byMember.set(key, item);
  }
  return [...byMember.values()];
}

async function listBalmaMembers(page, headers) {
  const all = [];
  const seen = new Set();
  let expected = null;
  for (let pageNo = 1; pageNo <= 400; pageNo += 1) {
    const res = await page.context().request.get(
      `https://api.deciplus.pro/staff/v1/members?zoneId=${ZONE_BALMA}&page=${pageNo}&perPage=100`,
      { headers, timeout: 30000 }
    );
    const body = await readJson(res);
    if (res.status() !== 200) {
      throw new Error(`Liste Balma page ${pageNo} HTTP ${res.status()}`);
    }
    const rows = body.response?.rows || [];
    expected = Number(body.response?.count ?? expected ?? 0);
    if (!rows.length) break;
    let added = 0;
    for (const row of rows) {
      if (String(row.zone) !== ZONE_BALMA) continue;
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push({
        id,
        first_name: row.name || '',
        last_name: row.surname || '',
        birthdate: dayKey(row.birthdate),
      });
      added += 1;
    }
    logLine('liste Balma', `page=${pageNo}`, `lignes=${rows.length}`, `ajout=${added}`, `total=${all.length}`, `annonce=${expected}`);
    if (added === 0) break;
    if (expected && all.length >= expected) break;
  }
  return all;
}

function matchBalmaToBoutique(members, orders) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const byName = new Map();
  for (const member of members) {
    const key = nameKey(member.first_name, member.last_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(member);
  }

  const chosen = new Map();
  const ambiguous = [];
  for (const order of orders) {
    if (order.member_id && byId.has(order.member_id)) {
      chosen.set(order.member_id, { member: byId.get(order.member_id), order, via: 'member_id' });
      continue;
    }
    const key = nameKey(order.first_name, order.last_name);
    const hits = byName.get(key) || [];
    let pool = hits;
    if (order.birthdate) {
      const dated = hits.filter((hit) => hit.birthdate && hit.birthdate === order.birthdate);
      pool = dated;
    } else if (order.member_id || hits.length !== 1) {
      pool = [];
    }
    if (pool.length === 1) {
      const via = order.member_id ? 'nom_date_autre_fiche' : 'nom';
      const prev = chosen.get(pool[0].id);
      if (!prev) chosen.set(pool[0].id, { member: pool[0], order, via });
      continue;
    }
    if (hits.length > 1) {
      ambiguous.push({
        order_id: order.order_id,
        name: `${order.first_name} ${order.last_name}`.trim(),
        member_id: order.member_id,
        balma_ids: hits.map((hit) => hit.id),
      });
    }
  }
  return { chosen: [...chosen.values()], ambiguous };
}

function activeContracts(payload) {
  const groups = Array.isArray(payload) ? payload : payload?.response || payload?.contracts || [];
  const list = Array.isArray(groups) ? groups : [];
  const active = [];
  for (const group of list) {
    const kind = String(group?.group || group?.type || '').toLowerCase();
    const contracts = Array.isArray(group?.contracts) ? group.contracts : Array.isArray(group) ? group : [];
    for (const contract of contracts) {
      const state = String(contract?.state || '').toUpperCase();
      const title = String(contract?.product?.title || contract?.title || '');
      const isBadge = kind === 'badge' || /\bbadge\b/i.test(title);
      if (isBadge) continue;
      if (state !== 'ACTIVE') continue;
      active.push({
        id: contract.id || null,
        ref: contract.contractNumber || contract.ref || null,
        title: title.slice(0, 120),
        state,
      });
    }
  }
  return active;
}

async function fetchContracts(page, headers, memberId) {
  const url = `https://api.deciplus.pro/staff/v1/member/${memberId}/contracts`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await page.context().request.get(url, { headers, timeout: 20000 });
    if (res.status() === 429 || res.status() >= 500) {
      await page.waitForTimeout(400 * attempt);
      continue;
    }
    const body = await readJson(res);
    return { status: res.status(), active: res.status() === 200 ? activeContracts(body) : [] };
  }
  return { status: 0, active: [] };
}

async function readZone(page, headers, memberId) {
  const res = await page.context().request.get(
    `https://api.deciplus.pro/staff/v1/member/${memberId}`,
    { headers, timeout: 20000 }
  );
  const body = await readJson(res);
  const root = body.response || body;
  return {
    status: res.status(),
    zone: root.zoneId ?? root.zone ?? null,
    first_name: root.name || root.firstName || null,
    last_name: root.surname || root.lastName || null,
    email: root.email || root.mail || null,
  };
}

async function sendBalmaToMinimes(page, memberId) {
  if (ZONE_MINIMES !== '2' || ZONE_BALMA === ZONE_MINIMES) {
    throw new Error('Refus: destination autre que Minimes');
  }
  const url = `https://boxingcenter.deciplus.pro/ajax_membreHandler.php?route=sendToZone&idj=${encodeURIComponent(memberId)}&idz=2`;
  if (!url.endsWith('idz=2') || url.includes('idz=1')) {
    throw new Error('Refus: URL de migration invalide');
  }
  const res = await page.context().request.get(url, { timeout: 20000 });
  const body = await readJson(res);
  const message = Array.isArray(body.message) ? body.message.map((m) => m.label).filter(Boolean).join(', ') : '';
  return {
    http: res.status(),
    ok: res.status() === 200 && Number(body.ret) === 0,
    ret: body.ret ?? null,
    message: message.slice(0, 180),
    direction: 'Balma zone 1 vers Minimes zone 2',
  };
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  const orders = await loadBoutiqueSubscriptions();
  logLine('abonnements boutique', String(orders.length));
  const report = {
    mode: CHECK ? 'check' : 'apply',
    direction: 'Balma zone 1 vers Minimes zone 2',
    zone_from: ZONE_BALMA,
    zone_to: ZONE_MINIMES,
    started_at: new Date().toISOString(),
    boutique_subscriptions: orders.length,
    balma_count: 0,
    matched: 0,
    with_active_contract: 0,
    migrated: 0,
    already_minimes: 0,
    skipped_no_contract: 0,
    failed: 0,
    ambiguous: [],
    results: [],
  };

  await runWithSession('migrate-balma-boutique', async (page) => {
    await gotoDeciplus(page, 'nextgen/home').catch(() => {});
    let token = await getAccessToken(page);
    if (!token) {
      await login(page, { siteLabel: 'Minimes' });
      token = await getAccessToken(page);
    }
    if (!token) throw new Error('Token Deciplus introuvable');
    const headers = apiHeaders(token);
    let members = [];
    let chosen = [];
    let ambiguous = [];
    if (ONLY.size) {
      members = [...ONLY].map((id) => ({ id, first_name: '', last_name: '', birthdate: '' }));
      chosen = orders
        .filter((order) => order.member_id && ONLY.has(order.member_id))
        .map((order) => ({
          member: { id: order.member_id, first_name: order.first_name, last_name: order.last_name, birthdate: order.birthdate },
          order,
          via: 'member_id',
        }));
      logLine('cible imposee', [...ONLY].join(','), 'abonnements lies', String(chosen.length));
    } else {
      members = await listBalmaMembers(page, headers);
      const matched = matchBalmaToBoutique(members, orders);
      chosen = matched.chosen;
      ambiguous = matched.ambiguous;
    }
    report.balma_count = members.length;
    report.matched = chosen.length;
    report.ambiguous = ambiguous;
    logLine('fiches Balma', String(members.length), 'correspondances boutique', String(chosen.length), 'ambigues', String(ambiguous.length));

    for (const hit of chosen) {
      const member = hit.member;
      const item = {
        member_id: member.id,
        name: `${member.first_name} ${member.last_name}`.trim(),
        via: hit.via,
        order_id: hit.order.order_id,
        product: hit.order.product,
        order_member_id: hit.order.member_id,
      };
      const live = await readZone(page, headers, member.id);
      item.zone_before = live.zone;
      if (String(live.zone) === ZONE_MINIMES) {
        item.status = 'already_minimes';
        report.already_minimes += 1;
        report.results.push(item);
        logLine('deja Minimes, aucun mouvement', item.member_id, item.name);
        continue;
      }
      if (String(live.zone) !== ZONE_BALMA) {
        item.status = 'skip_not_balma';
        report.results.push(item);
        logLine('pas sur Balma, ignore', item.member_id, item.name, 'zone', String(live.zone));
        continue;
      }
      if (hit.order.email && live.email && fold(hit.order.email) !== fold(live.email)) {
        item.status = 'skip_email_mismatch';
        report.results.push(item);
        logLine('email different, ignore', item.member_id, item.name);
        continue;
      }
      const contracts = await fetchContracts(page, headers, member.id);
      item.contracts_http = contracts.status;
      item.active = contracts.active;
      if (contracts.status !== 200) {
        item.status = 'contracts_error';
        report.failed += 1;
        report.results.push(item);
        logLine('erreur contrats', item.member_id, item.name, String(contracts.status));
        continue;
      }
      if (!contracts.active.length) {
        item.status = 'skip_no_active_contract';
        report.skipped_no_contract += 1;
        report.results.push(item);
        continue;
      }
      report.with_active_contract += 1;
      const label = contracts.active.map((c) => c.title || c.ref).filter(Boolean).join(' | ');
      if (CHECK) {
        item.status = 'would_migrate_balma_to_minimes';
        report.results.push(item);
        logLine('actif Balma vers Minimes', item.member_id, item.name, hit.via, label);
        continue;
      }

      item.migrate = await sendBalmaToMinimes(page, member.id);
      const after = await readZone(page, headers, member.id);
      item.zone_after = after.zone;
      if (String(after.zone) === ZONE_BALMA) {
        item.status = 'migrate_failed_still_balma';
        report.failed += 1;
        logLine('echec reste Balma', item.member_id, item.name, item.migrate?.message || '');
      } else if (String(after.zone) === ZONE_MINIMES) {
        item.status = 'migrated_balma_to_minimes';
        report.migrated += 1;
        logLine('migre Balma vers Minimes', item.member_id, item.name, label);
      } else {
        item.status = 'migrate_failed_unexpected_zone';
        report.failed += 1;
        logLine('echec zone inattendue', item.member_id, item.name, 'zone', String(after.zone));
      }
      report.results.push(item);
    }
  });

  report.finished_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  logLine(
    'bilan',
    `balma=${report.balma_count}`,
    `boutique=${report.boutique_subscriptions}`,
    `correspondances=${report.matched}`,
    `actifs=${report.with_active_contract}`,
    `migres_vers_minimes=${report.migrated}`,
    `deja_minimes=${report.already_minimes}`,
    `sans_contrat=${report.skipped_no_contract}`,
    `echecs=${report.failed}`,
    OUT
  );
  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
