#!/usr/bin/env node
'use strict';
/**
 * Junior Deme — fiche Balma par erreur, commande États-Unis.
 *   node scripts/fix-junior-deme.js --check
 *   node scripts/fix-junior-deme.js
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
const { existingSiteConfig } = require('../lib/deciplus-sites');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');

const CHECK = process.argv.includes('--check');
const ORDER_ID = 'BC-1788371013421-6806c0';
const MEMBER_ID = '20165';
const WRONG_SALE_ID = '43180';
const OUT = path.join(__dirname, '..', 'data', `fix-junior-deme-${Date.now()}.json`);

async function loadOrder() {
  const sb = getSupabase();
  const { data, error } = await sb.from('boxplus_orders').select('payload').eq('order_id', ORDER_ID).single();
  if (error) throw error;
  return data.payload || {};
}

function saleOrder(payload) {
  const cs = payload.customer_short || {};
  const cf = payload.customer_full || {};
  return {
    order_id: ORDER_ID,
    product_id: payload.product_id || 'dp-100',
    product_name: payload.product_name || 'OFFRE PROMO 12 MOIS',
    deciplus_product_search: payload.deciplus_product_search || 'OFFRE PROMO 12',
    gym: 'etats-unis',
    paiement_comptant: payload.payment?.method === 'paypal',
    requires_iban: Boolean(payload.payment?.iban),
    auto_badge: false,
    payment: {
      status: 'paid',
      amount: payload.payment?.amount || 259,
      method: payload.payment?.method || 'payplug',
      payment_plan: payload.payment?.payment_plan || 'once',
      billing_plan: payload.payment?.billing_plan || payload.payment?.method || 'rib',
      iban: payload.payment?.iban || null,
    },
    customer: {
      first_name: cs.first_name || cf.first_name,
      last_name: cs.last_name || cf.last_name,
      email: cs.email || cf.email,
      phone: cs.phone || cf.phone,
      birthdate: cs.birthdate || cf.birthdate,
      gender: cf.gender,
      address: cf.address,
      postal_code: cf.postal_code,
      city: cf.city,
    },
    source: 'fix-junior-deme',
  };
}

async function repair(page, catalog, payload) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { detectMemberGymConfig } = require('../bot/member');
  const { migrateMemberToGym } = require('../bot/migrate-gym');
  const { findActiveContracts, cancelSale } = require('../bot/cancel-sale');
  const { recordSale } = require('../bot/sale');
  const { resolveProductConfig } = require('../bot/catalog');
  const { switchDeciplusSite } = require('../bot/deciplus-zone');

  const etatsUnisSite = existingSiteConfig(getGymConfig('etats-unis'));
  if (!etatsUnisSite) throw new Error('Config États-Unis introuvable');

  await closeGreyboxIfOpen(page).catch(() => {});
  await switchDeciplusSite(page, 'Balma').catch(() => {});
  await openMemberCheck(page, MEMBER_ID, etatsUnisSite);
  const beforeSite = await detectMemberGymConfig(page, etatsUnisSite);
  const beforeContracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);

  const report = {
    name: 'Junior Deme',
    member_id: MEMBER_ID,
    order_id: ORDER_ID,
    before_site: beforeSite?.deciplus_label || null,
    before_zone: beforeSite?.deciplus_zone_id || null,
    before_contracts: beforeContracts.map((c) => ({
      idc: c.idc,
      label: String(c.label || '').slice(0, 120),
    })),
  };

  const wrongContract = beforeContracts.find((c) => String(c.idc) === WRONG_SALE_ID);
  const needsMigrate =
    String(beforeSite?.deciplus_zone_id || '') !== String(etatsUnisSite.deciplus_zone_id) ||
    !/etats/i.test(String(beforeSite?.deciplus_label || ''));

  console.log(JSON.stringify({ ...report, needsMigrate, wrongContract: wrongContract?.idc || null }, null, 2));
  if (CHECK) return { ...report, check_only: true };

  if (needsMigrate) {
    await migrateMemberToGym(page, MEMBER_ID, etatsUnisSite);
    report.migrated_to = etatsUnisSite.deciplus_label;
    await openMemberCheck(page, MEMBER_ID, etatsUnisSite);
  }

  if (wrongContract) {
    report.cancel_wrong_sale = await cancelSale(page, MEMBER_ID, {
      filter: (c) => String(c.idc) === WRONG_SALE_ID,
    });
    await openMemberCheck(page, MEMBER_ID, etatsUnisSite).catch(() => {});
  }

  const saleOrderObj = saleOrder(payload);
  const productConfig = applyBillingPlanToProductConfig(
    resolveProductConfig(saleOrderObj, catalog),
    saleOrderObj
  );
  productConfig.auto_badge = false;
  productConfig.skip_rib_prompt = !saleOrderObj.payment?.iban;

  const saleResult = await recordSale(page, saleOrderObj, productConfig, MEMBER_ID, etatsUnisSite, {
    badgeProductConfig: null,
    forceNewSale: true,
  });
  report.sale = saleResult;

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, MEMBER_ID, etatsUnisSite).catch(() => {});
  const afterSite = await detectMemberGymConfig(page, etatsUnisSite);
  const afterContracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const saleId = saleResult?.sale_id || afterContracts.find((c) => /offre promo|12/i.test(c.label || ''))?.idc;

  await applyBotSaleStatus(ORDER_ID, {
    deciplus_member_id: MEMBER_ID,
    deciplus_sale_id: saleId || undefined,
    status: saleId ? 'success' : 'manual_review',
    error: saleId ? null : saleResult?.error || 'vente États-Unis non confirmée',
  });

  report.after_site = afterSite?.deciplus_label || null;
  report.after_zone = afterSite?.deciplus_zone_id || null;
  report.after_contracts = afterContracts.map((c) => ({
    idc: c.idc,
    label: String(c.label || '').slice(0, 120),
  }));
  report.new_sale_id = saleId || null;
  return report;
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const payload = await loadOrder();
  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  let report = { at: new Date().toISOString(), check: CHECK };
  await runWithSession('fix-junior-deme', async (page) => {
    await login(page, { siteLabel: 'Balma' }).catch(async () => {
      await login(page, { siteLabel: 'Minimes' });
    });
    const catalog = await fetchDeciplusCatalog(page);
    report = { ...report, ...(await repair(page, catalog, payload)) };
  });
  await closeBrowser().catch(() => {});
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nRapport', OUT);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
