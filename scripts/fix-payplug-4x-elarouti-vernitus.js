#!/usr/bin/env node
'use strict';
/**
 * Rattrape les 4× PayPlug enregistrés à tort en comptant 259 € :
 * - Alexandre ELAROUTI
 * - BOB VERNITUS
 *
 *   node scripts/fix-payplug-4x-elarouti-vernitus.js --check
 *   node scripts/fix-payplug-4x-elarouti-vernitus.js
 *   node scripts/fix-payplug-4x-elarouti-vernitus.js --only=elarouti
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
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const {
  applyBillingPlanToProductConfig,
  isPayplug4xPrelevementOrder,
} = require('../lib/billing-plan');
const { buildProductConfig } = require('../lib/catalog-sale');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');

const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `fix-payplug-4x-${Date.now()}.json`);

const NAME_PATTERNS = [/elarouti/i, /vernitus/i, /vernit/i];
const FORCE_ORDER_IDS = ['BC-1788543262159-4840fa'];

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.replace(/\s+/g, ' ').trim();
}

function slimContracts(list) {
  return (list || []).map((c) => ({
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
}

function matchesTarget(name, orderId) {
  const hay = `${name} ${orderId}`.toLowerCase();
  if (ONLY && !hay.includes(ONLY)) return false;
  return NAME_PATTERNS.some((re) => re.test(name));
}

async function loadTargets() {
  const sb = getSupabase();
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, created_at, payload')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const seen = new Set();
  const found = [];

  function pushRow(row) {
    if (!row || seen.has(row.order_id)) return;
    const p = row.payload || {};
    const name = rowName(p);
    const pay = p.payment || {};
    if (String(pay.status) !== 'paid') return;
    if (String(pay.method || '').toLowerCase() !== 'payplug') return;
    let amount = Number(pay.amount);
    if (!Number.isFinite(amount) && pay.amount_cents != null) {
      amount = Number(pay.amount_cents) / 100;
    }
    const priceCents = Number(p.product_snapshot?.price_cents || 25900);
    const quarter = Math.round(priceCents / 4) / 100;
    if (!Number.isFinite(amount) || amount <= 0) amount = quarter;
    const isQuarter = Number.isFinite(amount) && amount > 50 && amount < 90;
    const is4x =
      isPayplug4xPrelevementOrder(p) ||
      pay.payment_plan === '4x' ||
      pay.billing_plan === 'rib' ||
      isQuarter;
    if (!is4x) return;
    seen.add(row.order_id);
    found.push({
      order_id: row.order_id,
      created_at: row.created_at,
      name,
      email: p.customer_short?.email || p.customer_full?.email || '',
      phone: p.customer_short?.phone || p.customer_full?.phone || '',
      birthdate: p.customer_short?.birthdate || p.customer_full?.birthdate || '',
      gym: p.customer_full?.gym || p.gym || 'minimes',
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      bot_error: p.bot_error || null,
      pay_amount: amount,
      pay_plan: pay.payment_plan,
      billing_plan: pay.billing_plan,
      iban: pay.iban || p.customer_full?.iban || null,
      payload: p,
    });
  }

  for (const row of data || []) {
    const p = row.payload || {};
    const name = rowName(p);
    if (!matchesTarget(name, row.order_id) && !FORCE_ORDER_IDS.includes(row.order_id)) continue;
    pushRow(row);
  }

  for (const orderId of FORCE_ORDER_IDS) {
    if (seen.has(orderId)) continue;
    const { data: forced } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .eq('order_id', orderId)
      .limit(1);
    if (forced?.[0]) pushRow(forced[0]);
  }

  return found;
}

function productOrder(target, catalog) {
  const p = target.payload || {};
  const order = {
    ...p,
    order_id: target.order_id,
    product_id: p.product_id || 'dp-100',
    product_name: p.product_name || 'OFFRE PROMO 12 MOIS',
    gym: target.gym,
    payment: {
      ...(p.payment || {}),
      status: 'paid',
      method: 'payplug',
      payment_plan: '4x',
      billing_plan: 'rib',
      amount: target.pay_amount || 64.75,
    },
    payment_plan: '4x',
    billing_plan: 'rib',
    requires_iban: true,
    customer: {
      first_name: p.customer_short?.first_name || p.customer_full?.first_name,
      last_name: p.customer_short?.last_name || p.customer_full?.last_name,
      email: target.email,
      phone: target.phone,
      birthdate: target.birthdate,
      iban: target.iban,
    },
    source: 'fix-payplug-4x-elarouti-vernitus',
  };
  const matched = catalog.find((c) => String(c.id) === String(order.product_id)) || {
    id: 100,
    title: order.product_name,
    type: 'abo',
    categoryId: 'abo',
    price: 259,
  };
  return { order, productConfig: buildProductConfig(order, matched) };
}

async function applyIbanAndNote(page, target, saleOrder, productConfig, memberId, gymConfig) {
  const { setMemberIban, openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { annotateMember } = require('../bot/sale');
  const { isValidFrenchIban } = require('../lib/iban');
  const out = { iban: null, note: null };

  if (target.iban && isValidFrenchIban(target.iban)) {
    try {
      await setMemberIban(page, memberId, target.iban, saleOrder.customer, gymConfig);
      out.iban = 'ok';
    } catch (err) {
      out.iban = err.message;
    }
  }

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  try {
    await annotateMember(page, saleOrder, productConfig, memberId);
    out.note = '4× sans frais PayPlug';
  } catch (err) {
    out.note = err.message;
  }
  return out;
}

async function searchDeciplusVernitus(page) {
  const { searchMemberByName } = require('../bot/member');
  for (const [last, first] of [
    ['VERNITUS', 'BOB'],
    ['VERNITUS', ''],
    ['VERNIT', 'BOB'],
  ]) {
    const hit = await searchMemberByName(page, last, first).catch(() => null);
    if (hit?.member_id) {
      return {
        member_id: String(hit.member_id),
        name: `${hit.first_name || first} ${hit.last_name || last}`.trim(),
        gym: 'minimes',
        payload: null,
        order_id: null,
        pay_amount: 64.75,
        iban: null,
        bot_status: null,
        bot_error: null,
        from_deciplus_search: true,
      };
    }
  }
  return null;
}

async function repairOne(page, catalog, target) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  const { recordSale } = require('../bot/sale');
  const { detectMemberGymConfig } = require('../bot/member');

  const memberId = String(target.member_id || target.payload?.deciplus_member_id || '');
  if (!memberId) throw new Error(`${target.name} : pas de member_id Deciplus`);

  let gymConfig = getGymConfig(target.gym || 'minimes');
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  const site = await detectMemberGymConfig(page, gymConfig).catch(() => null);
  if (site?.deciplus_label) gymConfig = site;

  const { order: saleOrder, productConfig: built } = productOrder(target, catalog);
  let productConfig = applyBillingPlanToProductConfig(built, saleOrder);
  productConfig = {
    ...productConfig,
    paiement_comptant: false,
    requires_iban: true,
    skip_rib_prompt: false,
    payplug_4x_prelevement: true,
    auto_badge: Boolean(target.iban),
  };

  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const classified = classifyMemberContracts(before, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
    skipCancel: false,
  });

  const wrongComptant = classified.matchingStarted.filter((c) =>
    /259/.test(String(c.label)) && !/4\s*[x×]|prelevement|pr[eé]l[eè]vement/i.test(String(c.label))
  );
  const has4xPrelev = classified.matchingStarted.some((c) =>
    /4\s*[x×]|prelevement|pr[eé]l[eè]vement/i.test(String(c.label))
  );

  const summary = {
    name: target.name,
    order_id: target.order_id,
    member_id: memberId,
    gym: gymConfig.key || target.gym,
    pay_amount: target.pay_amount,
    deciplus_tile: productConfig.deciplus_product_name,
    bot_status: target.bot_status,
    bot_error: target.bot_error,
    before: slimContracts(before),
    wrong_comptant: slimContracts(wrongComptant),
    has_4x_prelev: has4xPrelev,
    needsNewSale: classified.needsNewSale || wrongComptant.length > 0,
  };
  console.log('\n===', target.name, '===');
  console.log(JSON.stringify(summary, null, 2));

  if (has4xPrelev && !wrongComptant.length) {
    const idc = classified.matchingStarted.find((c) =>
      /4\s*[x×]|prelevement|pr[eé]l[eè]vement/i.test(String(c.label))
    )?.idc;
    let extras = null;
    if (!CHECK) {
      extras = await applyIbanAndNote(page, target, saleOrder, productConfig, memberId, gymConfig);
      if (target.order_id) {
        await applyBotSaleStatus(target.order_id, {
          deciplus_member_id: memberId,
          deciplus_sale_id: String(idc || target.sale_id || ''),
          status: 'success',
          error: extras?.iban && extras.iban !== 'ok' ? `RIB: ${extras.iban}` : null,
        });
      }
    }
    return {
      ...summary,
      skipped: 'already_4x_prelev',
      sale_id: idc || target.sale_id || null,
      iban_note: extras,
    };
  }

  if (CHECK) return { ...summary, skipped: 'check_only' };

  const result = await recordSale(page, saleOrder, productConfig, memberId, gymConfig, {
    badgeProductConfig: null,
    forceNewSale: true,
  });
  const extras = await applyIbanAndNote(page, target, saleOrder, productConfig, memberId, gymConfig);
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const check = classifyMemberContracts(after, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
  });

  const saleId =
    result.sale_id ||
    check.matchingStarted.find((c) =>
      /4\s*[x×]|prelevement|pr[eé]l[eè]vement/i.test(String(c.label))
    )?.idc ||
    null;

  await applyBotSaleStatus(target.order_id, {
    deciplus_member_id: memberId,
    deciplus_sale_id: saleId || undefined,
    status: saleId ? 'success' : 'manual_review',
    error: saleId
      ? extras?.iban && extras.iban !== 'ok'
        ? `RIB: ${extras.iban}`
        : null
      : result.error || 'contrat 4× prélèvement toujours absent',
  });

  return {
    ...summary,
    sale: { action: result.action, sale_id: saleId, error: result.error || null },
    iban_note: extras,
    after: slimContracts(after),
  };
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const targets = await loadTargets();
  if (!targets.length && !CHECK) {
    console.log('Aucune commande PayPlug 4× en base pour ELAROUTI / VERNITUS — recherche Deciplus…');
  }
  console.log(
    'Cibles:',
    targets.map((t) => `${t.name} (${t.order_id}, ${t.pay_amount} €)`).join('\n  ')
  );

  const report = { at: new Date().toISOString(), check: CHECK, results: [] };

  if (CHECK) {
    for (const target of targets) {
      report.results.push({
        name: target.name,
        order_id: target.order_id,
        pay_amount: target.pay_amount,
        member_id: target.member_id,
        sale_id: target.sale_id,
        bot_status: target.bot_status,
        skipped: 'check_only',
      });
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nRapport (check) :', OUT);
    return;
  }

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  await runWithSession('fix-payplug-4x-elarouti-vernitus', async (page) => {
    try {
      await login(page, { siteLabel: 'Minimes' });
    } catch (err) {
      console.warn('Login retry after zone picker', err.message);
      await login(page, { siteLabel: 'Minimes' });
    }
    const catalog = await fetchDeciplusCatalog(page);

    if (!targets.some((t) => /vernit/i.test(t.name)) && (!ONLY || ONLY.includes('vern'))) {
      const dec = await searchDeciplusVernitus(page);
      if (dec) {
        console.log('Fiche Deciplus VERNITUS trouvée:', dec.member_id, dec.name);
        targets.push(dec);
      } else {
        console.log('VERNITUS introuvable dans Deciplus (recherche BOB VERNITUS / VERNITUS).');
      }
    }

    for (const target of targets) {
      try {
        const out = await repairOne(page, catalog, target);
        report.results.push(out);
        console.log('OK', target.name, out.sale || out.skipped);
      } catch (err) {
        report.results.push({ name: target.name, order_id: target.order_id, error: err.message });
        console.error('FAIL', target.name, err.message);
      }
    }
  });
  await closeBrowser().catch(() => {});
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nRapport :', OUT);
  const failed = report.results.filter((r) => r.error);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
