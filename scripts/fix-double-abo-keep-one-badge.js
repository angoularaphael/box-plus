#!/usr/bin/env node
'use strict';
/**
 * Doublon abo (actif + en attente) : on garde l’actif, on annule seulement
 * le contrat en attente, puis on pose le Badge s’il manque.
 * Si plus aucun abo (les deux ont été voidés) : on en recréé un + badge.
 *
 *   node scripts/fix-double-abo-keep-one-badge.js --check --since=2026-09-07
 *   node scripts/fix-double-abo-keep-one-badge.js --apply --since=2026-09-07
 *   node scripts/fix-double-abo-keep-one-badge.js --apply --only=bujia
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
const { isOffre29Product, isMonthlyFlexProduct, isAnnualPromoProduct } = require('../lib/sale-contract-match');
const { isComptantStyleProduct } = require('../lib/billing-plan');
const { isCartePrestationOrder } = require('../lib/catalog-sale');
const { loadOrderAsync, applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const {
  findActiveContracts,
  cancelSale,
  cancelOneContract,
  isPendingOrFutureContract,
} = require('../bot/cancel-sale');
const { fetchDeciplusCatalog, resolveBadgeProductConfig } = require('../bot/catalog');
const { buyCarteBadge } = require('../bot/sale');
const { processSaleJob } = require('../bot/index');

const APPLY = process.argv.includes('--apply');
const PENDING_ONLY = process.argv.includes('--pending-only');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-09-07';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const MEMBERS = (process.argv.find((a) => a.startsWith('--members=')) || '').slice(10);
const OUT = path.join(__dirname, '..', 'data', `fix-double-abo-${Date.now()}.json`);

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function isExpiredBadge(label) {
  const t = String(label || '');
  if (/expir[eé]/i.test(t)) return true;
  if (/0 cr[eé]dit restant/i.test(t)) {
    if (/pr[ée]-?d[ée]compt/i.test(t)) return false;
    return true;
  }
  return false;
}

function isBadgeContract(c) {
  return Boolean(c?.isBadge || c?.badge);
}

function activeBadgeCount(contracts) {
  return (contracts || []).filter((c) => isBadgeContract(c) && !isExpiredBadge(c.label)).length;
}

function aboKeepScore(c, t) {
  const label = String(c.label || '');
  let score = 0;
  if (!/expir[eé]/i.test(label)) score += 100;
  if (/jours restants/i.test(label)) score += 80;
  if (t.is29 && /29|duo/i.test(label)) score += 70;
  if (t.isFlex && /44|semaines/i.test(label)) score += 70;
  if (!t.is29 && !t.isFlex && /promo|259|prelevement/i.test(label)) score += 70;
  if (/essai/i.test(label)) score += 10;
  if (/cr[eé]dit restant/i.test(label) && !/expir[eé]/i.test(label)) score += 30;
  score += Number(c.idc) / 10000;
  return score;
}

function pickKeeperAbo(abos, t) {
  return [...abos].sort((a, b) => aboKeepScore(b, t) - aboKeepScore(a, t))[0];
}

async function loadRawContracts(page, memberId, gym) {
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gym).catch(() => {});
  await page.waitForTimeout(600);
  return findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
}

async function cancelListedContracts(page, memberId, gym, contracts, label) {
  const out = [];
  for (const c of contracts) {
    const res = await cancelOneContract(page, c, { forceVoid: true });
    out.push({ idc: c.idc, ...res });
    console.log(`  ${label}`, c.idc, res.cancelled ? 'OK' : res.reason || 'fail');
    await closeGreyboxIfOpen(page).catch(() => {});
    await openMemberCheck(page, memberId, gym).catch(() => {});
  }
  return out;
}

function slim(c) {
  return {
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: !c.isBadge && isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 140),
  };
}

async function loadTargets() {
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

  const byMember = new Map();
  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (!/^BC-/i.test(p.order_id)) continue;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    const member = String(p.deciplus_member_id || '').trim();
    if (!/^\d+$/.test(member)) continue;
    const name = rowName(p);
    if (ONLY) {
      const hay = `${name} ${p.order_id} ${member}`.toLowerCase();
      if (!ONLY.split(',').some((s) => hay.includes(s.trim()))) continue;
    }
    if (MEMBERS) {
      const wanted = new Set(MEMBERS.split(',').map((s) => s.trim()).filter(Boolean));
      if (!wanted.has(member)) continue;
    }
    if (!byMember.has(member)) {
      byMember.set(member, {
        order_id: p.order_id,
        name,
        gym: p.customer_full?.gym || p.gym || 'minimes',
        member_id: member,
        product: p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || '',
        is29: isOffre29Product({
          id: p.product_id || p.product_snapshot?.id,
          name: p.product_snapshot?.name || p.product_name,
          display_name: p.product_snapshot?.display_name,
        }),
        isFlex: isMonthlyFlexProduct({
          id: p.product_id || p.product_snapshot?.id,
          name: p.product_snapshot?.name || p.product_name,
          display_name: p.product_snapshot?.display_name,
        }),
        noBadgeProduct:
          isCartePrestationOrder(p) ||
          isAnnualPromoProduct({
            id: p.product_id || p.product_snapshot?.id,
            name: p.product_snapshot?.name || p.product_name,
            display_name: p.product_snapshot?.display_name,
          }) ||
          isComptantStyleProduct({
            id: p.product_id || p.product_snapshot?.id,
            name: p.product_snapshot?.name || p.product_name,
            display_name: p.product_snapshot?.display_name,
          }),
      });
    }
  }

  const list = [...byMember.values()];
  list.sort((a, b) => {
    const ap = /bujia|tristana/i.test(a.name) ? 0 : 1;
    const bp = /bujia|tristana/i.test(b.name) ? 0 : 1;
    return ap - bp;
  });
  return list;
}

async function snapshot(page, memberId, gym) {
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gym).catch(() => {});
  await page.waitForTimeout(600);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const abos = contracts.filter((c) => !c.isBadge);
  return {
    contracts: contracts.map(slim),
    started: abos.filter((c) => !isPendingOrFutureContract(c.label)).map(slim),
    pending: abos.filter((c) => isPendingOrFutureContract(c.label)).map(slim),
    badges: contracts.filter((c) => c.isBadge).map(slim),
  };
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const targets = await loadTargets();
  console.log(`${APPLY ? 'APPLY' : 'CHECK'} — ${targets.length} fiche(s) depuis ${SINCE}`);
  const report = { at: new Date().toISOString(), apply: APPLY, since: SINCE, results: [] };

  await runWithSession('fix-double-abo-keep-one', async (page) => {
    for (const site of ['Minimes', 'Saint-Cyprien', 'Portet']) {
      try {
        await login(page, { siteLabel: site });
        break;
      } catch {
        /* next */
      }
    }
    const catalog = await fetchDeciplusCatalog(page).catch(() => []);

    for (const t of targets) {
      const gym = getGymConfig(t.gym);
      const site = gym.deciplus_label || 'Minimes';
      console.log('\n===', t.name, t.member_id, site);
      await closeGreyboxIfOpen(page).catch(() => {});
      await switchDeciplusSite(page, site).catch(() => {});
      const before = await snapshot(page, t.member_id, gym);
      const row = { ...t, before, actions: [] };
      const wantsBadge = (Boolean(t.is29) || Boolean(t.isFlex)) && !PENDING_ONLY;
      const needsPendingCancel = before.pending.length > 0 && (before.started.length > 0 || before.pending.length > 1);
      const extraAbo = before.started.length > 1;
      const needsRemoveBadge = Boolean(t.noBadgeProduct) && before.badges.length > 0 && !PENDING_ONLY;
      const needsAbo = !PENDING_ONLY && wantsBadge && before.started.length === 0;
      const needsExtraBadgeDedupe =
        wantsBadge && activeBadgeCount(before.contracts) > 1 && !PENDING_ONLY;
      const needsBadge = wantsBadge && activeBadgeCount(before.contracts) === 0;
      row.needs = {
        pendingCancel: needsPendingCancel,
        extraAbo,
        extraBadge: needsExtraBadgeDedupe,
        removeBadge: needsRemoveBadge,
        recreateAbo: needsAbo,
        badge: needsBadge,
      };

      const issueBits = [];
      if (needsPendingCancel) issueBits.push(`en_attente=${before.pending.length}`);
      if (extraAbo) issueBits.push(`abo_actifs=${before.started.length}`);
      if (needsExtraBadgeDedupe) issueBits.push(`badges=${activeBadgeCount(before.contracts)}`);
      if (needsRemoveBadge) issueBits.push(`badge_interdit=${before.badges.length}`);
      if (!APPLY) {
        if (issueBits.length) {
          row.status = 'needs_fix';
          console.log('  ISSUE', issueBits.join(' '), t.product || '', 'badge', before.badges.length);
        } else {
          row.status = 'ok';
          console.log('  OK', `abo=${before.started.length}`, `pending=${before.pending.length}`, `badge=${before.badges.length}`);
        }
        report.results.push(row);
        continue;
      }

      const nothingToDo =
        !needsPendingCancel &&
        !needsAbo &&
        !needsBadge &&
        !needsRemoveBadge &&
        !extraAbo &&
        !needsExtraBadgeDedupe;
      if (nothingToDo) {
        row.status = 'ok';
        console.log('  OK');
        report.results.push(row);
        continue;
      }

      if (needsPendingCancel) {
        const cancel = await cancelSale(page, t.member_id, {
          pendingOnly: true,
          gymConfig: gym,
          cancelReason: 'change_replace_existing',
        }).catch((err) => ({ error: err.message }));
        row.actions.push({ cancel_pending: cancel });
        console.log('  annulé en attente', cancel?.cancelled_count ?? 0, cancel?.error || '');
      }

      let live = await snapshot(page, t.member_id, gym);

      if (!PENDING_ONLY && live.started.length > 1) {
        const raw = await loadRawContracts(page, t.member_id, gym);
        const started = raw.filter((c) => !c.isBadge && !isPendingOrFutureContract(c.label));
        if (started.length > 1) {
          const keeper = pickKeeperAbo(started, t);
          const extras = started.filter((c) => String(c.idc) !== String(keeper.idc));
          console.log('  garde abo', keeper.idc, 'void', extras.map((c) => c.idc).join(','));
          const cancelled = await cancelListedContracts(page, t.member_id, gym, extras, 'void abo extra');
          row.actions.push({ cancel_extra_abo: { keeper: keeper.idc, cancelled } });
          live = await snapshot(page, t.member_id, gym);
        }
      }

      if (!PENDING_ONLY && wantsBadge && activeBadgeCount(live.contracts) > 1) {
        const raw = await loadRawContracts(page, t.member_id, gym);
        const badges = raw
          .filter((c) => c.isBadge && !isExpiredBadge(c.label))
          .sort((a, b) => Number(a.idc) - Number(b.idc));
        if (badges.length > 1) {
          const keeper = badges[0];
          const extras = badges.slice(1);
          console.log('  garde badge', keeper.idc, 'void', extras.map((c) => c.idc).join(','));
          const cancelled = await cancelListedContracts(page, t.member_id, gym, extras, 'void badge extra');
          row.actions.push({ cancel_extra_badge: { keeper: keeper.idc, cancelled } });
          live = await snapshot(page, t.member_id, gym);
        }
      }
      if (!PENDING_ONLY && live.started.length === 0) {
        const raw = await loadOrderAsync(t.order_id);
        const hydrated = await hydrateOrderMedia(raw);
        const product = raw.product_snapshot || { id: raw.product_id, name: raw.product_name };
        const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
        payload.deciplus_member_id = t.member_id;
        payload.force_new_member = false;
        payload.force_requeue = true;
        payload.force_sale_retry = true;
        payload.paiement_comptant = false;
        delete payload.deciplus_sale_id;
        const order = normalizeOrder(payload);
        order.paiement_comptant = false;
        order.force_sale_retry = true;
        console.log('  recréation 1 abo (pas de void de l’existant)');
        const outcome = await processSaleJob(page, order, {});
        row.actions.push({
          recreate: {
            status: outcome.status,
            sale_id: outcome.deciplus_sale_id,
            error: outcome.error || null,
          },
        });
        if (outcome.deciplus_sale_id) {
          await applyBotSaleStatus(t.order_id, {
            deciplus_member_id: outcome.deciplus_member_id || t.member_id,
            deciplus_sale_id: outcome.deciplus_sale_id,
            status: 'success',
            error: outcome.error || null,
          }).catch(() => {});
        }
      }

      live = await snapshot(page, t.member_id, gym);
      if (!PENDING_ONLY && wantsBadge && activeBadgeCount(live.contracts) === 0 && live.started.length + live.pending.length > 0) {
        const badgeCfg = resolveBadgeProductConfig(catalog, {
          badge_timing: 'deferred',
          badge_method: 'iban',
        });
        console.log('  pose badge');
        const badge = await buyCarteBadge(page, badgeCfg, gym, t.member_id).catch((err) => ({
          error: err.message,
        }));
        row.actions.push({ badge });
      }

      const after = await snapshot(page, t.member_id, gym);
      row.after = after;
      const badgeOk = !wantsBadge || activeBadgeCount(after.contracts) <= 1;
      row.status =
        after.pending.length === 0 && after.started.length === 1 && badgeOk
          ? 'fixed'
          : after.started.length >= 1
            ? 'partial'
            : 'still_broken';
      console.log(
        '  AFTER',
        row.status,
        'abo',
        after.started.length,
        'pending',
        after.pending.length,
        'badge',
        after.badges.length
      );
      report.results.push(row);
    }
  });

  await closeBrowser().catch(() => {});
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const todo = report.results.filter((r) => r.status !== 'ok');
  console.log('\nécrit', OUT);
  console.log(
    JSON.stringify(
      {
        total: report.results.length,
        ok: report.results.filter((r) => r.status === 'ok').length,
        todo: todo.map((r) => ({
          name: r.name,
          status: r.status,
          needs: r.needs,
          pending: (r.after || r.before).pending.length,
          started: (r.after || r.before).started.length,
          badge: (r.after || r.before).badges.length,
        })),
      },
      null,
      2
    )
  );
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
