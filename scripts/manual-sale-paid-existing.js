#!/usr/bin/env node
'use strict';
/**
 * Vente manuelle sur fiches Deciplus déjà existantes.
 * Usage: node scripts/manual-sale-paid-existing.js
 */
require('dotenv').config();
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';

const fs = require('fs');
const { chromium } = require('playwright');
const { login, STORAGE_FILE, gotoDeciplus } = require('../bot/auth');
const { searchMember, searchMemberByName } = require('../bot/member');
const { recordSale } = require('../bot/sale');
const { fetchDeciplusCatalog, resolveProductConfig } = require('../bot/catalog');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { normalizeOrder, validateOrder, getGymConfig } = require('../lib/normalize');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { selectSiteInPicker, clickSellOnSite, isChooseZoneScreen } = require('../bot/deciplus-zone');
const { closeBrowser } = require('../bot/browser-pool');

const TARGETS = [
  {
    email: 'chloe.andolfo@gmail.com',
    gym: 'minimes',
    product_id: 'dp-100',
    amount: 259,
    comptant: true,
    boutique_order_id: 'BC-1786871118142-e94ed4',
    first_name: 'Chloe',
    last_name: 'Andolfo',
    birthdate: '2001-08-01',
    gender: 'F',
    member_id: '17809',
  },
  {
    email: 'jmg_973@hotmail.fr',
    gym: 'ramonville',
    product_id: 'dp-100',
    amount: 259,
    comptant: true,
    boutique_order_id: 'BC-1786873842192-bd9874',
    first_name: 'Jean-Marc',
    last_name: 'Gudiel',
    birthdate: '1994-12-12',
    gender: 'M',
  },
  {
    email: 'diegoacardozom@gmail.com',
    gym: 'st-cyprien',
    product_id: 'dp-104',
    amount: 29.99,
    comptant: false,
    boutique_order_id: 'BC-1786866329366-222513',
    first_name: 'Diego Alejandro',
    last_name: 'Cardozo Muñoz',
    birthdate: '1991-01-20',
    gender: 'M',
    member_id: '14056',
  },
];

function buildOrder(target, memberId, product) {
  const today = new Date().toISOString().slice(0, 10);
  return normalizeOrder({
    order_id: `MANUAL-${target.boutique_order_id}`,
    action: 'sale',
    first_name: target.first_name,
    last_name: target.last_name,
    birthdate: target.birthdate,
    phone: '0600000000',
    email: target.email,
    gym: target.gym,
    gender: target.gender,
    address: '1 rue Boxing Center',
    postal_code: '31000',
    city: 'Toulouse',
    customer: {
      first_name: target.first_name,
      last_name: target.last_name,
      birthdate: target.birthdate,
      phone: '0600000000',
      email: target.email,
      deciplus_member_id: memberId,
    },
    deciplus_member_id: memberId,
    product_id: product.id,
    product_name: product.name,
    deciplus_id: product.deciplus_id,
    deciplus_product_search: product.deciplus_product_search,
    requires_payment: true,
    requires_iban: false,
    sale_type: 'abonnement',
    payment_method: 'payplug',
    sale_date: today,
    effective_date: today,
    auto_badge: false,
    paiement_comptant: target.comptant,
    payment: {
      amount: target.amount,
      method: 'payplug',
      status: 'paid',
      payment_plan: 'once',
      date: new Date().toISOString(),
    },
    source: 'manual-paid-existing-fiche',
  });
}

async function switchSite(page, siteLabel) {
  await gotoDeciplus(page, `nextgen/choose-zone?nextUrl=/home&forced=true`).catch(() => {});
  await page.waitForTimeout(800);
  if (!(await isChooseZoneScreen(page)) && !/choose-zone/i.test(page.url())) {
    return true;
  }
  const selected = await selectSiteInPicker(page, siteLabel);
  if (!selected) return false;
  await clickSellOnSite(page);
  await page.waitForTimeout(800);
  return !(await isChooseZoneScreen(page));
}

async function findMember(page, target) {
  if (target.member_id) return String(target.member_id);
  const byEmail = await searchMember(page, target.email);
  if (byEmail?.found && byEmail.member_id) return String(byEmail.member_id);
  const byName = await searchMemberByName(page, target.last_name, target.first_name);
  if (byName?.found && byName.member_id) return String(byName.member_id);
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'fr-FR',
    storageState: fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : undefined,
  });
  const page = await context.newPage();
  await login(page, { siteLabel: 'Minimes' });

  const catalog = await fetchDeciplusCatalog(page);
  const results = [];

  for (const target of TARGETS) {
    const product = findEnrichedProduct(target.product_id);
    const gymConfig = getGymConfig(target.gym);
    const siteLabel = gymConfig.deciplus_label || 'Minimes';
    console.log('\n===', target.first_name, target.last_name, siteLabel, product?.name);

    const switched = await switchSite(page, siteLabel);
    console.log('Site', siteLabel, switched ? 'OK' : 'FAIL', page.url());
    if (!switched) {
      await login(page, { siteLabel });
    }

    const memberId = await findMember(page, target);
    if (!memberId) {
      console.error('INTROUVABLE', target.email, target.last_name);
      results.push({ email: target.email, ok: false, error: 'not_found' });
      continue;
    }
    console.log('Membre', memberId);

    const order = buildOrder(target, memberId, product);
    const errors = validateOrder(order);
    if (errors.length) {
      results.push({ email: target.email, ok: false, error: errors.join(', ') });
      continue;
    }
    const productConfig = applyBillingPlanToProductConfig(
      resolveProductConfig(order, catalog),
      order
    );
    productConfig.auto_badge = false;
    productConfig.paiement_comptant = target.comptant;
    productConfig.requires_iban = false;

    try {
      const sale = await recordSale(page, order, productConfig, memberId, gymConfig, {
        badgeProductConfig: null,
      });
      const row = {
        email: target.email,
        gym: target.gym,
        member_id: memberId,
        product: product.name,
        ok: !sale?.manual_review,
        sale_id: sale?.sale_id || null,
        action: sale?.action || null,
        error: sale?.manual_review ? sale.action : null,
      };
      console.log('RESULT', JSON.stringify(row));
      results.push(row);
    } catch (err) {
      console.error('VENTE FAIL', err.message);
      results.push({
        email: target.email,
        gym: target.gym,
        member_id: memberId,
        ok: false,
        error: err.message,
      });
    }
  }

  await browser.close();
  console.log('\n=== SYNTHÈSE ===');
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 2;
})()
  .catch((e) => {
    console.error('FAIL', e);
    process.exit(1);
  })
  .finally(async () => {
    await closeBrowser().catch(() => {});
  });
