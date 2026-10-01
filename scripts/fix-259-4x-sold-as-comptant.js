#!/usr/bin/env node
'use strict';
/**
 * Rattrape les 259 € 4× CB enregistrés à tort en comptant Deciplus
 * (aucun échéancier SEPA). Résilie le 259 comptant puis vend
 * « 259€ EN 4X PRELEVEMENT ».
 *
 *   node scripts/fix-259-4x-sold-as-comptant.js --check
 *   node scripts/fix-259-4x-sold-as-comptant.js --apply
 *   node scripts/fix-259-4x-sold-as-comptant.js --check --orders-only
 *   node scripts/fix-259-4x-sold-as-comptant.js --apply --only=dupont
 *   node scripts/fix-259-4x-sold-as-comptant.js --apply --limit=5
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.TEMP = process.env.TEMP || 'D:\\tmp-playwright';
process.env.TMP = process.env.TMP || 'D:\\tmp-playwright';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const {
  applyBillingPlanToProductConfig,
  isPayplug4xPrelevementOrder,
  PAYPLUG_4X_DECIPLUS_LABEL,
} = require('../lib/billing-plan');
const { isOffre259Product } = require('../lib/balma');
const { buildProductConfig } = require('../lib/catalog-sale');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');
const { applyBotSaleStatus } = require('../storefront/lib/order-lifecycle');

const CHECK = process.argv.includes('--check') || !process.argv.includes('--apply');
const APPLY = process.argv.includes('--apply');
const ORDERS_ONLY = process.argv.includes('--orders-only');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0) || 0;
const OUT = path.join(__dirname, '..', 'data', `fix-259-4x-comptant-${Date.now()}.json`);

/** PayPal 4× : échéancier géré par PayPal — ne pas remplacer par SEPA Deciplus. */
function isPaypalFourXOrder(order = {}) {
  const method = String(order.payment?.method || order.payment_method || '').toLowerCase();
  if (method !== 'paypal') return false;
  const plan = String(order.payment_plan || order.payment?.payment_plan || '').toLowerCase();
  return plan === '4x';
}

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  const c = p.customer || {};
  return `${cs.first_name || cf.first_name || c.first_name || ''} ${
    cs.last_name || cf.last_name || c.last_name || ''
  }`
    .replace(/\s+/g, ' ')
    .trim();
}

function paidAmount(p) {
  const pay = p.payment || {};
  let amount = Number(pay.amount);
  if (!Number.isFinite(amount) && pay.amount_cents != null) {
    amount = Number(pay.amount_cents) / 100;
  }
  return amount;
}

function is259ComptantLabel(label) {
  const t = String(label || '');
  if (/resilie|annule|termine|inactif|clotur|archiv/i.test(t)) return false;
  if (!/259|offre promo|12\s*mois|12mois/i.test(t)) return false;
  return !/4\s*[x×]|4 fois|prelevement|pr[eé]l[eè]vement/i.test(t);
}

function is259FourXLabel(label) {
  const t = String(label || '');
  if (/resilie|annule|termine|inactif|clotur|archiv/i.test(t)) return false;
  return /259/.test(t) && /4\s*[x×]|4 fois|prelevement|pr[eé]l[eè]vement/i.test(t);
}

/** Contrat générique sans libellé produit (souvent 4× collé en comptant). */
function isGeneric259ishLabel(label, orderCreatedAt) {
  const t = String(label || '');
  if (/resilie|annule|termine|inactif|clotur|archiv|badge|essai|coaching/i.test(t)) return false;
  if (/259|offre promo|12\s*mois|4\s*[x×]|prelevement|pr[eé]l[eè]vement/i.test(t)) return false;
  if (!/contrat\s*n/i.test(t)) return false;
  const created = orderCreatedAt ? new Date(orderCreatedAt) : null;
  if (!created || Number.isNaN(created.getTime())) return true;
  const dd = String(created.getDate()).padStart(2, '0');
  const mm = String(created.getMonth() + 1).padStart(2, '0');
  const yyyy = String(created.getFullYear());
  return t.includes(`${dd}/${mm}/${yyyy}`);
}

