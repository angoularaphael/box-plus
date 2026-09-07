#!/usr/bin/env node
'use strict';
/**
 * Offre 12 mois comptant : annule les badges Deciplus créés par erreur
 * et remet la commande en success sur le bon contrat abo.
 *
 *   node scripts/fix-12mois-comptant-badges.js --check
 *   node scripts/fix-12mois-comptant-badges.js --apply
 *   node scripts/fix-12mois-comptant-badges.js --apply --only=thiefine
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_BOT_URL;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { isPayplug4xPrelevementOrder } = require('../lib/billing-plan');
const { isAnnualPromoProduct } = require('../lib/sale-contract-match');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { findActiveContracts, cancelOneContract } = require('../bot/cancel-sale');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');

const CHECK = !process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `fix-12mois-badges-${Date.now()}.json`);

function is259ComptantOrder(p) {
  if (!p || String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (!isAnnualPromoProduct(p.product_snapshot || { id: p.product_id, name: p.product_name })) return false;
  if (isPayplug4xPrelevementOrder(p)) return false;
  const plan = String(p.payment?.billing_plan || p.billing_plan || '').toLowerCase();
  if (plan === 'rib') return false;
  if (String(p.payment?.payment_plan || p.payment_plan || '').toLowerCase() === '4x' && plan === 'rib') {
    return false;
  }
  return true;
}

function rowHay(p, orderId) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''} ${cs.email || cf.email || ''} ${orderId}`.toLowerCase();
}

function pickAboContract(contracts) {
  const abos = (contracts || []).filter((c) => !c.isBadge);
  const comptant = abos.find((c) => /offre promo 12mois/i.test(String(c.label || '')) && !/4x|en attente|prelevement/i.test(String(c.label || '')));
  if (comptant) return comptant;
  return abos.find((c) => /offre promo 12mois/i.test(String(c.label || ''))) || abos[0] || null;
}

async function loadTargets() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, payload, updated_at')
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const targets = [];
  for (const row of data || []) {
    const p = row.payload || {};
    if (!is259ComptantOrder(p)) continue;
    const hay = rowHay(p, row.order_id);
    if (ONLY && !hay.includes(ONLY)) continue;
    const err = String(p.bot_error || '');
    const needs = p.bot_status === 'manual_review' && /iban requis/i.test(err);
    if (!needs) continue;
    targets.push({
      order_id: row.order_id,
      name: rowHay(p, '').trim(),
      email: p.customer_short?.email || p.customer_full?.email || '',
      gym: p.customer_full?.gym || p.gym || 'minimes',
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      bot_error: p.bot_error || null,
    });
  }
  return targets;
}

async function repairMember(page, target) {
  const gymConfig = getGymConfig(target.gym || 'minimes');
  const memberId = String(target.member_id || '').trim();
  if (!/^\d+$/.test(memberId)) {
    return { ...target, skipped: 'invalid_member_id' };
  }

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const badges = before.filter((c) => c.isBadge);
  const abo = pickAboContract(before);
  const badgeResults = [];

  if (!CHECK && badges.length) {
    for (const badge of badges) {
      const out = await cancelOneContract(page, badge);
      badgeResults.push({ idc: badge.idc, cancelled: out.cancelled, reason: out.reason });
      await closeGreyboxIfOpen(page).catch(() => {});
      await openMemberCheck(page, memberId, gymConfig).catch(() => {});
    }
  }

  const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const aboAfter = pickAboContract(after);
  const saleId = aboAfter?.idc || abo?.idc || target.sale_id;

  if (!CHECK && saleId) {
    await applyBotSaleStatus(target.order_id, {
      status: 'success',
      deciplus_member_id: memberId,
      deciplus_sale_id: String(saleId),
      error: null,
    }).catch(() => {});
  }

  return {
    ...target,
    abo_before: abo?.idc || null,
    abo_label: String(abo?.label || '').replace(/\s+/g, ' ').slice(0, 120),
    badges_found: badges.length,
    badge_results: badgeResults,
    badges_remaining: after.filter((c) => c.isBadge).length,
    sale_id_after: saleId || null,
    applied: !CHECK,
  };
}

(async () => {
  const targets = await loadTargets();
  console.log(`Cibles 12 mois comptant (badge erroné / IBAN) : ${targets.length}`);
  const report = { at: new Date().toISOString(), mode: CHECK ? 'check' : 'apply', targets: [] };

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  await runWithSession('fix-12mois-badges', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
    for (const t of targets) {
      try {
        const row = await repairMember(page, t);
        report.targets.push(row);
        console.log(
          CHECK ? 'CHECK' : 'APPLIED',
          t.email || t.name,
          'member',
          t.member_id,
          'badges',
          row.badges_found,
          'abo',
          row.abo_before
        );
      } catch (err) {
        report.targets.push({ ...t, error: err.message.slice(0, 200) });
        console.error('FAIL', t.order_id, err.message);
        await closeGreyboxIfOpen(page).catch(() => {});
      }
    }
  });

  await closeBrowser().catch(() => {});
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ count: report.targets.length, out: OUT }, null, 2));
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
