#!/usr/bin/env node
'use strict';
/**
 * Balma / États-Unis (ex. Cyril Demaria) → Minimes.
 * Analyse toutes les ventes, migre la fiche Deciplus, n’empile pas d’abo.
 *
 *   node scripts/migrate-balma-etats-unis-to-minimes.js --check
 *   node scripts/migrate-balma-etats-unis-to-minimes.js --apply --since=2026-08-01
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const tmpPw = path.join(__dirname, '..', 'data', 'tmp-pw');
fs.mkdirSync(tmpPw, { recursive: true });
process.env.TEMP = tmpPw;
process.env.TMP = tmpPw;
process.env.TMPDIR = tmpPw;
if (!process.env.BOT_SESSION_DIR) {
  const dst = path.join(__dirname, '..', 'data', 'session-mig-minimes');
  fs.mkdirSync(dst, { recursive: true });
  const src = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dst, 'storage-state.json'));
  process.env.BOT_SESSION_DIR = dst;
}

const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { existingSiteConfig, isEtatsUnisDeciplusSite } = require('../lib/deciplus-sites');
const { isBalmaSaleTarget } = require('../lib/gym-slugs');
const { isAventureOrder } = require('../lib/aventure-policy');
const { isBalmaRetourOrder } = require('../lib/balma');
const { isOffre29Product, isMonthlyFlexProduct, isAnnualPromoProduct } = require('../lib/sale-contract-match');
const { isComptantStyleProduct } = require('../lib/billing-plan');
const { isCartePrestationOrder } = require('../lib/catalog-sale');
const { updateGymAsync } = require('../storefront/lib/order-lifecycle');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const {
  findActiveContracts,
  cancelSale,
  isPendingOrFutureContract,
} = require('../bot/cancel-sale');
const {
  searchMember,
  searchMemberByName,
  detectMemberGymConfig,
} = require('../bot/member');
const { migrateMemberToGym } = require('../bot/migrate-gym');

const APPLY = process.argv.includes('--apply');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-01';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `migrate-minimes-${Date.now()}.json`);
const LOG = path.join(__dirname, '..', 'data', 'migrate-minimes.log');

function logLine(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.log(line);
  try {
    fs.appendFileSync(LOG, `${line}\n`);
  } catch {
    /* disk */
  }
}

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function orderGym(p) {
  return String(p.customer_full?.gym || p.gym || p.customer?.gym || '').toLowerCase();
}

function isCohort(p) {
  const g = orderGym(p);
  return g === 'etats-unis' || g === 'balma' || isAventureOrder(p) || isBalmaRetourOrder(p);
}

function slim(c) {
  return {
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: !c.isBadge && isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  };
}

function asGymCfg(site) {
  if (!site) return {};
  return {
    key: site.key || null,
    deciplus_label: site.label || site.deciplus_label || site.site || null,
    deciplus_zone_id: site.zone || site.deciplus_zone_id || null,
    label: site.label || site.deciplus_label || null,
  };
}

function needsMigrate(siteCfg) {
  const cfg = asGymCfg(siteCfg);
  if (!cfg.deciplus_label && !cfg.deciplus_zone_id) return false;
  const z = String(cfg.deciplus_zone_id || '');
  if (z === '1' || z === '7') return true;
  if (isBalmaSaleTarget(cfg, {})) return true;
  if (isEtatsUnisDeciplusSite(cfg)) return true;
  return false;
}

function siteLabel(cfg) {
  if (!cfg) return null;
  return {
    key: cfg.key || null,
    label: cfg.deciplus_label || cfg.label || null,
    zone: cfg.deciplus_zone_id || null,
  };
}