function slimContracts(list) {
  return (list || []).map((c) => ({
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 180),
  }));
}

async function readBodyText(page) {
  let text = '';
  for (const frame of [page, ...page.frames()]) {
    try {
      text += ` ${(await frame.locator('body').innerText().catch(() => '')) || ''}`;
    } catch {
      /* frame */
    }
  }
  return text.replace(/\s+/g, ' ');
}

function parseContractMoney(text) {
  const t = String(text || '');
  const restant = (t.match(/Restant d[uû]\s*:\s*([\d\s]+(?:[.,]\d{1,2})?)\s*€/i) || [])[1];
  const encaisse = (t.match(/Total encaiss[eé]\s*:\s*([\d\s]+(?:[.,]\d{1,2})?)\s*€/i) || [])[1];
  const toNum = (v) => {
    if (!v) return null;
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  return {
    restant: toNum(restant),
    encaisse: toNum(encaisse),
    waiting: /3\s*EN\s*ATTENTE|en attente\s*64/i.test(t),
    noEch: /Aucune information trouv[eé]e pour ce contrat/i.test(t),
    fourX: /64[,.]75/.test(t),
    prestation: ((t.match(/Prestation\s*:\s*([^\n]+)/i) || [])[1] || '').trim().slice(0, 80),
  };
}

/** true = encaissé comptant (259 €), false = vrai 4× SEPA, null = inconnu */
function looksComptant(info) {
  if (!info) return null;
  if (info.waiting || info.fourX) return false;
  if (info.restant != null && info.restant > 1) return false;
  if (info.restant === 0) return true;
  if (info.encaisse != null && Math.abs(info.encaisse - 259) < 0.5 && !info.fourX) return true;
  if (info.noEch) return true;
  return null;
}

async function inspectContractMoney(page, idc) {
  const { contractUrl } = require('../bot/cancel-sale');
  await page.goto(contractUrl(idc), { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(700);
  return parseContractMoney(await readBodyText(page));
}

function isOneyFull259(p, amount) {
  const pay = p.payment || {};
  const plan = String(p.payment_plan || pay.payment_plan || '').toLowerCase();
  if (plan !== '4x') return false;
  if (pay.billing_plan === 'rib' || pay.payplug_4x_prelevement || pay.cawl_4x_prelevement) {
    return false;
  }
  return Number.isFinite(amount) && Math.abs(amount - 259) < 0.5;
}

function looksLike259(p) {
  const pid = String(p.product_id || p.product_reference || p.product_snapshot?.id || '').toLowerCase();
  if (pid === 'baby-boxe' || pid === 'boxe-educative' || pid === 'dp-93' || pid === 'dp-45') {
    return false;
  }
  if (isOffre259Product(p.product_snapshot || {}, p)) return true;
  return /259|offre-saison|dp-100|offre promo|12\s*mois/i.test(
    `${p.product_id || ''} ${p.product_name || ''} ${p.offer || ''} ${p.product_snapshot?.name || p.product_snapshot?.display_name || ''}`
  );
}

function isTargetOrder(p) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isPaypalFourXOrder(p)) return false;
  if (!looksLike259(p)) return false;
  const amount = paidAmount(p);
  const plan = String(p.payment_plan || p.payment?.payment_plan || '').toLowerCase();
  const fourX =
    isPayplug4xPrelevementOrder(p) ||
    plan === '4x' ||
    (Number.isFinite(amount) && Math.abs(amount - 64.75) < 0.2);
  if (!fourX) return false;
  if (plan === 'once' && Number.isFinite(amount) && Math.abs(amount - 259) < 0.5) return false;
  return true;
}

async function loadAllOrders(sb) {
  const since = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  return rows;
}

function toTarget(row) {
  const p = row.payload || {};
  const name = rowName(p);
  const amount = paidAmount(p);
  const pay = p.payment || {};
  const plan = String(p.payment_plan || pay.payment_plan || '').toLowerCase();
  return {
    order_id: row.order_id,
    created_at: row.created_at,
    name,
    email: p.customer_short?.email || p.customer_full?.email || p.customer?.email || '',
    phone: p.customer_short?.phone || p.customer_full?.phone || p.customer?.phone || '',
    birthdate: p.customer_short?.birthdate || p.customer_full?.birthdate || p.customer?.birthdate || '',
    gym: p.customer_full?.gym || p.gym || 'minimes',
    member_id: p.deciplus_member_id || null,
    sale_id: p.deciplus_sale_id || null,
    bot_status: p.bot_status || null,
    bot_error: p.bot_error || null,
    pay_amount: Number.isFinite(amount) ? amount : plan === '4x' ? 64.75 : amount,
    product_id: p.product_id || p.product_snapshot?.id || '',
    pay_plan: pay.payment_plan || p.payment_plan,
    billing_plan: pay.billing_plan || p.billing_plan,
    method: pay.method || p.payment_method || '',
    iban: pay.iban || p.customer_full?.iban || p.customer?.iban || null,
    oney_full: isOneyFull259(p, amount),
    payload: p,
  };
}

async function loadTargets() {
  const sb = getSupabase();
  const rows = await loadAllOrders(sb);
  const seen = new Set();
  const found = [];
  for (const row of rows) {
    const p = row.payload || {};
    if (seen.has(row.order_id)) continue;
    if (!isTargetOrder(p)) continue;
    const name = rowName(p);
    if (ONLY && !`${name} ${row.order_id}`.toLowerCase().includes(ONLY)) continue;
    seen.add(row.order_id);
    found.push(toTarget(row));
  }
  found.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return LIMIT > 0 ? found.slice(0, LIMIT) : found;
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
      method: target.method || 'payplug',
      payment_plan: '4x',
      billing_plan: 'rib',
      amount: Number.isFinite(target.pay_amount) && target.pay_amount < 90 ? target.pay_amount : 64.75,
    },
    payment_plan: '4x',
    billing_plan: 'rib',
    requires_iban: true,
    paiement_comptant: false,
    payplug_4x_prelevement: true,
    customer: {
      first_name: p.customer_short?.first_name || p.customer_full?.first_name || p.customer?.first_name,
      last_name: p.customer_short?.last_name || p.customer_full?.last_name || p.customer?.last_name,
      email: target.email,
      phone: target.phone,
      birthdate: target.birthdate,
      iban: target.iban,
    },
    source: 'fix-259-4x-sold-as-comptant',
  };
  const matched =
    catalog.find((c) => /259.*4x prelevement|4x prelevement/i.test(String(c.title || ''))) ||
    catalog.find((c) => String(c.id) === String(order.product_id)) || {
      id: 100,
      title: PAYPLUG_4X_DECIPLUS_LABEL,
      type: 'abo',
      categoryId: 'abo',
      price: 259,
    };
  return { order, productConfig: buildProductConfig(order, matched) };
}

