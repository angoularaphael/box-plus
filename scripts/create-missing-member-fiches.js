#!/usr/bin/env node
'use strict';
/**
 * Payés sans fiche Deciplus → création en NOUVEAU membre (+ vente).
 *
 *   node scripts/create-missing-member-fiches.js --check
 *   node scripts/create-missing-member-fiches.js --fix
 *   node scripts/create-missing-member-fiches.js --fix --limit=3
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
const { normalizeOrder } = require('../lib/normalize');
const { isAventureOrder } = require('../lib/aventure-policy');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { productRequiresDeciplusSale, deciplusSaleSettled } = require('../storefront/lib/deciplus-sale-reconcile');

const CHECK = !process.argv.includes('--fix') && !process.argv.includes('--dispatch');
const DISPATCH = process.argv.includes('--dispatch');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-28';
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const OUT = path.join(__dirname, '..', 'data', `create-missing-member-fiches-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function identityReady(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  const first = cs.first_name || cf.first_name;
  const last = cs.last_name || cf.last_name;
  const birth = cs.birthdate || cf.birthdate;
  const gym = cf.gym || p.gym;
  return Boolean(first && last && birth && gym);
}

function isTest(name, email) {
  return /\btest\b|boxplus-test|@boxplus-test\.local/i.test(`${name} ${email}`);
}

function isEssai(p) {
  return /s[eé]ance d['’]?essai|seance-essai/i.test(
    `${p.product_name || ''} ${p.product_id || ''} ${p.product_snapshot?.name || ''}`
  );
}

function isMateriel(p) {
  if (/^MAT-/i.test(String(p.order_id || ''))) return true;
  if (p.action === 'materiel') return true;
  const snap = p.product_snapshot || {};
  return snap.tab === 'materiel' || /materiel/i.test(String(snap.sale_type || ''));
}

async function loadTargets() {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const createdSince = new Date(Date.parse(`${SINCE}T00:00:00.000Z`) - 45 * 24 * 3600 * 1000).toISOString();
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', createdSince)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }

  const targets = [];
  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (isMateriel(p) || isEssai(p)) continue;
    if (!productRequiresDeciplusSale(p)) continue;
    if (deciplusSaleSettled(p) || p.deciplus_member_id) continue;
    if (isAventureOrder(p)) continue;
    if (!identityReady(p)) continue;
    const name = rowName(p);
    const email = p.customer_short?.email || p.customer_full?.email || '';
    if (isTest(name, email)) continue;
    const paidAt = p.payment?.paid_at || r.created_at;
    if (paidAt && Date.parse(paidAt) < Date.parse(`${SINCE}T00:00:00.000Z`)) continue;
    targets.push({
      order_id: r.order_id,
      name,
      email,
      gym: p.customer_full?.gym || p.gym,
      product: p.product_snapshot?.display_name || p.product_name || p.product_id,
      paid_at: paidAt,
      signed: Boolean(p.signature?.signed_at),
      payload: p,
    });
  }
  return targets;
}

async function repairOne(page, row) {
  const { processSaleJob } = require('../bot/index');
  const hydrated = await hydrateOrderMedia(row.payload);
  const product = row.payload.product_snapshot || {
    id: row.payload.product_id,
    name: row.product,
  };
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  payload.force_new_member = true;
  payload.force_requeue = true;
  payload.force_sale_retry = true;
  delete payload.deciplus_member_id;
  delete payload.deciplus_sale_id;
  if (/259|12\s*mois|promo 12|dp-100/i.test(`${row.product} ${row.payload.product_id}`)) {
    payload.deciplus_product_search = 'OFFRE PROMO 12MOIS';
    payload.paiement_comptant = true;
  }
  const order = normalizeOrder(payload);
  console.log('\n===', row.name, row.order_id, '===');
  const outcome = await processSaleJob(page, order, {});
  await applyBotSaleStatus(row.order_id, {
    deciplus_member_id: outcome.deciplus_member_id || undefined,
    deciplus_sale_id: outcome.deciplus_sale_id || undefined,
    status: outcome.deciplus_sale_id ? 'success' : outcome.status || 'manual_review',
    error: outcome.deciplus_sale_id ? null : outcome.error || 'fiche/vente Deciplus absente',
  });
  return {
    order_id: row.order_id,
    name: row.name,
    member_id: outcome.deciplus_member_id || null,
    sale_id: outcome.deciplus_sale_id || null,
    status: outcome.status,
    error: outcome.error || null,
  };
}

async function dispatchOne(row) {
  const { forwardJobToBot } = require('../lib/bot-forward');
  const hydrated = await hydrateOrderMedia(row.payload);
  const product = row.payload.product_snapshot || { id: row.payload.product_id, name: row.product };
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  payload.force_new_member = true;
  payload.force_requeue = true;
  payload.force_sale_retry = true;
  delete payload.deciplus_member_id;
  delete payload.deciplus_sale_id;
  if (/259|12\s*mois|promo 12|dp-100/i.test(`${row.product} ${row.payload.product_id}`)) {
    payload.deciplus_product_search = 'OFFRE PROMO 12MOIS';
    payload.paiement_comptant = true;
  }
  const order = normalizeOrder(payload);
  const sent = await forwardJobToBot(order);
  return { order_id: row.order_id, name: row.name, forwarded: sent.forwarded, bot: sent.bot_url || null };
}

async function main() {
  const targets = await loadTargets();
  const list = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  const mode = DISPATCH ? 'dispatch' : CHECK ? 'check' : 'fix';
  console.log(
    JSON.stringify(
      {
        since: SINCE,
        mode,
        total_missing: targets.length,
        to_process: list.length,
        rows: list.map((r) => ({
          paid_at: r.paid_at,
          name: r.name,
          gym: r.gym,
          product: r.product,
          signed: r.signed,
          order_id: r.order_id,
        })),
      },
      null,
      2
    )
  );
  if ((CHECK && !DISPATCH) || !list.length) {
    return;
  }

  if (DISPATCH) {
    const results = [];
    for (const row of list) {
      try {
        results.push(await dispatchOne(row));
        console.log('ENVOYÉ', row.name, row.order_id);
      } catch (err) {
        results.push({ order_id: row.order_id, name: row.name, error: err.message });
        console.error('FAIL', row.name, err.message);
      }
    }
    console.log(JSON.stringify({ dispatched: results }, null, 2));
    return;
  }

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const report = { at: new Date().toISOString(), results: [] };

  await runWithSession('create-missing-member-fiches', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    for (const row of list) {
      try {
        report.results.push(await repairOne(page, row));
      } catch (err) {
        report.results.push({ order_id: row.order_id, name: row.name, error: err.message });
        await applyBotSaleStatus(row.order_id, { status: 'manual_review', error: err.message }).catch(() => {});
      }
    }
  });
  await closeBrowser().catch(() => {});
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