function searchSites(t = {}) {
  const minimes = getGymConfig('minimes');
  const balma = getGymConfig('balma');
  const eu = existingSiteConfig(getGymConfig('etats-unis'));
  const euSite = {
    name: eu?.deciplus_label || 'Etats-Unis',
    cfg: eu || { deciplus_label: 'Etats-Unis', deciplus_zone_id: '7' },
  };
  const balmaSite = { name: 'Balma', cfg: balma };
  const minimesSite = { name: 'Minimes', cfg: minimes };
  const ordered =
    t.gym && t.gym !== 'balma' && t.gym !== 'etats-unis' ? getGymConfig(t.gym) : null;

  const mid = Number(t.member_id || 0);
  const legacyBalma = mid > 0 && mid < 15000;
  const etatsUnisOrder = String(t.gym || '').toLowerCase() === 'etats-unis';

  // Anciens membres Balma (ex. Cyril Demaria #14370) : chercher Balma en premier.
  let core =
    legacyBalma || etatsUnisOrder
      ? [balmaSite, minimesSite, euSite]
      : [minimesSite, balmaSite, euSite];

  if (ordered?.deciplus_label) {
    const label = ordered.deciplus_label;
    if (!core.some((s) => s.name === label)) {
      core = [{ name: label, cfg: ordered }, ...core];
    }
  }
  return core;
}

async function snapshot(page, memberId, gymCfg) {
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymCfg).catch(() => {});
  await page.waitForTimeout(700);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const abos = contracts.filter((c) => !c.isBadge);
  return {
    contracts: contracts.map(slim),
    started: abos.filter((c) => !isPendingOrFutureContract(c.label)).map(slim),
    pending: abos.filter((c) => isPendingOrFutureContract(c.label)).map(slim),
    badges: contracts.filter((c) => c.isBadge).map(slim),
    site: siteLabel(await detectMemberGymConfig(page, null).catch(() => gymCfg)),
  };
}

async function memberFicheLooksOpen(page) {
  const body = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 600);
  return /Achat Abonnement|fiche membre|Coordonnées|Contrats en cours/i.test(body);
}

