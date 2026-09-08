#!/usr/bin/env node
'use strict';
/**
 * Rattrapage ciblé :
 * - Juliette Yol : 259 € payé mais ancien 44,99 € conservé (prélèvement) → Minimes + OFFRE PROMO 12MOIS
 * - Océane TESTAN : encore sur Balma, abos/badge résiliés sans nouvelle vente → Minimes + OFFRE 29 € + badge
 *
 *   node scripts/fix-yol-testan-balma.js --check
 *   node scripts/fix-yol-testan-balma.js
 *   node scripts/fix-yol-testan-balma.js --only=yol|testan
 */
require('dotenv').config();
process.env.BOXPLUS_BALMA_MIGRATION_LOOKUP = '1';
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
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const { applyBillingPlanToProductConfig, orderNeedsAutoBadge } = require('../lib/billing-plan');
const { isPendingOrFutureContract, cancelOneContract } = require('../bot/cancel-sale');
const {
  loadOrderAsync,
  applyBotSaleStatus,
} = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { detectMemberGymConfig, searchMember, searchMemberByName } = require('../bot/member');
const { migrateMemberToGym } = require('../bot/migrate-gym');
const { findActiveContracts } = require('../bot/cancel-sale');
const { recordSale, isActiveMembershipContract, buyCarteBadge } = require('../bot/sale');
const { fetchDeciplusCatalog, resolveProductConfig, resolveBadgeProductConfig } = require('../bot/catalog');

const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `fix-yol-testan-balma-${Date.now()}.json`);

const TARGETS = [
  {
    key: 'yol',
    order_id: 'BC-1788792666101-3813eb',
    member_id: '20204',
    email: 'juliette.y10@gmail.com',
    first_name: 'Juliette',
    last_name: 'Yol',
    gym: 'minimes',
    search_sites: ['St-Cyprien', 'Minimes', 'Portet'],
  },
  {
    key: 'testan',
    order_id: 'BC-1788362526212-819651',
    member_id: '19046',
    email: 'oceanesonia974@gmail.com',
    first_name: 'Océane',
    last_name: 'TESTAN',
    gym: 'minimes',
    search_sites: ['Minimes', 'Etats-Unis', 'St-Cyprien'],
  },
];

function slim(c) {
  return {
    idc: c.idc,
    badge: Boolean(c.isBadge),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  };
}

async function loadOrder(orderId) {
  const sb = getSupabase();
  const { data, error } = await sb.from('boxplus_orders').select('payload').eq('order_id', orderId).single();
  if (error) throw error;
  return data.payload || {};
}

async function locateMember(page, t) {
  const sites = t.search_sites.map((name) => {
    const slug = name.toLowerCase().replace('st-cyprien', 'st-cyprien').replace('états-unis', 'etats-unis');
    const key =
      slug === 'st-cyprien'
        ? 'st-cyprien'
        : slug === 'états-unis' || slug === 'etats-unis'
          ? 'etats-unis'
          : slug;
    return { name, cfg: getGymConfig(key) };
  });

  for (const site of sites) {
    await closeGreyboxIfOpen(page).catch(() => {});
    const switched = await switchDeciplusSite(page, site.name, {
      allowBalmaLookup: /balma/i.test(site.name),
    }).catch(() => false);
    if (!switched) continue;

    if (t.member_id) {
      await openMemberCheck(page, String(t.member_id), site.cfg).catch(() => {});
      await page.waitForTimeout(900);
      const live = await detectMemberGymConfig(page, site.cfg).catch(() => null);
      if (live?.deciplus_label || live?.deciplus_zone_id) {
        return { member_id: String(t.member_id), via: 'id', site: site.name, cfg: live || site.cfg };
      }
    }

    let hit = null;
    if (t.email) {
      const found = await searchMember(page, t.email).catch(() => null);
      if (found?.found && found.member_id) hit = found;
    }
    if (!hit && t.last_name) {
      const found = await searchMemberByName(page, t.last_name, t.first_name).catch(() => null);
      if (found?.found && found.member_id) hit = found;
    }
    if (hit?.member_id) {
      await openMemberCheck(page, hit.member_id, site.cfg).catch(() => {});
      await page.waitForTimeout(900);
      const live = await detectMemberGymConfig(page, site.cfg).catch(() => site.cfg);
      return {
        member_id: String(hit.member_id),
        via: t.email ? 'email' : 'name',
        site: site.name,
        cfg: live || site.cfg,
      };
    }
  }
  return null;
}

