#!/usr/bin/env node
'use strict';
/**
 * Commandes BC payées dont la fiche active est sur Balma (recherche par identité).
 *   node scripts/audit-balma-wrong-gym.js
 *   node scripts/audit-balma-wrong-gym.js 2026-09-01T00:00:00.000Z
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
const { getGymConfig } = require('../lib/normalize');
const { isBalmaGymSlug } = require('../lib/gym-slugs');

const SINCE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}/.test(a)) || '2026-09-01T00:00:00.000Z';
const OUT = path.join(__dirname, '..', 'data', `audit-balma-wrong-gym-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function identityFromPayload(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return {
    first_name: cs.first_name || cf.first_name,
    last_name: cs.last_name || cf.last_name,
    email: cs.email || cf.email,
    phone: cs.phone || cf.phone,
    birthdate: cs.birthdate || cf.birthdate,
  };
}

async function loadOrders() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, created_at, payload')
    .gte('created_at', SINCE)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = [];
  for (const r of data || []) {
    const p = r.payload || {};
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (p.action && p.action !== 'sale') continue;
    const gym = String(p.customer_full?.gym || p.gym || '').toLowerCase();
    if (!gym || isBalmaGymSlug(gym)) continue;
    const identity = identityFromPayload(p);
    if (!identity.last_name && !identity.email) continue;
    rows.push({
      order_id: r.order_id,
      created_at: r.created_at,
      name: rowName(p),
      email: identity.email,
      gym,
      db_member_id: p.deciplus_member_id || null,
      db_sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status,
      identity,
    });
  }
  return rows;
}

async function inspectOnBalma(page, row) {
  const { switchDeciplusSite } = require('../bot/deciplus-zone');
  const { findBalmaMember } = require('../bot/migrate-gym');
  const { openMemberCheck } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  const { memberZoneLooksBalma } = require('../bot/search-bc-gyms');
  const balmaConfig = getGymConfig('balma');

  await switchDeciplusSite(page, 'Balma').catch(() => {});
  const hit = await findBalmaMember(page, row.identity);
  if (!hit.found || !hit.member_id) {
    return { ...row, balma_found: false, reason: hit.reason || 'not_found' };
  }

  await openMemberCheck(page, hit.member_id, balmaConfig).catch(() => {});
  const onBalma = await memberZoneLooksBalma(page);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);

  return {
    ...row,
    balma_found: true,
    balma_member_id: String(hit.member_id),
    on_balma: onBalma,
    active_contracts: contracts.map((c) => ({
      idc: c.idc,
      badge: Boolean(c.isBadge),
      label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 120),
    })),
    wrong_gym: onBalma && contracts.length > 0,
    id_mismatch: row.db_member_id && String(row.db_member_id) !== String(hit.member_id),
  };
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const orders = await loadOrders();
  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');

  const report = { since: SINCE, total: orders.length, scanned: [], wrong_gym: [] };
  await runWithSession('audit-balma-wrong-gym', async (page) => {
    await login(page, { siteLabel: 'Balma' }).catch(async () => {
      await login(page, { siteLabel: 'Minimes' });
    });
    for (const row of orders) {
      const hit = await inspectOnBalma(page, row);
      report.scanned.push(hit);
      if (hit.wrong_gym) report.wrong_gym.push(hit);
    }
  });
  await closeBrowser().catch(() => {});

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        since: SINCE,
        total: report.total,
        wrong_gym_count: report.wrong_gym.length,
        wrong_gym: report.wrong_gym.map((r) => ({
          order_id: r.order_id,
          name: r.name,
          gym_ordered: r.gym,
          balma_member_id: r.balma_member_id,
          db_member_id: r.db_member_id,
          contracts: r.active_contracts,
        })),
        out: OUT,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
