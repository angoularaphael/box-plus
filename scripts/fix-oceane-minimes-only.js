#!/usr/bin/env node
'use strict';
/**
 * Océane TESTAN — MINIMES UNIQUEMENT.
 * 1) Si encore sur Balma → migration Balma → Minimes (jamais l'inverse)
 * 2) Vente OFFRE 29 € + badge sur Minimes seulement
 *
 *   node scripts/fix-oceane-minimes-only.js --check
 *   node scripts/fix-oceane-minimes-only.js
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
const { getGymConfig, normalizeOrder } = require('../lib/normalize');
const { isBalmaSaleTarget } = require('../lib/gym-slugs');
const { applyBillingPlanToProductConfig, orderNeedsAutoBadge } = require('../lib/billing-plan');
const { loadOrderAsync, applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { hydrateOrderMedia, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { detectMemberGymConfig } = require('../bot/member');
const { migrateMemberToGym } = require('../bot/migrate-gym');
const { findActiveContracts } = require('../bot/cancel-sale');
const { recordSale, isActiveMembershipContract, isActiveBadgeContract, buyCarteBadge } = require('../bot/sale');
const { fetchDeciplusCatalog, resolveProductConfig, resolveBadgeProductConfig } = require('../bot/catalog');

const CHECK = process.argv.includes('--check');
const MEMBER_ID = '19046';
const ORDER_ID = 'BC-1788362526212-819651';
const OUT = path.join(__dirname, '..', 'data', `fix-oceane-minimes-only-${Date.now()}.json`);

function slim(c) {
  return {
    idc: c.idc,
    badge: Boolean(c.isBadge),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  };
}

function onMinimes(site) {
  return String(site?.deciplus_zone_id || site?.zone) === '2' || /minimes/i.test(site?.deciplus_label || site?.site || '');
}

async function openOnMinimes(page) {
  const minimes = getGymConfig('minimes');
  await closeGreyboxIfOpen(page).catch(() => {});
  await switchDeciplusSite(page, 'Minimes');
  await openMemberCheck(page, MEMBER_ID, minimes);
  await page.waitForTimeout(1200);
  const live = await detectMemberGymConfig(page, minimes).catch(() => null);
  return { minimes, live };
}

async function ensureOnMinimes(page, report) {
  const minimes = getGymConfig('minimes');
  let { live } = await openOnMinimes(page);
  report.open_minimes = { zone: live?.deciplus_zone_id, label: live?.deciplus_label };

  if (onMinimes(live)) {
    report.site = 'Minimes';
    return minimes;
  }

  // Dernière chance ops : ouvrir Balma UNIQUEMENT si BOXPLUS_BALMA_MIGRATION_LOOKUP=1
  const { balmaMigrationLookupAllowed } = require('../lib/gym-slugs');
  if (!balmaMigrationLookupAllowed()) {
    throw new Error(
      `Fiche ${MEMBER_ID} pas sur Minimes — ouverture Balma interdite (BOXPLUS_BALMA_MIGRATION_LOOKUP=1 pour migration ops)`
    );
  }
  const balma = getGymConfig('balma');
  await closeGreyboxIfOpen(page).catch(() => {});
  await switchDeciplusSite(page, 'Balma', { allowBalmaLookup: true }).catch(() => {});
  await openMemberCheck(page, MEMBER_ID, balma);
  await page.waitForTimeout(1200);
  live = await detectMemberGymConfig(page, balma).catch(() => null);
  report.open_balma = { zone: live?.deciplus_zone_id, label: live?.deciplus_label };

  if (!onMinimes(live) && isBalmaSaleTarget(live || balma, {})) {
    if (CHECK) {
      report.would_migrate = true;
      throw new Error('Encore sur Balma — migration Minimes requise');
    }
    const mig = await migrateMemberToGym(page, MEMBER_ID, minimes);
    report.migrate = mig;
    if (!mig?.ok) throw new Error(`Migration Balma→Minimes échouée: ${mig?.error || 'inconnue'}`);
  }

  ({ live } = await openOnMinimes(page));
  if (!onMinimes(live)) {
    throw new Error(`Fiche ${MEMBER_ID} pas sur Minimes (zone=${live?.deciplus_zone_id || '?'})`);
  }
  report.site = 'Minimes';
  return minimes;
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const report = { member_id: MEMBER_ID, order_id: ORDER_ID, check: CHECK };
  await runWithSession('fix-oceane-minimes-only', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    const gymConfig = await ensureOnMinimes(page, report);

    const before = await findActiveContracts(page).catch(() => []);
    report.before = before.map(slim);
    const abo = before.filter((c) => !c.isBadge && isActiveMembershipContract(c));
    const badge = before.filter((c) => c.isBadge && isActiveBadgeContract(c));

    if (abo.length === 1 && badge.length === 1 && /29|duo/i.test(abo[0].label)) {
      report.status = 'already_ok';
      if (!CHECK) {
        await applyBotSaleStatus(ORDER_ID, {
          deciplus_member_id: MEMBER_ID,
          deciplus_sale_id: abo[0].idc,
          status: 'success',
          error: null,
        });
      }
      return;
    }

    if (CHECK) {
      report.status = abo.length || badge.length ? 'partial' : 'needs_sale';
      return;
    }

    const raw = await loadOrderAsync(ORDER_ID);
    const hydrated = await hydrateOrderMedia(raw);
    const product = raw.product_snapshot || { id: raw.product_id, name: raw.product_name };
    const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
    payload.deciplus_member_id = MEMBER_ID;
    payload.gym = 'minimes';
    payload.paiement_comptant = false;
    delete payload.deciplus_sale_id;
    const order = normalizeOrder(payload);
    order.gym = 'minimes';
    order.paiement_comptant = false;
    order.payment = { ...(order.payment || {}), status: 'paid' };

    const catalog = await fetchDeciplusCatalog(page);
    const productConfig = applyBillingPlanToProductConfig(resolveProductConfig(order, catalog), order);
    productConfig.auto_badge = orderNeedsAutoBadge(order, productConfig);
    productConfig.paiement_comptant = false;
    productConfig.skip_rib_prompt = true;
    let badgeProductConfig = null;
    if (productConfig.auto_badge) {
      badgeProductConfig = resolveBadgeProductConfig(catalog, {
        badge_timing: 'deferred',
        badge_method: 'iban',
      });
    }

    // Vente UNIQUEMENT sur Minimes — re-vérifier la zone avant recordSale
    const live = await detectMemberGymConfig(page, gymConfig);
    if (!onMinimes(live)) throw new Error('Refus vente : fiche pas sur Minimes');

    const sale = await recordSale(page, order, productConfig, MEMBER_ID, gymConfig, {
      badgeProductConfig,
      forceNewSale: true,
    });
    report.sale = {
      sale_id: sale.sale_id || null,
      action: sale.action || null,
      badge_sale_id: sale.badge_sale_id || null,
      error: sale.error || sale.badge_error || null,
    };

    await closeGreyboxIfOpen(page).catch(() => {});
    await openOnMinimes(page);
    let after = await findActiveContracts(page).catch(() => []);
    let aboAfter = after.filter((c) => !c.isBadge && isActiveMembershipContract(c));
    let badgeAfter = after.filter((c) => c.isBadge && isActiveBadgeContract(c));

    if (aboAfter.length >= 1 && badgeAfter.length === 0 && badgeProductConfig) {
      report.badge = await buyCarteBadge(page, badgeProductConfig, gymConfig, MEMBER_ID).catch((err) => ({
        error: err.message,
      }));
      await openOnMinimes(page);
      after = await findActiveContracts(page).catch(() => []);
      aboAfter = after.filter((c) => !c.isBadge && isActiveMembershipContract(c));
      badgeAfter = after.filter((c) => c.isBadge && isActiveBadgeContract(c));
    }

    report.after = after.map(slim);
    const liveAfter = await detectMemberGymConfig(page, gymConfig);
    report.after_site = liveAfter?.deciplus_label;
    report.after_zone = liveAfter?.deciplus_zone_id;

    if (!onMinimes(liveAfter)) {
      throw new Error(`ERREUR CRITIQUE: fiche repassée hors Minimes (zone ${liveAfter?.deciplus_zone_id})`);
    }

    const saleId = sale.sale_id || aboAfter[0]?.idc || null;
    report.status = aboAfter.length === 1 && badgeAfter.length === 1 ? 'fixed' : 'partial';
    await applyBotSaleStatus(ORDER_ID, {
      deciplus_member_id: MEMBER_ID,
      deciplus_sale_id: saleId || undefined,
      status: report.status === 'fixed' ? 'success' : 'manual_review',
      error: report.status === 'fixed' ? null : `abo=${aboAfter.length} badge=${badgeAfter.length}`,
    });
  });

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await closeBrowser().catch(() => {});
  if (!['fixed', 'already_ok'].includes(report.status)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