async function ensureMinimes(page, target, report) {
  const hit = await locateMember(page, target);
  if (!hit) throw new Error(`Fiche ${target.member_id} introuvable (${target.search_sites.join(', ')})`);
  report.locate = { via: hit.via, site: hit.site, zone: hit.cfg?.deciplus_zone_id || null };
  const memberId = hit.member_id;
  report.before_site = hit.site;
  report.before_zone = hit.cfg?.deciplus_zone_id || null;
  const minimes = getGymConfig('minimes');
  const onMinimes = String(hit.cfg?.deciplus_zone_id) === '2' || /minimes/i.test(hit.cfg?.deciplus_label || '');
  if (!onMinimes && !CHECK) {
    const mig = await migrateMemberToGym(page, memberId, minimes).catch((err) => ({
      ok: false,
      error: err.message,
    }));
    report.migrate = mig;
    await switchDeciplusSite(page, 'Minimes').catch(() => {});
    await openMemberCheck(page, memberId, minimes);
    await page.waitForTimeout(900);
  } else if (!onMinimes) {
    report.migrate = { ok: false, would_migrate: true, from: hit.site };
  }
  const afterSite = await detectMemberGymConfig(page, minimes).catch(() => minimes);
  report.after_site = afterSite?.deciplus_label || 'Minimes';
  report.after_zone = afterSite?.deciplus_zone_id || null;
  return { gymConfig: getGymConfig('minimes'), memberId };
}

function julietteOrder(payload) {
  const cs = payload.customer_short || {};
  const cf = payload.customer_full || {};
  const pay = payload.payment || {};
  return {
    order_id: 'BC-1788792666101-3813eb',
    product_id: 'offre-saison',
    product_name: 'Promo 12 mois — 259 €',
    deciplus_product_search: 'OFFRE PROMO 12',
    gym: 'minimes',
    deciplus_member_id: '20204',
    paiement_comptant: false,
    requires_iban: true,
    auto_badge: false,
    billing_plan: pay.billing_plan || 'rib',
    payment: {
      status: 'paid',
      amount: 259,
      method: pay.method || 'payplug',
      payment_plan: pay.payment_plan || '4x',
      billing_plan: pay.billing_plan || 'rib',
      iban: pay.iban || cf.iban || null,
      paid_at: pay.paid_at || null,
    },
    customer: {
      first_name: cs.first_name || cf.first_name || 'Juliette',
      last_name: cs.last_name || cf.last_name || 'Yol',
      email: cs.email || cf.email,
      phone: cs.phone || cf.phone,
      birthdate: cs.birthdate || cf.birthdate,
      iban: pay.iban || cf.iban || null,
    },
    signature: payload.signature || { signed_at: payload.signed_at || new Date().toISOString() },
    source: 'fix-yol-testan-balma',
  };
}

async function fixJuliette(page, catalog, payload, report) {
  const { gymConfig, memberId } = await ensureMinimes(page, TARGETS[0], report);
  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  report.before = before.map(slim);
  const order = julietteOrder(payload);
  const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
  productConfig.auto_badge = false;
  productConfig.paiement_comptant = false;
  productConfig.skip_rib_prompt = true;
  const classified = classifyMemberContracts(before, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
    replaceExisting: true,
  });
  report.classified = {
    needsNewSale: classified.needsNewSale,
    toCancel: classified.toCancel.map((c) => slim(c)),
    matching: classified.matchingStarted.map((c) => slim(c)),
  };

  const hasPromo = classified.matchingStarted.some((c) => /promo|259|12\s*mois/i.test(c.label));
  if (hasPromo && !classified.otherActive.length) {
    const saleId = classified.matchingStarted[0]?.idc;
    report.status = 'already_ok';
    if (!CHECK && saleId) {
      await applyBotSaleStatus(order.order_id, {
        deciplus_member_id: '20204',
        deciplus_sale_id: saleId,
        status: 'success',
        error: null,
      });
    }
    return report;
  }

  if (CHECK) {
    report.status = 'needs_fix';
    return report;
  }

  for (const c of classified.toCancel) {
    const res = await cancelOneContract(page, c, { forceVoid: true });
    report.actions = report.actions || [];
    report.actions.push({ cancel: { idc: c.idc, ...res } });
    await closeGreyboxIfOpen(page).catch(() => {});
    await openMemberCheck(page, memberId, gymConfig);
  }

  const sale = await recordSale(page, order, productConfig, memberId, gymConfig, {
    badgeProductConfig: null,
    forceNewSale: true,
  });
  report.sale = {
    sale_id: sale.sale_id || null,
    action: sale.action || null,
    error: sale.error || null,
  };

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  report.after = after.map(slim);
  const promo = after.filter(
    (c) => !c.isBadge && isActiveMembershipContract(c) && /promo|259|12\s*mois/i.test(c.label)
  );
  const wrong = after.filter(
    (c) => !c.isBadge && isActiveMembershipContract(c) && /44[,.]?99|semaines/i.test(c.label)
  );
  const saleId = promo[0]?.idc || sale.sale_id || null;
  report.status = promo.length === 1 && wrong.length === 0 ? 'fixed' : 'partial';
  await applyBotSaleStatus(order.order_id, {
    deciplus_member_id: memberId,
    deciplus_sale_id: saleId || undefined,
    status: report.status === 'fixed' ? 'success' : 'manual_review',
    error: report.status === 'fixed' ? null : `promo=${promo.length} wrong=${wrong.length}`,
  });
  return report;
}

