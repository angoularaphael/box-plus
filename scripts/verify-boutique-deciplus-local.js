#!/usr/bin/env node
'use strict';
/**
 * Vérif locale Deciplus — fiche + contrat pour chaque commande boutique payée.
 * Ne touche pas aux bots prem-eu1/eu2 (Playwright local uniquement).
 *
 *   node scripts/verify-boutique-deciplus-local.js --since=2026-09-07 --check
 *   node scripts/verify-boutique-deciplus-local.js --since=2026-09-07 --sync
 *   node scripts/verify-boutique-deciplus-local.js --since=2026-09-07 --photos-only
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig, normalizeOrder } = require('../lib/normalize');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { saleContractMatches } = require('../lib/sale-contract-match');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const {
  productRequiresDeciplusSale,
  deciplusSaleSettled,
} = require('../storefront/lib/deciplus-sale-reconcile');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { resolveProductConfig, fetchDeciplusCatalog } = require('../bot/catalog');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');

const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-09-07';
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0);
const SYNC = process.argv.includes('--sync');
const REPAIR = process.argv.includes('--repair');
const PHOTOS_ONLY = process.argv.includes('--photos-only');
const UPLOAD_PHOTOS =
  !process.argv.includes('--no-photos') && (SYNC || REPAIR || PHOTOS_ONLY || process.argv.includes('--photos'));
const CHECK = !SYNC && !REPAIR && !PHOTOS_ONLY;
const OUT = path.join(__dirname, '..', 'data', `verify-boutique-deciplus-${Date.now()}.json`);
const OUT_MD = path.join(__dirname, '..', 'docs', 'verify-boutique-deciplus.md');

const BLOCK_REPAIR = new Set(['BC-1786789882131-ad43db']); // fares — mauvaise fiche

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

function needsDeciplus(p) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isMateriel(p) || isActionOrder(p)) return false;
  if (!productRequiresDeciplusSale(p)) return false;
  if (!p.signature?.signed_at) return false;
  return true;
}

async function loadOrders() {
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
    if (!needsDeciplus(p)) continue;
    const name = rowName(p);
    const email = p.customer_short?.email || p.customer_full?.email || '';
    if (isTest(name, email)) continue;
    rows.push({
      order_id: p.order_id,
      name,
      email,
      gym: p.customer_full?.gym || p.gym || 'minimes',
      product: p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || '',
      product_id: p.product_id || p.product_snapshot?.id,
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      settled: deciplusSaleSettled(p),
      payload: p,
    });
  }
  return rows;
}

async function reloadMemberIds(rows) {
  const sb = getSupabase();
  for (const row of rows) {
    const { data } = await sb.from('boxplus_orders').select('payload').eq('order_id', row.order_id).maybeSingle();
    const p = data?.payload || {};
    if (p.deciplus_member_id) row.member_id = String(p.deciplus_member_id);
    if (p.deciplus_sale_id) row.sale_id = String(p.deciplus_sale_id);
    row.payload = p.order_id ? p : row.payload;
  }
}

function buildOrder(row) {
  const product = row.payload.product_snapshot || { id: row.product_id, name: row.product };
  const built = buildOrderFromLifecycle(row.payload, product);
  if (/259|12\s*mois|promo 12|dp-100|offre-saison/i.test(`${row.product} ${row.product_id}`)) {
    built.deciplus_product_search = 'OFFRE PROMO 12MOIS';
    built.paiement_comptant = true;
  }
  return normalizeOrder(applyDeciplusPhoto(built, row.payload));
}

function pickContract(contracts, productConfig, row) {
  const isEssai = /essai|seance-essai/i.test(`${row.product} ${row.product_id}`);
  const abos = (contracts || []).filter((c) => !c.isBadge);
  const matches = abos.filter((c) => {
    const label = String(c.label || '');
    if (isEssai) return /essai|coaching|carte/i.test(label) && !/badge/i.test(label);
    return saleContractMatches(label, productConfig);
  });
  const active = matches.filter((c) => !isPendingOrFutureContract(c.label));
  if (active.length) return active[active.length - 1];
  if (matches.length) return matches[matches.length - 1];
  if (row.sale_id) {
    const byId = abos.find((c) => String(c.idc) === String(row.sale_id));
    if (byId) return byId;
  }
  return abos.find((c) => !isPendingOrFutureContract(c.label)) || abos[abos.length - 1] || null;
}

async function uploadPhotoOne(page, row, memberId) {
  if (!memberId || !/^\d+$/.test(String(memberId))) {
    return { ok: false, reason: 'no_member' };
  }
  const hydrated = await hydrateOrderMedia(row.payload);
  const withPhoto = applyDeciplusPhoto({ ...hydrated }, hydrated);
  const photoBase64 =
    withPhoto.documents?.photo_base64 ||
    withPhoto.photo_base64 ||
    hydrated.documents?.photo_base64 ||
    null;
  const photoUrl =
    withPhoto.photo_url ||
    withPhoto.documents?.photo_url ||
    hydrated.documents?.photo_url ||
    null;
  if (!photoBase64 && !photoUrl) {
    return { ok: false, reason: 'no_photo_in_order' };
  }
  const { uploadMemberPhoto } = require('../bot/member');
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const gymCfg = getGymConfig(row.gym || 'minimes');
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, String(memberId), gymCfg).catch(() => {});
  await page.waitForTimeout(400);
  const result = await uploadMemberPhoto(page, null, photoBase64, String(memberId), photoUrl).catch((err) => ({
    ok: false,
    reason: err.message,
  }));
  if (result?.ok) console.log('PHOTO OK', row.name, memberId, result.via || '');
  else console.warn('PHOTO FAIL', row.name, memberId, result?.reason || 'unknown');
  return result;
}

async function verifyOne(page, catalog, row) {
  const { searchMember, searchMemberByName } = require('../bot/member');
  const { switchDeciplusSite } = require('../bot/deciplus-zone');
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');

  const order = buildOrder(row);
  const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
  const gymCfg = getGymConfig(row.gym);
  const site = gymCfg.deciplus_label || 'Minimes';

  const report = {
    order_id: row.order_id,
    name: row.name,
    product: row.product,
    gym: row.gym,
    db_member: row.member_id,
    db_sale: row.sale_id,
    bot_status: row.bot_status,
  };

  await closeGreyboxIfOpen(page).catch(() => {});
  await switchDeciplusSite(page, site);

  let hit = null;
  if (row.member_id && /^\d+$/.test(String(row.member_id))) {
    hit = { found: true, member_id: String(row.member_id) };
  } else if (row.email) {
    hit = await searchMember(page, row.email);
  }
  if (!hit?.found) {
    const parts = row.name.split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    hit = await searchMemberByName(page, last, first);
  }

  if (!hit?.found || !hit.member_id) {
    report.status = 'no_member';
    return report;
  }

  report.member_id = String(hit.member_id);
  await openMemberCheck(page, hit.member_id, gymCfg);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const contract = pickContract(contracts, productConfig, row);

  if (!contract) {
    report.status = 'member_no_contract';
    report.contracts = contracts
      .filter((c) => !c.isBadge)
      .map((c) => ({ idc: c.idc, label: String(c.label || '').slice(0, 100) }));
    return report;
  }

  report.sale_id = String(contract.idc);
  report.contract_label = String(contract.label || '').slice(0, 120);
  report.pending = isPendingOrFutureContract(contract.label);

  const dbOk =
    row.settled &&
    String(row.member_id) === report.member_id &&
    String(row.sale_id) === report.sale_id;
  if (dbOk && !report.pending) {
    report.status = 'ok';
    if (UPLOAD_PHOTOS) report.photo = await uploadPhotoOne(page, row, report.member_id);
    return report;
  }

  if (SYNC || REPAIR) {
    await applyBotSaleStatus(row.order_id, {
      deciplus_member_id: report.member_id,
      deciplus_sale_id: report.sale_id,
      status: report.pending ? 'manual_review' : 'success',
      error: report.pending ? 'Contrat encore en attente Deciplus' : null,
    });
    report.synced = true;
    report.status = report.pending ? 'synced_pending' : 'synced';
    console.log(report.status === 'synced' ? 'OK' : 'PENDING', row.name, report.member_id, report.sale_id);
    if (UPLOAD_PHOTOS) report.photo = await uploadPhotoOne(page, row, report.member_id);
    return report;
  }

  report.status = row.settled ? 'db_mismatch' : 'found_not_synced';
  return report;
}

async function repairOne(page, catalog, row) {
  const { processSaleJob } = require('../bot/index');
  const order = buildOrder(row);
  order.force_requeue = true;
  order.force_sale_retry = true;
  if (row.member_id) order.deciplus_member_id = String(row.member_id);
  console.log('\nREPAIR', row.name, row.order_id);
  const outcome = await processSaleJob(page, order, {});
  const saleId = outcome.deciplus_sale_id || null;
  const memberId = outcome.deciplus_member_id || row.member_id || null;
  await applyBotSaleStatus(row.order_id, {
    deciplus_member_id: memberId || undefined,
    deciplus_sale_id: saleId || undefined,
    status: saleId ? 'success' : outcome.status || 'manual_review',
    error: saleId ? null : outcome.error || 'vente Deciplus absente',
  });
  let photo = null;
  if (UPLOAD_PHOTOS && memberId && saleId) {
    photo = await uploadPhotoOne(page, row, memberId);
  }
  return {
    order_id: row.order_id,
    name: row.name,
    member_id: memberId,
    sale_id: saleId,
    status: saleId ? 'repaired' : 'repair_failed',
    error: outcome.error || null,
    photo,
  };
}

function writeMd(report) {
  const lines = [
    '# Vérification boutique → Deciplus',
    '',
    `Généré : ${report.at}`,
    `Depuis : ${SINCE}`,
    `Mode : ${report.mode}`,
    '',
    `| Statut | Nombre |`,
    `|--------|--------|`,
  ];
  for (const [k, v] of Object.entries(report.by_status || {})) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('', '## À traiter', '');
  lines.push('| Nom | Produit | Salle | Statut | Membre | Vente | Commande |');
  lines.push('|-----|---------|-------|--------|--------|-------|----------|');
  for (const r of report.todo || []) {
    lines.push(
      `| ${r.name || '—'} | ${r.product || '—'} | ${r.gym || '—'} | ${r.status} | ${r.member_id || '—'} | ${r.sale_id || '—'} | ${r.order_id} |`
    );
  }
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, lines.join('\n'));
}

async function main() {
  const rows = await loadOrders();
  const list = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
  console.log(`Commandes payées+signées : ${list.length} (depuis ${SINCE})`);

  const report = {
    at: new Date().toISOString(),
    since: SINCE,
    mode: PHOTOS_ONLY ? 'photos-only' : CHECK ? 'check' : SYNC ? 'sync' : 'repair',
    total: list.length,
    results: [],
  };

  if (CHECK && !SYNC && !REPAIR && !PHOTOS_ONLY) {
    for (const row of list) {
      report.results.push({
        order_id: row.order_id,
        name: row.name,
        settled: row.settled,
        member_id: row.member_id,
        sale_id: row.sale_id,
        bot_status: row.bot_status,
      });
    }
    const unsettled = list.filter((r) => !r.settled);
    console.log(`Déjà OK Supabase : ${list.length - unsettled.length} / ${list.length}`);
    console.log(`À vérifier Deciplus : ${unsettled.length}`);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    return;
  }

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');

  await runWithSession('verify-boutique-local', async (page) => {
    for (const site of ['Minimes', 'Ramonville', 'Portet']) {
      try {
        await login(page, { siteLabel: site });
        break;
      } catch {
        /* try next */
      }
    }
    const catalog = await fetchDeciplusCatalog(page).catch(() => []);

    if (PHOTOS_ONLY) {
      await reloadMemberIds(list);
      const withMember = list.filter((r) => r.member_id && /^\d+$/.test(String(r.member_id)));
      console.log(`Upload photos : ${withMember.length} membre(s)`);
      for (const row of withMember) {
        try {
          const photo = await uploadPhotoOne(page, row, row.member_id);
          report.results.push({
            order_id: row.order_id,
            name: row.name,
            member_id: row.member_id,
            status: photo?.ok ? 'photo_ok' : 'photo_fail',
            photo,
          });
        } catch (err) {
          report.results.push({
            order_id: row.order_id,
            name: row.name,
            status: 'photo_error',
            error: err.message.slice(0, 160),
          });
        }
      }
      return;
    }

    let n = 0;
    for (const row of list) {
      n += 1;
      if (n % 10 === 0) console.log(`… ${n}/${list.length}`);
      try {
        report.results.push(await verifyOne(page, catalog, row));
      } catch (err) {
        report.results.push({ order_id: row.order_id, name: row.name, status: 'error', error: err.message.slice(0, 160) });
        console.error('ERR', row.order_id, err.message);
      }
    }

    if (REPAIR) {
      const todo = report.results.filter(
        (r) =>
          (r.status === 'no_member' || r.status === 'member_no_contract') &&
          !BLOCK_REPAIR.has(r.order_id)
      );
      console.log(`\nRéparation locale : ${todo.length} commande(s)`);
      for (const r of todo) {
        const row = list.find((x) => x.order_id === r.order_id);
        if (!row) continue;
        try {
          report.results.push(await repairOne(page, catalog, row));
        } catch (err) {
          report.results.push({ order_id: r.order_id, status: 'repair_error', error: err.message });
        }
      }
    }
  });
  await closeBrowser().catch(() => {});

  const byStatus = {};
  for (const r of report.results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  report.by_status = byStatus;
  report.todo = report.results.filter(
    (r) => !['ok', 'synced', 'repaired', 'photo_ok'].includes(r.status)
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  writeMd(report);
  console.log('\nRésumé', JSON.stringify(byStatus, null, 2));
  console.log('JSON', OUT);
  console.log('MD', OUT_MD);
  if (report.todo.length) {
    console.log('\nReste à traiter:');
    report.todo.forEach((r) => console.log('-', r.status, r.name, r.order_id));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
