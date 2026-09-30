#!/usr/bin/env node
'use strict';
/**
 * Retire les badges posés par erreur sur les offres comptant / essai / coaching.
 * Le badge reste uniquement sur l’offre 29 € (prélèvement + IBAN).
 *
 *   node scripts/fix-remove-wrong-badges.js --check --since=2026-09-07
 *   node scripts/fix-remove-wrong-badges.js --apply --since=2026-09-07
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
const { isOffre29Product, isAnnualPromoProduct, isMonthlyFlexProduct } = require('../lib/sale-contract-match');
const { isPayplug4xPrelevementOrder, isComptantStyleProduct } = require('../lib/billing-plan');
const { isCartePrestationOrder } = require('../lib/catalog-sale');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { findActiveContracts, cancelOneContract } = require('../bot/cancel-sale');

const APPLY = process.argv.includes('--apply');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-09-07';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const MEMBERS = (process.argv.find((a) => a.startsWith('--members=')) || '').slice(10);
const SKIP = (process.argv.find((a) => a.startsWith('--skip=')) || '').slice(7);
const OUT = path.join(__dirname, '..', 'data', `fix-remove-wrong-badges-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function productOf(p) {
  return {
    id: p.product_id || p.product_snapshot?.id,
    name: p.product_snapshot?.name || p.product_name,
    display_name: p.product_snapshot?.display_name,
    sale_type: p.product_snapshot?.sale_type,
  };
}

/** Badge interdit : essai, coaching, 12 mois, enfants comptant. 29 € et 44,99 € : on garde. */
function mustNotHaveBadge(p) {
  const prod = productOf(p);
  if (isCartePrestationOrder(p)) return true;
  if (isAnnualPromoProduct(prod) || isAnnualPromoProduct(p)) return true;
  if (isComptantStyleProduct(prod)) return true;
  if (isOffre29Product(prod) || isOffre29Product(p)) return false;
  if (isMonthlyFlexProduct(prod)) return false;
  return false;
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const sb = getSupabase();
  const since = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, payload, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .range(0, 199);
  if (error) throw error;

  const targets = [];
  const seen = new Set();
  for (const r of data || []) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (!/^BC-/i.test(p.order_id)) continue;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    const member = String(p.deciplus_member_id || '').trim();
    if (!/^\d+$/.test(member) || seen.has(member)) continue;
    if (!mustNotHaveBadge(p)) continue;
    const name = rowName(p);
    if (ONLY && !`${name} ${p.order_id} ${member}`.toLowerCase().includes(ONLY)) continue;
    if (MEMBERS) {
      const wanted = new Set(MEMBERS.split(',').map((s) => s.trim()).filter(Boolean));
      if (!wanted.has(member)) continue;
    }
    if (SKIP) {
      const skip = new Set(SKIP.split(',').map((s) => s.trim()).filter(Boolean));
      if (skip.has(member)) continue;
    }
    seen.add(member);
    targets.push({
      order_id: p.order_id,
      name,
      gym: p.customer_full?.gym || p.gym || 'minimes',
      member_id: member,
      product: p.product_snapshot?.display_name || p.product_name || '',
    });
  }

  console.log(`${APPLY ? 'APPLY' : 'CHECK'} — ${targets.length} fiche(s) sans droit au badge`);
  const report = { at: new Date().toISOString(), apply: APPLY, results: [] };

  await runWithSession('remove-wrong-badges', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
    for (const t of targets) {
      const gym = getGymConfig(t.gym);
      console.log('\n===', t.name, t.member_id, t.product);
      await closeGreyboxIfOpen(page).catch(() => {});
      await switchDeciplusSite(page, gym.deciplus_label || 'Minimes').catch(() => {});
      await openMemberCheck(page, t.member_id, gym).catch(() => {});
      const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
      const badges = before.filter((c) => c.isBadge);
      const row = {
        ...t,
        badges_before: badges.map((c) => c.idc),
        cancelled: [],
      };
      if (!badges.length) {
        row.status = 'ok_no_badge';
        console.log('  OK — pas de badge');
        report.results.push(row);
        continue;
      }
      console.log('  BADGE À RETIRER', badges.map((c) => c.idc).join(','));
      if (!APPLY) {
        row.status = 'needs_remove';
        report.results.push(row);
        continue;
      }
      for (const badge of badges) {
        const out = await cancelOneContract(page, badge, { neverVoid: true });
        row.cancelled.push({ idc: badge.idc, ...out });
        await closeGreyboxIfOpen(page).catch(() => {});
        await openMemberCheck(page, t.member_id, gym).catch(() => {});
      }
      const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
      row.badges_after = after.filter((c) => c.isBadge).map((c) => c.idc);
      row.status = row.badges_after.length ? 'partial' : 'removed';
      console.log('  AFTER', row.status, 'badges', row.badges_after.length);
      report.results.push(row);
    }
  });

  await closeBrowser().catch(() => {});
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const hit = report.results.filter((r) => r.status !== 'ok_no_badge');
  console.log('\nécrit', OUT);
  console.log(JSON.stringify({ total: report.results.length, to_fix: hit.length, hit: hit.map((r) => ({ name: r.name, status: r.status, product: r.product })) }, null, 2));
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