async function fixOceane(page, catalog, report) {
  const { gymConfig, memberId } = await ensureMinimes(page, TARGETS[1], report);
  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  report.before = before.map(slim);
  const activeAbo = before.filter((c) => !c.isBadge && isActiveMembershipContract(c));
  const activeBadge = before.filter((c) => c.isBadge && isActiveMembershipContract(c));

  if (activeAbo.length === 1 && activeBadge.length === 1 && /29|duo/i.test(activeAbo[0].label)) {
    report.status = 'already_ok';
    if (!CHECK) {
      await applyBotSaleStatus('BC-1788362526212-819651', {
        deciplus_member_id: memberId,
        deciplus_sale_id: activeAbo[0].idc,
        status: 'success',
        error: null,
      });
    }
    return report;
  }

  if (CHECK) {
    report.status = activeAbo.length ? 'partial' : 'needs_fix';
    return report;
  }

  const raw = await loadOrderAsync('BC-1788362526212-819651');
  const hydrated = await hydrateOrderMedia(raw);
  const product = raw.product_snapshot || { id: raw.product_id, name: raw.product_name };
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  payload.deciplus_member_id = memberId;
  payload.gym = 'minimes';
  payload.paiement_comptant = false;
  delete payload.deciplus_sale_id;
  const order = normalizeOrder(payload);
  order.paiement_comptant = false;
  order.payment = { ...(order.payment || {}), status: 'paid' };
  const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
  productConfig.paiement_comptant = false;
  productConfig.auto_badge = orderNeedsAutoBadge(order, productConfig);
  productConfig.skip_rib_prompt = true;
  let badgeProductConfig = null;
  if (productConfig.auto_badge) {
    badgeProductConfig = resolveBadgeProductConfig(catalog, {
      badge_timing: 'deferred',
      badge_method: 'iban',
    });
  }

  const sale = await recordSale(page, order, productConfig, memberId, gymConfig, {
    badgeProductConfig,
    forceNewSale: true,
  });
  report.recreate = {
    sale_id: sale.sale_id || null,
    action: sale.action || null,
    badge_action: sale.badge_action || null,
    badge_sale_id: sale.badge_sale_id || null,
    error: sale.error || sale.badge_error || null,
  };

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  let after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  let abo = after.filter((c) => !c.isBadge && isActiveMembershipContract(c));
  let badge = after.filter((c) => c.isBadge && isActiveMembershipContract(c));

  if (abo.length >= 1 && badge.length === 0) {
    const badgeCfg = resolveBadgeProductConfig(catalog, {
      badge_timing: 'deferred',
      badge_method: 'iban',
    });
    const badgeRes = await buyCarteBadge(page, badgeCfg, gymConfig, memberId).catch((err) => ({
      error: err.message,
    }));
    report.badge = badgeRes;
    after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
    abo = after.filter((c) => !c.isBadge && isActiveMembershipContract(c));
    badge = after.filter((c) => c.isBadge && isActiveMembershipContract(c));
  }

  report.after = after.map(slim);
  const saleId = sale.sale_id || abo[0]?.idc || null;
  report.status = abo.length === 1 && badge.length === 1 ? 'fixed' : 'partial';
  await applyBotSaleStatus('BC-1788362526212-819651', {
    deciplus_member_id: memberId,
    deciplus_sale_id: saleId || undefined,
    status: report.status === 'fixed' ? 'success' : 'manual_review',
    error: report.status === 'fixed' ? null : `abo=${abo.length} badge=${badge.length}`,
  });
  return report;
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const report = { at: new Date().toISOString(), check: CHECK, results: [] };
  await runWithSession('fix-yol-testan-balma', async (page) => {
    for (const site of ['Minimes', 'St-Cyprien']) {
      try {
        await login(page, { siteLabel: site });
        break;
      } catch {
        /* next */
      }
    }
    const catalog = await fetchDeciplusCatalog(page);

    if (!ONLY || ONLY.includes('yol')) {
      const payload = await loadOrder('BC-1788792666101-3813eb');
      const row = { name: 'Juliette Yol', key: 'yol', actions: [] };
      try {
        Object.assign(row, await fixJuliette(page, catalog, payload, row));
      } catch (err) {
        row.status = 'error';
        row.error = err.message;
      }
      report.results.push(row);
      console.log('Juliette Yol', row.status, row.error || '');
    }

    if (!ONLY || ONLY.includes('testan')) {
      const row = { name: 'Océane TESTAN', key: 'testan', actions: [] };
      try {
        Object.assign(row, await fixOceane(page, catalog, row));
      } catch (err) {
        row.status = 'error';
        row.error = err.message;
      }
      report.results.push(row);
      console.log('Océane TESTAN', row.status, row.error || '');
    }
  });

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Rapport', OUT);
  await closeBrowser().catch(() => {});
  const bad = report.results.filter((r) => !['fixed', 'already_ok'].includes(r.status));
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