async function locateMember(page, t) {
  const found = [];
  const seen = new Set();
  const hasId = t.member_id && /^\d+$/.test(String(t.member_id));
  const sites = searchSites(t);

  const remember = async (hit, site, cfg) => {
    const key = `${hit.member_id}@${site.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    await openMemberCheck(page, hit.member_id, cfg).catch(() => {});
    hit.live = siteLabel(await detectMemberGymConfig(page, null).catch(() => cfg));
    found.push(hit);
  };

  for (const site of sites) {
    await closeGreyboxIfOpen(page).catch(() => {});
    const switched = await switchDeciplusSite(page, site.name).catch(() => false);
    if (!switched) continue;
    if (hasId) {
      await openMemberCheck(page, String(t.member_id), site.cfg).catch(() => {});
      if (await memberFicheLooksOpen(page)) {
        await remember(
          { member_id: String(t.member_id), via: 'id', site: site.name },
          site,
          site.cfg
        );
        const live = found[found.length - 1]?.live;
        if (String(live?.zone) === '2' || /minimes/i.test(live?.label || '')) {
          return found;
        }
        if (needsMigrate(live)) {
          return found;
        }
      }
    }
    if (hasId && found.length) continue;
    let hit = null;
    if (t.email) {
      const s = await searchMember(page, t.email).catch(() => null);
      if (s?.found && s.member_id) hit = { member_id: String(s.member_id), via: 'email', site: site.name };
    }
    if (!hit && t.last_name) {
      const s = await searchMemberByName(page, t.last_name, t.first_name).catch(() => null);
      if (s?.found && s.member_id) hit = { member_id: String(s.member_id), via: 'name', site: site.name };
    }
    if (hit) {
      await remember(hit, site, site.cfg);
      const live = found[found.length - 1]?.live;
      if (String(live?.zone) === '2' || needsMigrate(live)) return found;
    }
  }
  return found;
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
      .order('created_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 500) break;
    from += 500;
  }

  const byKey = new Map();
  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (!/^BC-/i.test(p.order_id)) continue;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (!isCohort(p)) continue;
    const cs = p.customer_short || {};
    const cf = p.customer_full || {};
    const name = rowName(p);
    if (ONLY) {
      const hay = `${name} ${p.order_id} ${p.deciplus_member_id || ''}`.toLowerCase();
      if (!ONLY.split(',').some((s) => hay.includes(s.trim()))) continue;
    }
    const product = {
      id: p.product_id || p.product_snapshot?.id,
      name: p.product_snapshot?.name || p.product_name,
      display_name: p.product_snapshot?.display_name,
    };
    const key = String(p.deciplus_member_id || `${cs.email || cf.email || name}`).toLowerCase();
    const prev = byKey.get(key);
    const row = {
      order_id: p.order_id,
      name,
      first_name: cs.first_name || cf.first_name || '',
      last_name: cs.last_name || cf.last_name || '',
      email: cs.email || cf.email || '',
      gym: orderGym(p),
      member_id: String(p.deciplus_member_id || '').replace(/\D/g, '') || null,
      sale_id: p.deciplus_sale_id || null,
      product: product.display_name || product.name || '',
      amount: p.payment?.amount ?? null,
      signed: Boolean(p.signature?.signed_at),
      source: p.source || null,
      aventure: Boolean(p.aventure || isAventureOrder(p)),
      created_at: r.created_at,
      is29: isOffre29Product(product),
      isFlex: isMonthlyFlexProduct(product),
      noBadge:
        isCartePrestationOrder(p) ||
        isAnnualPromoProduct(product) ||
        isComptantStyleProduct(product),
    };
    if (!prev || String(r.created_at) > String(prev.created_at)) byKey.set(key, row);
  }
  const list = [...byKey.values()];
  list.sort((a, b) => {
    const score = (x) => {
      if (/demaria|cyril/i.test(x.name)) return 0;
      if (x.gym === 'balma') return 1;
      if (x.gym === 'etats-unis') return 2;
      return 3;
    };
    return score(a) - score(b) || String(b.created_at).localeCompare(String(a.created_at));
  });
  return list;
}

(async () => {
  try {
    fs.writeFileSync(LOG, '');
  } catch {
    /* ignore */
  }
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const tmp = path.join(__dirname, '..', 'data', 'tmp-pw');
  fs.mkdirSync(tmp, { recursive: true });
  process.env.TEMP = tmp;
  process.env.TMP = tmp;
  process.env.TMPDIR = tmp;

  const minimes = getGymConfig('minimes');
  const targets = await loadTargets();
  logLine(`${APPLY ? 'APPLY' : 'CHECK'} — ${targets.length} personne(s) Balma/États-Unis/Aventure depuis ${SINCE}`);
  const report = { at: new Date().toISOString(), apply: APPLY, since: SINCE, results: [] };

  await runWithSession('migrate-balma-etats-unis-minimes', async (page) => {
    for (const site of ['Minimes', 'Etats-Unis', 'Balma']) {
      try {
        await login(page, { siteLabel: site });
        break;
      } catch {
        /* next */
      }
    }

    for (const t of targets) {
      logLine('\n===', t.name, t.order_id, t.gym, t.product || '', t.member_id || 'no-id');
      const row = { ...t, hits: [], actions: [] };
      try {
        const hits = await locateMember(page, t);
        row.hits = hits;
        const minimesHit = hits.find((h) => String(h.live?.zone) === '2' || /minimes/i.test(h.live?.label || h.site || ''));
        const migrateHit =
          hits.find((h) => needsMigrate(h.live)) ||
          hits.find((h) => /balma|etats/i.test(`${h.site} ${h.live?.label || ''}`));
        const chosen = migrateHit || minimesHit || hits[0];
        if (!chosen?.member_id) {
          row.status = 'no_member';
          logLine('  INTROUVABLE Balma / États-Unis / Minimes');
          report.results.push(row);
          continue;
        }
        row.member_id = chosen.member_id;
        const beforeGym = {
          deciplus_label: chosen.live?.label || chosen.site,
          deciplus_zone_id: chosen.live?.zone || null,
          key: String(chosen.site || '').toLowerCase(),
        };
        const before = await snapshot(page, chosen.member_id, beforeGym);
        row.before = before;
        logLine(
          '  VENTES',
          `site=${before.site?.label || '?'}#${before.site?.zone || '?'}`,
          `abo=${before.started.length}`,
          `attente=${before.pending.length}`,
          `badge=${before.badges.length}`
        );
        for (const c of before.contracts) {
          logLine('   -', c.pending ? 'ATTENTE' : c.badge ? 'BADGE' : 'ACTIF', c.idc, c.label);
        }

        const onMinimes = String(before.site?.zone) === '2' || /minimes/i.test(before.site?.label || '');
        const wouldDuplicate =
          Boolean(minimesHit) &&
          Boolean(migrateHit) &&
          String(minimesHit.member_id) !== String(migrateHit.member_id);

        if (wouldDuplicate) {
          row.status = 'aventure_deux_fiches';
          logLine('  SKIP migrate — fiche Minimes déjà là', minimesHit.member_id, '+ fiche', migrateHit.site, migrateHit.member_id);
          const minSnap = await snapshot(page, minimesHit.member_id, minimes);
          row.minimes = minSnap;
          report.results.push(row);
          continue;
        }

        if (APPLY && !onMinimes && needsMigrate(before.site || asGymCfg(beforeGym))) {
          logLine('  MIGRE → Minimes');
          const mig = await migrateMemberToGym(page, chosen.member_id, minimes).catch((err) => ({
            ok: false,
            error: err.message,
          }));
          row.actions.push({ migrate: mig });
          logLine('  migrate', mig?.ok ? 'OK' : mig?.error || mig);
        }

        const afterGym = onMinimes && !APPLY ? beforeGym : minimes;
        let after = await snapshot(page, chosen.member_id, afterGym);
        row.after = after;

        const pendingStacked = after.pending.length > 0 && (after.started.length > 0 || after.pending.length > 1);
        if (APPLY && pendingStacked) {
          logLine('  ANNULE en attente seulement');
          const cancel = await cancelSale(page, chosen.member_id, {
            pendingOnly: true,
            gymConfig: minimes,
            cancelReason: 'change_replace_existing',
          }).catch((err) => ({ error: err.message }));
          row.actions.push({ cancel_pending: cancel });
          after = await snapshot(page, chosen.member_id, minimes);
          row.after = after;
        }

        const nowMinimes = String((row.after || after).site?.zone) === '2' || /minimes/i.test((row.after || after).site?.label || '');
        if (APPLY && nowMinimes && t.gym !== 'minimes') {
          await updateGymAsync(t.order_id, 'minimes').catch((err) => {
            row.actions.push({ gym_patch_error: err.message });
          });
          row.actions.push({ gym_patched: 'minimes' });
        }

        const live = row.after || after;
        const issues = [];
        if (!nowMinimes) issues.push(`encore_${live.site?.label || live.site?.zone || 'ailleurs'}`);
        if (live.pending.length) issues.push(`en_attente=${live.pending.length}`);
        if (live.started.length > 1) issues.push(`abo_actifs=${live.started.length}`);
        if (t.noBadge && live.badges.length) issues.push(`badge_interdit=${live.badges.length}`);
        row.status = issues.length ? `ISSUE ${issues.join(' ')}` : 'ok_minimes';
        logLine('  →', row.status, `abo=${live.started.length}`, `attente=${live.pending.length}`, `badge=${live.badges.length}`);
      } catch (err) {
        row.status = 'error';
        row.error = err.message;
        logLine('  ERR', err.message);
      }
      report.results.push(row);
      try {
        fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      } catch {
        /* disk */
      }
    }
  });

  await closeBrowser().catch(() => {});
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const summary = {
    file: OUT,
    total: report.results.length,
    ok: report.results.filter((r) => r.status === 'ok_minimes').length,
    todo: report.results
      .filter((r) => r.status !== 'ok_minimes')
      .map((r) => ({ name: r.name, status: r.status, gym: r.gym, member_id: r.member_id })),
  };
  logLine('\nFIN', JSON.stringify(summary));
})().catch(async (err) => {
  logLine('FATAL', err.message || err);
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
