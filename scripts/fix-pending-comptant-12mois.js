#!/usr/bin/env node
'use strict';
/**
 * Annule les contrats OFFRE PROMO 12MOIS « En attente » sur les 12 mois comptant
 * (le bot a parfois recréé des ventes en attente à tort).
 *
 *   node scripts/fix-pending-comptant-12mois.js --check
 *   node scripts/fix-pending-comptant-12mois.js --apply
 *   node scripts/fix-pending-comptant-12mois.js --apply --only=deiss
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { isPayplug4xPrelevementOrder, isComptantStyleProduct } = require('../lib/billing-plan');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const {
  findActiveContracts,
  cancelSale,
  isPendingOrFutureContract,
  parseFrDatesFromLabel,
} = require('../bot/cancel-sale');

const CHECK = !process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-06-01';
const OUT = path.join(__dirname, '..', 'data', `fix-pending-12mois-${Date.now()}.json`);

function is12ComptantOrder(p) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  const snap = p.product_snapshot || {};
  const product = {
    id: p.product_id || snap.id,
    name: snap.name || p.product_name,
    supports_installment_choice: snap.supports_installment_choice,
  };
  if (!isComptantStyleProduct(product)) return false;
  if (isPayplug4xPrelevementOrder(p)) return false;
  const plan = String(p.payment?.billing_plan || p.billing_plan || '').toLowerCase();
  if (plan === 'rib') return false;
  return true;
}

function rowHay(p, orderId) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''} ${cs.email || cf.email || ''} ${orderId}`.toLowerCase();
}

async function loadTargets() {
  const sb = getSupabase();
  const since = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const all = [];
  let from = 0;
  while (true) {
    const { data } = await sb
      .from('boxplus_orders')
      .select('order_id, payload, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const byMember = new Map();
  for (const row of all) {
    const p = row.payload || {};
    if (!is12ComptantOrder(p)) continue;
    const member = String(p.deciplus_member_id || '').trim();
    if (!/^\d+$/.test(member)) continue;
    const hay = rowHay(p, row.order_id);
    if (ONLY && !hay.includes(ONLY)) continue;
    if (!byMember.has(member)) {
      byMember.set(member, {
        order_id: row.order_id,
        name: rowHay(p, '').trim(),
        email: p.customer_short?.email || p.customer_full?.email || '',
        member,
        gym: p.customer_full?.gym || p.gym || 'minimes',
        sale_id: p.deciplus_sale_id || null,
      });
    }
  }
  return [...byMember.values()];
}

function is4xPrelevementLabel(label) {
  const t = String(label || '').toLowerCase();
  return /4x|prelevement|64,75|64\.75/.test(t);
}

function is12moisPendingLabel(label) {
  const t = String(label || '').toLowerCase();
  if (is4xPrelevementLabel(t)) return false;
  if (!isPendingOrFutureContract(label)) return false;
  if (/offre promo 12|12mois|\b259\b/.test(t)) return true;
  // Fiche membre Deciplus : libellé souvent « Contrat n°… En attente » sans nom produit.
  if (/contrat n°|vendu le/.test(t) && /en attente/i.test(t)) return true;
  const dates = parseFrDatesFromLabel(label);
  if (dates.length >= 2 && dates[0] > new Date()) return true;
  return false;
}

function is12moisActiveLabel(label) {
  const t = String(label || '').toLowerCase();
  if (is4xPrelevementLabel(t)) return false;
  if (isPendingOrFutureContract(label)) return false;
  if (/offre promo 12|12mois|\b259\b/.test(t)) return true;
  if (/jours restants/.test(t) && !/annul|resilie|expir/i.test(t)) return true;
  return false;
}

async function fixMember(page, target) {
  const gym = getGymConfig(target.gym || 'minimes');
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, target.member, gym);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const abos = contracts.filter((c) => !c.isBadge);
  const pending12 = abos.filter((c) => is12moisPendingLabel(c.label));
  const active12 = abos.filter((c) => is12moisActiveLabel(c.label));

  const result = {
    ...target,
    pending: pending12.map((c) => ({ idc: c.idc, label: String(c.label || '').slice(0, 120) })),
    active: active12.map((c) => ({ idc: c.idc, label: String(c.label || '').slice(0, 120) })),
    cancelled: [],
  };

  if (!pending12.length) {
    result.skipped = 'no_pending_12mois';
    return result;
  }

  if (!CHECK) {
    const cancel = await cancelSale(page, target.member, { pendingOnly: true, gymConfig: gym });
    result.cancelled = cancel.details || [];
    result.cancelled_count = cancel.cancelled_count;
    await closeGreyboxIfOpen(page).catch(() => {});
    await openMemberCheck(page, target.member, gym).catch(() => {});
    const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
    result.pending_after = after
      .filter((c) => !c.isBadge && is12moisPendingLabel(c.label))
      .map((c) => c.idc);
  }

  return result;
}

(async () => {
  const targets = await loadTargets();
  console.log(`Cibles 12 mois comptant : ${targets.length}`);
  const report = { at: new Date().toISOString(), mode: CHECK ? 'check' : 'apply', results: [] };

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const byGym = new Map();
  for (const t of targets) {
    const gymKey = String(t.gym || 'minimes').toLowerCase();
    if (!byGym.has(gymKey)) byGym.set(gymKey, []);
    byGym.get(gymKey).push(t);
  }

  await runWithSession('fix-pending-12mois', async (page) => {
    for (const [gymKey, group] of byGym) {
      const gym = getGymConfig(gymKey);
      const siteLabel = gym.deciplus_label || 'Minimes';
      console.log(`Site Deciplus : ${siteLabel} (${group.length} membres)`);
      await login(page, { siteLabel }).catch(() => login(page, { siteLabel: 'Minimes' }));
      let n = 0;
      for (const t of group) {
        n += 1;
        if (n % 25 === 0) console.log(`… ${siteLabel} ${n}/${group.length}`);
        try {
          const row = await fixMember(page, t);
          report.results.push(row);
          if (row.pending?.length) {
            console.log(
              CHECK ? 'PENDING' : 'FIXED',
              t.email || t.name,
              'member',
              t.member,
              row.pending.length,
              'en attente'
            );
          }
        } catch (err) {
          report.results.push({ ...t, error: err.message.slice(0, 180) });
          console.error('FAIL', t.member, err.message);
          await closeGreyboxIfOpen(page).catch(() => {});
        }
      }
    }
  });

  await closeBrowser().catch(() => {});
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const withPending = report.results.filter((r) => r.pending?.length);
  console.log(JSON.stringify({ with_pending: withPending.length, out: OUT }, null, 2));
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
