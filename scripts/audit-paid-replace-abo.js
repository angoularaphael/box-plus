#!/usr/bin/env node
'use strict';
/**
 * Audit / réparation : client déjà abonné (44,99, 259, saison…) qui reprend
 * un nouvel abo payé → résilier l’ancien, vendre le nouveau, badge ~72h.
 *
 *   node scripts/audit-paid-replace-abo.js
 *   node scripts/audit-paid-replace-abo.js --check
 *   node scripts/audit-paid-replace-abo.js --fix
 *   node scripts/audit-paid-replace-abo.js --check --since=2026-08-20 --limit=20
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { isAventureOrder } = require('../lib/aventure-policy');
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');

const FIX = process.argv.includes('--fix');
const CHECK = process.argv.includes('--check') || FIX;
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-15';
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `audit-replace-abo-${Date.now()}.json`);

function is29(order) {
  const hay = [
    order.product_id,
    order.product_name,
    order.product_snapshot?.id,
    order.product_snapshot?.name,
    order.product_snapshot?.display_name,
  ]
    .filter(Boolean)
    .join(' ');
  return /dp-104|offre-duo|offre_29|offre a 29|offre duo/i.test(hay);
}

function isTestName(name, email) {
  const hay = `${name} ${email}`.toLowerCase();
  return /\btest\b|boxplus-test/.test(hay);
}

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.replace(/\s+/g, ' ').trim();
}

async function loadPaid29() {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', `${SINCE}T00:00:00.000Z`)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }

  const paid = [];
  for (const r of all) {
    const p = r.payload || {};
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (p.action && p.action !== 'sale') continue;
    if (/^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(r.order_id)) continue;
    if (!is29(p)) continue;
    const name = rowName(p);
    const email = p.customer_short?.email || p.customer_full?.email || '';
    if (isTestName(name, email)) continue;
    if (ONLY && !`${name} ${email} ${r.order_id}`.toLowerCase().includes(ONLY)) continue;
    paid.push({
      order_id: r.order_id,
      created_at: r.created_at,
      paid_at: p.payment?.paid_at || r.created_at,
      name,
      email,
      phone: p.customer_short?.phone || p.customer_full?.phone || '',
      birthdate: p.customer_short?.birthdate || p.customer_full?.birthdate || '',
      gym: p.customer_full?.gym || p.gym || null,
      amount: p.payment?.amount,
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      aventure: isAventureOrder(p),
      source: p.source || null,
      payload: p,
    });
  }
  paid.sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)));
  return LIMIT > 0 ? paid.slice(0, LIMIT) : paid;
}

function summarize(classified) {
  return {
    needsNewSale: classified.needsNewSale,
    needsBadge: classified.needsBadge,
    otherActive: classified.otherActive.map((c) => String(c.label || '').slice(0, 90)),
    matchingPending: classified.matchingPending.map((c) => String(c.label || '').slice(0, 90)),
    matchingStarted: classified.matchingStarted.map((c) => String(c.label || '').slice(0, 90)),
    badges: classified.badges.map((c) => String(c.label || '').slice(0, 90)),
  };
}

async function inspectMember(page, order) {
  const { findMemberOnBoxingCenterGyms } = require('../bot/search-bc-gyms');
  const { openMemberCheck } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');

  let memberId = order.member_id;
  let gymConfig = getGymConfig(order.gym || 'minimes');
  if (!memberId) {
    const cs = order.payload.customer_short || {};
    const cf = order.payload.customer_full || {};
    const match = await findMemberOnBoxingCenterGyms(
      page,
      {
        first_name: cs.first_name || cf.first_name,
        last_name: cs.last_name || cf.last_name,
        birthdate: cs.birthdate || cf.birthdate,
        phone: cs.phone || cf.phone,
        email: cs.email || cf.email,
      },
      { preferredGym: order.gym, includeBalma: false }
    );
    if (!match.found) {
      return { ok: false, issue: 'member_not_found', match };
    }
    memberId = match.member_id;
    if (match.gymConfig) gymConfig = match.gymConfig;
  }

  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const contracts = await findActiveContracts(page).catch(() => []);
  const classified = classifyMemberContracts(contracts, {
    id: 'dp-104',
    name: 'OFFRE A 29€',
    deciplus_product_search: 'OFFRE A 29',
  }, {
    isPendingOrFuture: isPendingOrFutureContract,
    skipCancel: order.aventure,
  });

  const issues = [];
  if (classified.needsNewSale) issues.push('abo_29_missing_or_pending');
  if (classified.matchingPending.length) issues.push('abo_29_not_started');
  if (classified.otherActive.length) issues.push('old_abo_still_active');
  if (classified.needsBadge) issues.push('badge_missing');

  return {
    ok: issues.length === 0,
    member_id: memberId,
    gym: gymConfig?.key || order.gym,
    issues,
    ...summarize(classified),
  };
}

async function repairMember(page, order, inspect) {
  const { fetchDeciplusCatalog, resolveProductConfig, resolveBadgeProductConfig } = require('../bot/catalog');
  const { recordSale } = require('../bot/sale');
  const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
  const { getGymConfig: gymOf } = require('../lib/normalize');
  const { detectMemberGymConfig } = require('../bot/member');
  const { openMemberCheck } = require('../bot/wallet');

  const memberId = inspect.member_id;
  let gymConfig = gymOf(inspect.gym || order.gym || 'minimes');
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const site = await detectMemberGymConfig(page, gymConfig).catch(() => null);
  if (site?.deciplus_label) gymConfig = site;

  const catalog = await fetchDeciplusCatalog(page);
  const productConfig = applyBillingPlanToProductConfig(
    resolveProductConfig(
      {
        product_id: 'dp-104',
        product_name: 'OFFRE A 29€',
        payment: { status: 'paid', amount: order.amount || 29, billing_plan: 'rib' },
      },
      catalog
    ),
    { payment: { status: 'paid', amount: order.amount || 29, billing_plan: 'rib' } }
  );
  const badgeProductConfig = productConfig.auto_badge
    ? resolveBadgeProductConfig(catalog, {
        badge_timing: 'deferred',
        badge_method: 'iban',
      })
    : null;

  const saleOrder = {
    order_id: order.order_id,
    product_id: 'dp-104',
    product_name: 'OFFRE A 29€',
    gym: gymConfig.key || order.gym,
    source: order.source,
    aventure: order.aventure,
    payment: { status: 'paid', amount: order.amount || 29 },
  };

  return recordSale(page, saleOrder, productConfig, memberId, gymConfig, { badgeProductConfig });
}

async function main() {
  const paid = await loadPaid29();
  console.log(`Payés OFFRE 29 € depuis ${SINCE} (hors tests) : ${paid.length}`);
  const missingSale = paid.filter((o) => !o.sale_id);
  console.log(`Sans deciplus_sale_id en base : ${missingSale.length}`);
  for (const o of paid) {
    const day = String(o.paid_at).slice(0, 10);
    console.log(
      [
        day,
        o.amount,
        o.name,
        o.gym,
        o.sale_id ? `sale=${o.sale_id}` : 'SALE?',
        o.member_id ? `id=${o.member_id}` : 'no-id',
        o.aventure ? 'AV' : '',
        o.issues ? o.issues.join(',') : '',
        o.order_id,
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }

  if (!CHECK) {
    console.log('\nRelance avec --check pour ouvrir Deciplus, --fix pour réparer.');
    return;
  }

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const recap = { at: new Date().toISOString(), since: SINCE, fix: FIX, results: [] };

  await runWithSession('audit-replace-abo', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    for (const order of paid) {
      const row = { order_id: order.order_id, name: order.name, gym: order.gym, paid_at: order.paid_at };
      try {
        const inspect = await inspectMember(page, order);
        Object.assign(row, inspect);
        if (FIX && inspect.issues && inspect.issues.length) {
          console.log('FIX', order.name, inspect.issues.join(','));
          row.fix = await repairMember(page, order, inspect);
          const again = await inspectMember(page, { ...order, member_id: inspect.member_id });
          row.after = again;
        }
        const flag = row.ok ? 'OK' : `KO ${(row.issues || []).join(',')}`;
        console.log(`${flag} | ${order.name} | ${order.gym} | id=${row.member_id || '-'} | ${order.order_id}`);
        if (!row.ok) {
          if (row.otherActive?.length) console.log('   ancien:', row.otherActive.join(' || '));
          if (row.matchingPending?.length) console.log('   pending:', row.matchingPending.join(' || '));
          if (row.matchingStarted?.length) console.log('   29:', row.matchingStarted.join(' || '));
          if (row.badges?.length) console.log('   badge:', row.badges.join(' || '));
        }
      } catch (err) {
        row.ok = false;
        row.issue = err.message;
        console.log('ERR', order.name, err.message);
      }
      recap.results.push(row);
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
    }
  });

  await closeBrowser().catch(() => {});
  const ko = recap.results.filter((r) => !r.ok);
  console.log(`\nFini. ${recap.results.length} fiches, ${ko.length} à corriger. ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