async function resolveMember(page, target) {
  if (target.member_id) return String(target.member_id);
  const { searchMember, searchMemberByName } = require('../bot/member');
  if (target.email) {
    const byEmail = await searchMember(page, target.email).catch(() => null);
    if (byEmail?.member_id) return String(byEmail.member_id);
  }
  const last = (target.name || '').split(' ').slice(-1)[0];
  const first = (target.name || '').split(' ').slice(0, -1).join(' ');
  if (last) {
    const byName = await searchMemberByName(page, last, first).catch(() => null);
    if (byName?.member_id) return String(byName.member_id);
  }
  if (target.phone) {
    const byPhone = await searchMember(page, target.phone).catch(() => null);
    if (byPhone?.member_id) return String(byPhone.member_id);
  }
  return null;
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
  } else {
    out.iban = target.iban ? 'invalid' : 'missing';
  }
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  try {
    await annotateMember(page, saleOrder, productConfig, memberId);
    out.note = '4× sans frais CB';
  } catch (err) {
    out.note = err.message;
  }
  return out;
}

async function inspectOrRepair(page, catalog, target) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts, cancelSale } = require('../bot/cancel-sale');
  const { recordSale } = require('../bot/sale');
  const { detectMemberGymConfig } = require('../bot/member');

  const memberId = await resolveMember(page, target);
  if (!memberId) {
    return { ...target, error: 'pas de member_id Deciplus', skipped: 'no_member' };
  }

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
    auto_badge: false,
    deciplus_product_name: productConfig.deciplus_product_name || PAYPLUG_4X_DECIPLUS_LABEL,
    label: productConfig.label || PAYPLUG_4X_DECIPLUS_LABEL,
  };

  const before = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const wrongLabel = before.filter((c) => !c.isBadge && is259ComptantLabel(c.label));
  const fourXLabel = before.filter((c) => !c.isBadge && is259FourXLabel(c.label));
  const generic = before.filter(
    (c) =>
      !c.isBadge &&
      isGeneric259ishLabel(c.label, target.created_at) &&
      !fourXLabel.some((x) => String(x.idc) === String(c.idc)) &&
      !wrongLabel.some((x) => String(x.idc) === String(c.idc))
  );

  const inspectList = [...fourXLabel, ...wrongLabel, ...generic];
  const details = [];
  for (const c of inspectList) {
    const info = await inspectContractMoney(page, c.idc);
    details.push({
      idc: c.idc,
      label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
      ...info,
      comptant: looksComptant(info),
    });
  }

  const fake4x = details.filter((d) => d.comptant === true);
  const real4x = details.filter((d) => d.comptant === false);
  const unknown = details.filter((d) => d.comptant == null);
  const hasReal4x = real4x.length > 0;
  const wrongToCancel = [
    ...wrongLabel,
    ...inspectList.filter((c) => fake4x.some((d) => String(d.idc) === String(c.idc))),
  ].filter((c, i, arr) => arr.findIndex((x) => String(x.idc) === String(c.idc)) === i);

  const needsRepair =
    wrongToCancel.length > 0 || (!hasReal4x && !target.oney_full && unknown.length === 0);

  const summary = {
    name: target.name,
    order_id: target.order_id,
    member_id: memberId,
    gym: gymConfig.key || target.gym,
    pay_amount: target.pay_amount,
    method: target.method,
    pay_plan: target.pay_plan,
    billing_plan: target.billing_plan,
    oney_full: target.oney_full,
    deciplus_tile: productConfig.deciplus_product_name,
    bot_status: target.bot_status,
    before: slimContracts(before),
    wrong_comptant: slimContracts(wrongToCancel),
    contract_details: details.map((d) => ({
      idc: d.idc,
      restant: d.restant,
      encaisse: d.encaisse,
      fourX: d.fourX,
      noEch: d.noEch,
      comptant: d.comptant,
      prestation: d.prestation,
    })),
    has_4x_prelev: hasReal4x,
    fake_4x_comptant: fake4x.length,
  };

  console.log('\n===', target.name, target.order_id, '===');
  console.log(
    JSON.stringify(
      {
        member_id: memberId,
        amount: target.pay_amount,
        wrong: summary.wrong_comptant.map((c) => c.label),
        real_4x: hasReal4x,
        fake_4x: fake4x.length,
        details: summary.contract_details,
        oney_full: target.oney_full,
      },
      null,
      2
    )
  );

  if (target.oney_full && !hasReal4x) {
    return { ...summary, skipped: 'oney_full_259_skip_double_charge' };
  }

  if (hasReal4x && !wrongToCancel.length) {
    return { ...summary, skipped: 'already_4x_prelev' };
  }

  if (CHECK || !APPLY) {
    return {
      ...summary,
      skipped: 'check_only',
      needs_repair: needsRepair,
    };
  }

  if (wrongToCancel.length) {
    const cancelIds = new Set(wrongToCancel.map((c) => String(c.idc)));
    await cancelSale(page, memberId, {
      cancelReason: 'change_replace_existing',
      neverVoid: true,
      filter: (c) => c && !c.isBadge && cancelIds.has(String(c.idc)),
    });
  }

  if (hasReal4x) {
    return { ...summary, skipped: 'cancelled_wrong_kept_4x' };
  }

  const result = await recordSale(page, saleOrder, productConfig, memberId, gymConfig, {
    badgeProductConfig: null,
    forceNewSale: true,
  });
  const extras = await applyIbanAndNote(page, target, saleOrder, productConfig, memberId, gymConfig);
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  let saleId = result.sale_id || null;
  if (!saleId) {
    for (const c of after.filter((x) => !x.isBadge && is259FourXLabel(x.label))) {
      const info = await inspectContractMoney(page, c.idc);
      if (looksComptant(info) === false) {
        saleId = c.idc;
        break;
      }
    }
  }

  if (target.order_id) {
    await applyBotSaleStatus(target.order_id, {
      deciplus_member_id: memberId,
      deciplus_sale_id: saleId || undefined,
      status: saleId ? 'success' : 'manual_review',
      error: saleId
        ? extras?.iban && extras.iban !== 'ok'
          ? `RIB: ${extras.iban}`
          : null
        : result.error || 'contrat 4× prélèvement toujours absent',
    }).catch((err) => console.warn('status', err.message));
  }

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

  console.log('Chargement commandes 259 4× CB…');
  const targets = await loadTargets();
  console.log(`Cibles boutique : ${targets.length}`);
  for (const t of targets) {
    console.log(
      `  ${t.created_at?.slice(0, 10) || ''} ${t.name} ${t.order_id} ${t.product_id || ''} ${t.pay_amount}€ ${t.method || ''} ${
        t.pay_plan || ''
      }${t.oney_full ? ' [ONEY_FULL]' : ''}`
    );
  }

  const report = {
    at: new Date().toISOString(),
    check: CHECK && !APPLY,
    apply: APPLY,
    count: targets.length,
    results: [],
  };

  if (ORDERS_ONLY || (!APPLY && CHECK && ORDERS_ONLY)) {
    report.results = targets.map((t) => ({
      name: t.name,
      order_id: t.order_id,
      created_at: t.created_at,
      pay_amount: t.pay_amount,
      product_id: t.product_id,
      method: t.method,
      pay_plan: t.pay_plan,
      billing_plan: t.billing_plan,
      member_id: t.member_id,
      oney_full: t.oney_full,
      skipped: 'orders_only',
    }));
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nRapport :', OUT);
    return;
  }

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  await runWithSession('fix-259-4x-sold-as-comptant', async (page) => {
    try {
      await login(page, { siteLabel: 'Minimes' });
    } catch (err) {
      console.warn('Login retry', err.message);
      await login(page, { siteLabel: 'Minimes' });
    }
    const catalog = await fetchDeciplusCatalog(page);
    for (const target of targets) {
      try {
        const out = await inspectOrRepair(page, catalog, target);
        report.results.push(out);
        console.log('→', target.name, out.sale || out.skipped || out.error);
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
  const need = report.results.filter((r) => r.needs_repair || r.wrong_comptant?.length);
  const done = report.results.filter((r) => r.sale?.sale_id);
  const failed = report.results.filter((r) => r.error && !r.skipped);
  console.log(
    `Résumé : ${targets.length} commandes, ${need.length} 259 comptant à corriger, ${done.length} réparés, ${failed.length} erreurs`
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
