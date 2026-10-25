#!/usr/bin/env node
'use strict';
/**
 * Fiches encore sur Balma (zone 1) ou Etats-Unis (zone 7)
 * avec un contrat d'abonnement ACTIF (pas seulement boutique)
 * → Minimes (zone 2).
 *
 * Balma : uniquement les contrats commencés depuis --since (défaut 2026-08-01),
 * pour ne pas déplacer d'anciens adhérents Balma.
 * Etats-Unis : tous les contrats actifs (salle fermée, peu de fiches).
 *
 *   node scripts/migrate-zone-actives-to-minimes.js --check --chrome
 *   node scripts/migrate-zone-actives-to-minimes.js --chrome
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
const HEADED = process.argv.includes('--chrome') || process.argv.includes('--headed');
process.env.DECIPLUS_HEADLESS = HEADED ? 'false' : 'true';
if (HEADED) {
  process.env.DECIPLUS_BROWSER_CHANNEL = process.env.DECIPLUS_BROWSER_CHANNEL || 'chrome';
  process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '50';
}
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { login, getAccessToken, gotoDeciplus } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');

const CHECK = process.argv.includes('--check');
const SINCE = (process.argv.find((arg) => arg.startsWith('--since=')) || '').slice(8) || '2026-08-01';
const CONCURRENCY = Math.max(1, Number(process.env.MIGRATE_CONTRACT_CONCURRENCY || 8));
const SOURCE_ZONES = [
  { id: '1', label: 'Balma' },
  { id: '7', label: 'Etats-Unis' },
];
const ZONE_MINIMES = '2';
const OUT = path.join(__dirname, '..', 'data', `migrate-zone-actives-${Date.now()}.json`);
const LOG = path.join(__dirname, '..', 'data', 'migrate-zone-actives.log');

if (ZONE_MINIMES !== '2' || SOURCE_ZONES.some((zone) => zone.id === ZONE_MINIMES)) {
  throw new Error('Direction interdite : seule Balma (1) ou Etats-Unis (7) vers Minimes (2)');
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

function dayKey(value) {
  const raw = String(value || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}

function isTestName(first, last) {
  return /\btest\b/i.test(`${first || ''} ${last || ''}`);
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

async function listZoneMembers(page, headers, zone) {
  const all = [];
  const seen = new Set();
  let expected = null;
  let sampleKeys = null;
  for (let pageNo = 1; pageNo <= 400; pageNo += 1) {
    const res = await page.context().request.get(
      `https://api.deciplus.pro/staff/v1/members?zoneId=${zone.id}&page=${pageNo}&perPage=100`,
      { headers, timeout: 30000 }
    );
    const body = await readJson(res);
    if (res.status() !== 200) {
      throw new Error(`Liste ${zone.label} page ${pageNo} HTTP ${res.status()}`);
    }
    const rows = body.response?.rows || [];
    expected = Number(body.response?.count ?? expected ?? 0);
    if (!rows.length) break;
    if (!sampleKeys && rows[0]) {
      sampleKeys = Object.keys(rows[0]);
      logLine(`champs liste ${zone.label}`, sampleKeys.join(','));
    }
    let added = 0;
    for (const row of rows) {
      if (String(row.zone) !== zone.id) continue;
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push({
        id,
        first_name: row.name || '',
        last_name: row.surname || '',
        birthdate: dayKey(row.birthdate),
        source_zone: zone.id,
        source_label: zone.label,
        created: dayKey(row.createdAt || row.created_at || row.creationDate || row.dateCreation),
      });
      added += 1;
    }
    logLine(
      `liste ${zone.label}`,
      `page=${pageNo}`,
      `lignes=${rows.length}`,
      `ajout=${added}`,
      `total=${all.length}`,
      `annonce=${expected}`
    );
    if (added === 0) break;
    if (expected && all.length >= expected) break;
  }
  return all;
}

function contractBegin(contract) {
  return (
    dayKey(contract.begin) ||
    dayKey(contract.beginDate) ||
    dayKey(contract.start) ||
    dayKey(contract.startDate) ||
    dayKey(contract.from) ||
    dayKey(contract.soldAt) ||
    dayKey(contract.saleDate)
  );
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
        begin: contractBegin(contract) || contractBegin(contract.product || {}),
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

async function sendToMinimes(page, memberId, sourceLabel) {
  if (ZONE_MINIMES !== '2') {
    throw new Error('Refus: destination autre que Minimes');
  }
  const url = `https://boxingcenter.deciplus.pro/ajax_membreHandler.php?route=sendToZone&idj=${encodeURIComponent(memberId)}&idz=2`;
  if (!url.endsWith('idz=2') || /idz=(1|7)(?:&|$)/.test(url)) {
    throw new Error('Refus: URL de migration invalide');
  }
  const res = await page.context().request.get(url, { timeout: 20000 });
  const body = await readJson(res);
  const message = Array.isArray(body.message)
    ? body.message.map((m) => m.label).filter(Boolean).join(', ')
    : '';
  return {
    http: res.status(),
    ok: res.status() === 200 && Number(body.ret) === 0,
    ret: body.ret ?? null,
    message: message.slice(0, 180),
    direction: `${sourceLabel} vers Minimes zone 2`,
  };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length) || 1;
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function newestBegin(active) {
  return active.map((c) => c.begin).filter(Boolean).sort().pop() || '';
}

function shouldMigrate(member, active) {
  if (!active.length) return { ok: false, reason: 'skip_no_active_contract' };
  if (member.source_zone === '7') return { ok: true, reason: 'eu_active' };
  const begin = newestBegin(active);
  if (begin && begin >= SINCE) return { ok: true, reason: 'balma_recent' };
  if (!begin) return { ok: true, reason: 'balma_active_no_date' };
  return { ok: false, reason: 'skip_old_contract', begin };
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const report = {
    mode: CHECK ? 'check' : 'apply',
    direction: 'Balma zone 1 et Etats-Unis zone 7 vers Minimes zone 2',
    since: SINCE,
    started_at: new Date().toISOString(),
    source_count: 0,
    scanned: 0,
    with_active_contract: 0,
    migrated: 0,
    already_minimes: 0,
    skipped_no_contract: 0,
    skipped_old: 0,
    skipped_test: 0,
    failed: 0,
    actives: [],
    results: [],
  };

  await runWithSession('migrate-zone-actives', async (page) => {
    await gotoDeciplus(page, 'nextgen/home').catch(() => {});
    let token = await getAccessToken(page);
    if (!token) {
      await login(page, { siteLabel: 'Minimes' });
      token = await getAccessToken(page);
    }
    if (!token) throw new Error('Token Deciplus introuvable');
    const headers = apiHeaders(token);

    const members = [];
    for (const zone of SOURCE_ZONES) {
      const listed = await listZoneMembers(page, headers, zone);
      members.push(...listed);
    }
    report.source_count = members.length;
    logLine('fiches a scanner', String(members.length), `depuis=${SINCE}`, `concurrence=${CONCURRENCY}`);

    let done = 0;
    await mapPool(members, CONCURRENCY, async (member) => {
      done += 1;
      if (done % 100 === 0 || done === members.length) {
        logLine('scan contrats', `${done}/${members.length}`);
      }
      const item = {
        member_id: member.id,
        name: `${member.first_name} ${member.last_name}`.trim(),
        source: member.source_label,
        created: member.created || null,
      };
      if (isTestName(member.first_name, member.last_name)) {
        report.skipped_test += 1;
        return;
      }
      item.zone_before = member.source_zone;
      const source = SOURCE_ZONES.find((zone) => zone.id === member.source_zone);
      const contracts = await fetchContracts(page, headers, member.id);
      report.scanned += 1;
      item.contracts_http = contracts.status;
      item.active = contracts.active;
      if (contracts.status !== 200) {
        item.status = 'contracts_error';
        report.failed += 1;
        report.results.push(item);
        logLine('erreur contrats', source.label, item.member_id, item.name, String(contracts.status));
        return;
      }
      const decision = shouldMigrate(member, contracts.active);
      if (!contracts.active.length) {
        report.skipped_no_contract += 1;
        return;
      }
      report.with_active_contract += 1;
      report.actives.push({
        member_id: item.member_id,
        name: item.name,
        source: source.label,
        email: item.email,
        contracts: contracts.active,
        decision: decision.reason,
      });
      const label = contracts.active.map((c) => c.title || c.ref).filter(Boolean).join(' | ');
      if (!decision.ok) {
        item.status = decision.reason;
        item.begin = decision.begin || newestBegin(contracts.active);
        report.skipped_old += 1;
        report.results.push(item);
        logLine('ancien contrat, ignore', source.label, item.member_id, item.name, item.begin || '', label);
        return;
      }
      if (CHECK) {
        item.status = 'would_migrate_to_minimes';
        item.via = decision.reason;
        report.results.push(item);
        logLine('actif vers Minimes', source.label, item.member_id, item.name, decision.reason, label);
        return;
      }
      item.migrate = await sendToMinimes(page, member.id, source.label);
      const after = await readZone(page, headers, member.id);
      item.zone_after = after.zone;
      item.via = decision.reason;
      if (String(after.zone) === source.id) {
        item.status = 'migrate_failed_still_source';
        report.failed += 1;
        logLine('echec reste', source.label, item.member_id, item.name, item.migrate?.message || '');
      } else if (String(after.zone) === ZONE_MINIMES) {
        item.status = 'migrated_to_minimes';
        report.migrated += 1;
        logLine('migre vers Minimes', source.label, item.member_id, item.name, label);
      } else {
        item.status = 'migrate_failed_unexpected_zone';
        report.failed += 1;
        logLine('echec zone inattendue', item.member_id, item.name, 'zone', String(after.zone));
      }
      report.results.push(item);
    });
  });

  report.finished_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  logLine(
    'bilan',
    `sources=${report.source_count}`,
    `actifs=${report.with_active_contract}`,
    `migres_vers_minimes=${report.migrated}`,
    `deja_minimes=${report.already_minimes}`,
    `sans_contrat=${report.skipped_no_contract}`,
    `anciens=${report.skipped_old}`,
    `tests=${report.skipped_test}`,
    `echecs=${report.failed}`,
    OUT
  );
  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
