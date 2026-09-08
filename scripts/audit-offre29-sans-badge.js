#!/usr/bin/env node
'use strict';
/**
 * Audit offres 29 € (OFFRE DUO / offre-duo) sans badge actif Deciplus.
 *
 *   node scripts/audit-offre29-sans-badge.js --since=2026-08-01
 *   node scripts/audit-offre29-sans-badge.js --since=2026-08-01 --apply
 *   node scripts/audit-offre29-sans-badge.js --only=demaria --apply
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
const { isOffre29Product } = require('../lib/sale-contract-match');
const { isBalmaRetourOrder, shouldGiftBadgeComptant } = require('../lib/balma');
const { isBalmaSaleTarget } = require('../lib/gym-slugs');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { findActiveContracts, isPendingOrFutureContract, cancelSale } = require('../bot/cancel-sale');
const { fetchDeciplusCatalog, resolveBadgeProductConfig } = require('../bot/catalog');
const { buyCarteBadge } = require('../bot/sale');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');

const APPLY = process.argv.includes('--apply');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-01';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `audit-offre29-sans-badge-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function isExpiredBadge(label) {
  return /expir[eé]|0 cr[eé]dit restant/i.test(String(label || ''));
}

function activeBadges(contracts) {
  return (contracts || []).filter((c) => c.isBadge && !isExpiredBadge(c.label));
}

function offre29Abo(contracts) {
  return (contracts || []).filter((c) => {
    if (c.isBadge) return false;
    const label = String(c.label || '');
    return /offre\s*(a|duo)\s*29|\b29[,.]?0{0,2}\s*€|contrat n[°o]/i.test(label);
  });
}

function classifyCause(row, live) {
  if (!row.member_id) return 'bot_pas_execute';
  if (!live) return 'fiche_introuvable';
  if (isBalmaSaleTarget(live.site || {}, row)) return 'fiche_encore_balma';
  const badges = activeBadges(live.contracts);
  const abos = offre29Abo(live.contracts);
  const pending = abos.filter((c) => isPendingOrFutureContract(c.label));
  const started = abos.filter((c) => !isPendingOrFutureContract(c.label));
  if (!abos.length && row.sale_id) return 'libelle_contrat_non_reconnu';
  if (!abos.length) return 'vente_absente';
  if (pending.length > 0 && started.length > 0) return 'doublon_en_attente';
  if (pending.length > 1) return 'empilement_en_attente';
  if (!badges.length) {
    if (!row.has_iban && !row.balma_gift) return 'sans_iban_pas_badge_auto';
    if (row.bot_status === 'manual_review') return 'badge_non_pose_apres_vente';
    return 'badge_manquant';
  }
  if (row.bot_status && row.bot_status !== 'success') return 'bot_statut_incorrect';
  return 'ok';
}

async function loadOrders() {
  const sb = getSupabase();
  const since = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, payload, created_at')
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
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    const product = {
      id: p.product_id || p.product_snapshot?.id,
      name: p.product_snapshot?.name || p.product_name,
      display_name: p.product_snapshot?.display_name,
    };
    if (!isOffre29Product(product)) continue;
    const name = rowName(p);
    if (ONLY) {
      const hay = `${name} ${p.order_id} ${p.deciplus_member_id || ''}`.toLowerCase();
      if (!ONLY.split(',').some((s) => hay.includes(s.trim()))) continue;
    }
    rows.push({
      order_id: p.order_id,
      name,
      email: p.customer_short?.email || p.customer_full?.email || '',
      gym: p.customer_full?.gym || p.gym || 'minimes',
      member_id: String(p.deciplus_member_id || '').replace(/\D/g, '') || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      bot_error: p.bot_error || null,
      has_iban: Boolean(p.payment?.iban),
      balma_gift: shouldGiftBadgeComptant(p, product),
      balma_retour: isBalmaRetourOrder(p),
      created_at: r.created_at,
    });
  }
  return rows;
}

async function inspect(page, row) {
  const gym = getGymConfig(row.gym === 'etats-unis' ? 'minimes' : row.gym);
  const site = gym.deciplus_label || 'Minimes';
  await closeGreyboxIfOpen(page).catch(() => {});
  await switchDeciplusSite(page, site).catch(() => {});
  if (!row.member_id) return null;
  await openMemberCheck(page, row.member_id, gym).catch(() => {});
  await page.waitForTimeout(700);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const zone = await page
    .evaluate(() => {
      const sel = document.querySelector('select[name="idz"]');
      return sel ? { zone: sel.value, label: sel.options[sel.selectedIndex]?.textContent?.trim() } : null;
    })
    .catch(() => null);
  return {
    site: { deciplus_zone_id: zone?.zone || gym.deciplus_zone_id, deciplus_label: zone?.label || site },
    contracts,
    badges_active: activeBadges(contracts).length,
    badges_expired: (contracts || []).filter((c) => c.isBadge && isExpiredBadge(c.label)).length,
    abo_29: offre29Abo(contracts).length,
    pending: offre29Abo(contracts).filter((c) => isPendingOrFutureContract(c.label)).length,
  };
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const orders = await loadOrders();
  console.log(`${APPLY ? 'APPLY' : 'CHECK'} — ${orders.length} commande(s) offre 29 € depuis ${SINCE}`);
  const report = { at: new Date().toISOString(), apply: APPLY, since: SINCE, summary: {}, results: [] };

  await runWithSession('audit-offre29-sans-badge', async (page) => {
    for (const site of ['Minimes', 'Saint-Cyprien', 'Portet']) {
      try {
        await login(page, { siteLabel: site });
        break;
      } catch {
        /* next */
      }
    }
    const catalog = await fetchDeciplusCatalog(page).catch(() => []);

    for (const row of orders) {
      const live = await inspect(page, row);
      const cause = classifyCause(row, live);
      const entry = {
        ...row,
        cause,
        live: live
          ? {
              zone: live.site?.deciplus_zone_id,
              site: live.site?.deciplus_label,
              badges_active: live.badges_active,
              badges_expired: live.badges_expired,
              abo_29: live.abo_29,
              pending: live.pending,
            }
          : null,
        actions: [],
        status: cause === 'ok' ? 'ok' : 'issue',
      };

      if (APPLY && entry.status === 'issue' && live && row.member_id) {
        const gym = getGymConfig(row.gym === 'etats-unis' ? 'minimes' : row.gym);
        const pendingStacked = live.pending > 0 && live.abo_29 > live.pending;
        if (pendingStacked || live.pending > 1) {
          const cancel = await cancelSale(page, row.member_id, {
            pendingOnly: true,
            gymConfig: gym,
            cancelReason: 'change_replace_existing',
          }).catch((err) => ({ error: err.message }));
          entry.actions.push({ cancel_pending: cancel });
        }
        const refreshed = await inspect(page, row);
        const phantomBadges = (refreshed?.contracts || []).filter(
          (c) => c.isBadge && isExpiredBadge(c.label)
        );
        if (phantomBadges.length > 0) {
          for (const phantom of phantomBadges) {
            const cancelPhantom = await cancelSale(page, row.member_id, {
              filter: (c) => String(c.idc) === String(phantom.idc),
              cancelReason: 'change_replace_existing',
              gymConfig: gym,
            }).catch((err) => ({ error: err.message, idc: phantom.idc }));
            entry.actions.push({ cancel_phantom_badge: { idc: phantom.idc, ...cancelPhantom } });
          }
        }
        const afterPhantom = await inspect(page, row);
        if (afterPhantom && afterPhantom.badges_active === 0 && afterPhantom.abo_29 > 0) {
          const gift = row.balma_gift;
          const badgeCfg = resolveBadgeProductConfig(
            catalog,
            gift
              ? { badge_timing: 'immediate', badge_method: 'comptant', paiement_comptant: true }
              : { badge_timing: 'deferred', badge_method: 'iban' }
          );
          const badge = await buyCarteBadge(page, badgeCfg, gym, row.member_id).catch((err) => ({
            error: err.message,
          }));
          entry.actions.push({ badge });
        }
        if (row.bot_status !== 'success' && row.sale_id) {
          await applyBotSaleStatus(row.order_id, {
            deciplus_member_id: row.member_id,
            deciplus_sale_id: row.sale_id,
            status: 'success',
            error: null,
          }).catch(() => {});
          entry.actions.push({ bot_status: 'success' });
        }
        const final = await inspect(page, row);
        entry.after = final
          ? {
              badges_active: final.badges_active,
              abo_29: final.abo_29,
              pending: final.pending,
            }
          : null;
        entry.status =
          final && final.badges_active > 0 && final.pending === 0 ? 'fixed' : entry.status === 'issue' ? 'partial' : entry.status;
      }

      console.log(
        entry.status === 'ok' ? '  OK' : '  ISSUE',
        row.name,
        row.member_id || 'no-member',
        cause,
        live ? `badge=${live.badges_active} pending=${live.pending}` : ''
      );
      report.results.push(entry);
    }
  });

  await closeBrowser().catch(() => {});
  const issues = report.results.filter((r) => r.status !== 'ok');
  const byCause = {};
  for (const r of report.results) byCause[r.cause] = (byCause[r.cause] || 0) + 1;
  report.summary = {
    total: report.results.length,
    ok: report.results.filter((r) => r.status === 'ok').length,
    issues: issues.length,
    fixed: report.results.filter((r) => r.status === 'fixed').length,
    by_cause: byCause,
    affected: issues.map((r) => ({
      name: r.name,
      order_id: r.order_id,
      member_id: r.member_id,
      cause: r.cause,
      status: r.status,
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nécrit', OUT);
  console.log(JSON.stringify(report.summary, null, 2));
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
