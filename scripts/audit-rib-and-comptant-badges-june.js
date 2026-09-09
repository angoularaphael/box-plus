#!/usr/bin/env node
'use strict';
/**
 * Depuis le 1er juin 2026 :
 *  1) Ventes prélèvement qui exigent un RIB, RIB manquant (boutique + hors boutique)
 *  2) Abonnements comptant avec Badge Deciplus encore ACTIF
 *
 *   node scripts/audit-rib-and-comptant-badges-june.js
 *   node scripts/audit-rib-and-comptant-badges-june.js --deciplus
 *   node scripts/audit-rib-and-comptant-badges-june.js --deciplus --resume
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.TEMP = process.env.TEMP || 'D:\\tmp-playwright';
process.env.TMP = process.env.TMP || 'D:\\tmp-playwright';
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { normalizeIban, isValidFrenchIban } = require('../lib/iban');
const {
  isPayplug4xPrelevementOrder,
  isComptantStyleProduct,
  requiresIbanForPlan,
} = require('../lib/billing-plan');
const { isOffre29Product, isMonthlyFlexProduct, isAnnualPromoProduct } = require('../lib/sale-contract-match');
const { isCartePrestationOrder, isDeciplusBadgeLabel } = require('../lib/catalog-sale');
const { isAventureOrder } = require('../lib/aventure-policy');
const { isStaleOrInactiveAbo } = require('../lib/replace-existing-abo');
const { isBalmaGymSlug, matchGymSlug, resolveSaleGymConfig } = require('../lib/gym-slugs');

const SINCE = '2026-06-01T00:00:00+02:00';
const LAST_RIB_AUDIT = '2026-09-07T00:00:00+02:00';
const DECIPLUS = process.argv.includes('--deciplus');
const RESUME = process.argv.includes('--resume');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'audit-rib-badge-since-june.json');

const KNOWN_HORS_BOUTIQUE_RIB = [
  { name: 'Dalim Dalim', member: '20990' },
  { name: 'Stephane Bon', member: '21046' },
  { name: 'Tapinoy', member: '21042' },
  { name: 'Thomas Stanislas', member: '21043' },
];

function nameOf(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.replace(/\s+/g, ' ').trim();
}
function emailOf(p) {
  return String(p.customer_short?.email || p.customer_full?.email || p.summary?.email || '')
    .trim()
    .toLowerCase();
}
function productOf(p) {
  const snap = p.product_snapshot || {};
  return {
    id: p.product_id || snap.id,
    name: snap.name || p.product_name,
    display_name: snap.display_name,
    requires_iban: snap.requires_iban,
    supports_installment_choice: snap.supports_installment_choice,
    sale_type: snap.sale_type,
    subsection: snap.subsection,
    badge: snap.badge,
  };
}
function parisDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}
function sourceOf(p) {
  const raw = String(p.source || '').toLowerCase();
  if (isAventureOrder(p) || raw.includes('balma') || p.aventure === true) return 'aventure';
  if (raw === 'custom_offer' || /offre perso|accueil/i.test(String(p.origine || ''))) return 'offre_perso';
  if (raw.includes('prestashop')) return 'prestashop';
  if (raw.startsWith('storefront') || raw.includes('boutique') || raw === 'boutique') return 'boutique';
  if (!raw) return 'boutique';
  return raw.slice(0, 40);
}
function channelBucket(src) {
  return src === 'boutique' ? 'boutique' : 'hors_boutique';
}
function isTestRow(base) {
  const hay = `${base.name || ''} ${base.email || ''}`.toLowerCase();
  return /\btest\b|boxplus-test|@boxplus-test\.local/.test(hay);
}
function gymSlugOf(p) {
  return matchGymSlug(p.customer_full?.gym || p.gym || p.customer_short?.gym || '') || String(p.gym || '').toLowerCase();
}
function isBalmaRow(p, gym) {
  const slug = matchGymSlug(gym) || String(gym || '').toLowerCase();
  if (isBalmaGymSlug(slug) || /\bbalma\b/i.test(String(gym || ''))) return true;
  if (isAventureOrder(p)) return true;
  const src = String(p.source || '').toLowerCase();
  return src.includes('balma') || src === 'aventure';
}

/** Prélèvement qui exige un RIB (même règle que audit-send-missing-rib). */
function needsRib(p, product) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isCartePrestationOrder(p)) return false;
  const hay = `${product.name || ''} ${p.product_id || ''}`;
  if (/essai|coaching|materiel|baby|educative/i.test(hay)) return false;
  const plan = String(p.payment?.billing_plan || p.billing_plan || '').toLowerCase();
  const payPlan = String(p.payment?.payment_plan || p.payment_plan || '').toLowerCase();
  if (isComptantStyleProduct(product) && !isPayplug4xPrelevementOrder(p)) return false;
  if (isPayplug4xPrelevementOrder(p)) return true;
  if (isOffre29Product(product) || isOffre29Product(p)) return true;
  if (isMonthlyFlexProduct(product)) return true;
  if (/44,?99|4 semaines|sans engagement/i.test(`${product.name || ''} ${product.display_name || ''}`)) return true;
  if (product.requires_iban === true) return true;
  if (plan === 'rib' || plan === 'paypal') return true;
  if (requiresIbanForPlan(product, plan, payPlan)) return true;
  return false;
}

/** Badge interdit : 12 mois / enfants / essai / coaching / 4× Payplug. 29 € et 44,99 € : badge OK. */
function mustNotHaveBadge(p, product) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isOffre29Product(product) || isOffre29Product(p)) return false;
  if (isMonthlyFlexProduct(product)) return false;
  if (/44,?99|4 semaines/i.test(`${product.name || ''} ${product.display_name || ''}`)) return false;
  if (isCartePrestationOrder(p) || /essai|coaching/i.test(String(product.name || ''))) return false;
  if (isAnnualPromoProduct(product) || isAnnualPromoProduct(p)) return true;
  if (isPayplug4xPrelevementOrder(p)) return true;
  if (isComptantStyleProduct(product) || isComptantStyleProduct(p)) return true;
  if (/comptant|baby|educative|259|12\s*mois/i.test(String(product.name || ''))) return true;
  return false;
}

function ibanInfo(p) {
  const raw = p.payment?.iban || p.customer_full?.iban || p.iban || '';
  const n = normalizeIban(raw);
  return { iban: n, len: n.length, valid: Boolean(n) && isValidFrenchIban(n) };
}

function isClosedBadge(label) {
  return (
    isStaleOrInactiveAbo(label) ||
    /expir|r[eé]sili|annul|termin|inactif|clotur|archiv/i.test(String(label || ''))
  );
}

async function loadOrders() {
  const sb = getSupabase();
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', new Date(SINCE).toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + 499);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 500) break;
    from += 500;
  }
  return rows;
}

function classify(rows) {
  const ribMissing = [];
  const ribOkOnOrder = [];
  const ribNeedNoMember = [];
  const comptantCandidates = [];
  const sources = {};
  let paid = 0;
  let needRib = 0;
  let comptant = 0;
  let tests = 0;
  let skippedBalma = 0;

  for (const row of rows) {
    const p = row.payload || {};
    const product = productOf(p);
    const gym = gymSlugOf(p);
    if (isBalmaRow(p, gym)) {
      skippedBalma += 1;
      continue;
    }
    const paidStatus = String(p.payment?.status || '').toLowerCase() === 'paid';
    if (paidStatus) paid += 1;
    const src = sourceOf(p);
    sources[src] = (sources[src] || 0) + 1;
    const iban = ibanInfo(p);
    const base = {
      order_id: row.order_id,
      created_at: row.created_at,
      paid_at: p.payment?.paid_at || null,
      day: parisDay(p.payment?.paid_at || row.created_at),
      name: nameOf(p),
      email: emailOf(p) || null,
      gym,
      product: product.display_name || product.name || p.product_id,
      product_id: product.id,
      source: src,
      channel: channelBucket(src),
      member: p.deciplus_member_id || null,
      sale: p.deciplus_sale_id || null,
      bot: p.bot_status || null,
      badge_action: p.badge_action || p.checkpoint?.badge_action || null,
      billing_plan: p.payment?.billing_plan || p.billing_plan || null,
      payment_plan: p.payment?.payment_plan || p.payment_plan || null,
      iban_len: iban.len,
      iban_valid: iban.valid,
      err: String(p.bot_error || '').slice(0, 120) || null,
    };
    if (isTestRow(base)) {
      tests += 1;
      continue;
    }

    if (needsRib(p, product)) {
      needRib += 1;
      if (!iban.valid) {
        if (!base.member) ribNeedNoMember.push(base);
        ribMissing.push({ ...base, why: iban.len ? `IBAN invalide (${iban.len} car.)` : 'IBAN absent' });
      } else {
        ribOkOnOrder.push(base);
      }
    }

    if (mustNotHaveBadge(p, product)) {
      comptant += 1;
      if (base.member && /^\d+$/.test(String(base.member))) comptantCandidates.push(base);
    }
  }

  return {
    paid,
    needRib,
    comptant,
    tests,
    skippedBalma,
    sources,
    ribMissing,
    ribOkOnOrder,
    ribNeedNoMember,
    comptantCandidates,
  };
}

async function readMandate(page, memberId) {
  const { openRibForm, closeGreyboxIfOpen } = require('../bot/wallet');
  const ctx = await openRibForm(page, memberId, { forceFresh: true });
  const meta = await ctx
    .evaluate(() => ({
      iban: document.querySelector('input[name="iban"]')?.value || '',
      rum: document.querySelector('input[name="rum"]')?.value || '',
    }))
    .catch(() => ({ iban: '', rum: '' }));
  await closeGreyboxIfOpen(page).catch(() => {});
  const iban = normalizeIban(meta.iban);
  return { iban, rum: meta.rum || '', valid: Boolean(iban) && isValidFrenchIban(iban) };
}

async function readContracts(page, memberId, gym) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, resolveSaleGymConfig(gym || 'minimes', { gym })).catch(() => {});
  const list = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  return list.map((c) => ({
    idc: c.idc,
    badge: Boolean(c.isBadge) || isDeciplusBadgeLabel(c.label),
    closed: isClosedBadge(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 140),
  }));
}

function save(report) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
}

(async () => {
  let report = RESUME && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (!report || !report.rib_missing_on_order) {
    const rows = await loadOrders();
    const c = classify(rows);
    report = {
      at: new Date().toISOString(),
      since: '2026-06-01',
      until: '2026-09-09',
      orders_scanned: rows.length,
      paid: c.paid,
      tests_skipped: c.tests,
      skipped_balma: c.skippedBalma,
      prelevement_need_rib: c.needRib,
      comptant_paid: c.comptant,
      sources: c.sources,
      rib_missing_on_order: c.ribMissing,
      rib_ok_on_order: c.ribOkOnOrder,
      rib_missing_no_member: c.ribNeedNoMember,
      comptant_with_member: c.comptantCandidates,
      deciplus: { rib_missing: [], rib_ok: [], rib_fail: [], badge_wrong: [], badge_ok: [], badge_fail: [] },
    };
    save(report);
    console.log(
      JSON.stringify(
        {
          orders: rows.length,
          paid: c.paid,
          tests_skipped: c.tests,
          skipped_balma: c.skippedBalma,
          need_rib: c.needRib,
          rib_missing_order: c.ribMissing.length,
          rib_missing_boutique: c.ribMissing.filter((r) => r.channel === 'boutique').length,
          rib_missing_hors: c.ribMissing.filter((r) => r.channel === 'hors_boutique').length,
          rib_valid_on_order: c.ribOkOnOrder.length,
          comptant_with_member: c.comptantCandidates.length,
          sources: c.sources,
        },
        null,
        2
      )
    );
  }

  if (!DECIPLUS) {
    console.log('\nDB scan écrit', OUT, '— relancer avec --deciplus pour vérifier Deciplus');
    return;
  }

  if (!report.deciplus) {
    report.deciplus = { rib_missing: [], rib_ok: [], rib_fail: [], badge_wrong: [], badge_ok: [], badge_fail: [] };
  }

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { closeGreyboxIfOpen } = require('../bot/wallet');

  const allNeedRibMembers = new Map();
  function addRib(r, check) {
    const id = String(r.member || '');
    if (!/^\d+$/.test(id) || allNeedRibMembers.has(id)) return;
    allNeedRibMembers.set(id, { ...r, check });
  }
  for (const r of report.rib_missing_on_order || []) addRib(r, 'missing_on_order');
  for (const extra of KNOWN_HORS_BOUTIQUE_RIB) {
    addRib(
      {
        ...extra,
        order_id: `DECIPLUS-SEARCH-${extra.member}`,
        channel: 'hors_boutique',
        source: 'accueil_deciplus',
        product: 'Vente accueil Deciplus',
      },
      'hors_boutique_known'
    );
  }
  const sinceLast = new Date(LAST_RIB_AUDIT).getTime();
  for (const r of report.rib_ok_on_order || []) {
    const t = Date.parse(r.paid_at || r.created_at || '') || 0;
    if (t >= sinceLast) addRib(r, 'new_since_last_audit');
  }

  const ribTargets = [...allNeedRibMembers.values()];
  const badgeTargets = [];
  const seenBadge = new Set();
  for (const r of report.comptant_with_member || []) {
    const id = String(r.member);
    if (seenBadge.has(id)) continue;
    seenBadge.add(id);
    badgeTargets.push(r);
  }

  const doneRib = new Set(
    (report.deciplus.rib_missing || [])
      .concat(report.deciplus.rib_ok || [])
      .concat(report.deciplus.rib_fail || [])
      .map((x) => String(x.member))
  );
  const doneBadge = new Set(
    (report.deciplus.badge_wrong || [])
      .concat(report.deciplus.badge_ok || [])
      .concat(report.deciplus.badge_fail || [])
      .map((x) => String(x.member))
  );

  console.log('Deciplus RIB à vérifier', ribTargets.length, 'déjà', doneRib.size);
  console.log('Deciplus badges comptant à vérifier', badgeTargets.length, 'déjà', doneBadge.size);

  await runWithSession('audit-rib-badge-june', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
    let n = 0;
    for (const c of ribTargets) {
      if (doneRib.has(String(c.member))) continue;
      n += 1;
      try {
        const mandate = await readMandate(page, String(c.member));
        const row = {
          order_id: c.order_id,
          name: c.name,
          email: c.email || null,
          member: c.member,
          gym: c.gym,
          product: c.product,
          channel: c.channel,
          source: c.source,
          check: c.check,
          why: c.why || null,
          mandate_valid: mandate.valid,
          mandate_rum: mandate.rum || null,
        };
        if (mandate.valid) report.deciplus.rib_ok.push(row);
        else report.deciplus.rib_missing.push(row);
        console.log(mandate.valid ? 'RIB_OK' : 'RIB_MISSING', c.name, c.member, c.channel, c.check);
      } catch (err) {
        report.deciplus.rib_fail.push({
          name: c.name,
          member: c.member,
          order_id: c.order_id,
          error: String(err.message || err).slice(0, 140),
        });
        console.error('RIB_FAIL', c.name, c.member, String(err.message || err).slice(0, 80));
        await closeGreyboxIfOpen(page).catch(() => {});
      }
      if (n % 5 === 0) save(report);
    }
    n = 0;
    for (const c of badgeTargets) {
      if (doneBadge.has(String(c.member))) continue;
      n += 1;
      try {
        const contracts = await readContracts(page, String(c.member), c.gym);
        const badges = contracts.filter((x) => x.badge && !x.closed);
        const abos = contracts.filter((x) => !x.badge && !x.closed);
        if (badges.length) {
          report.deciplus.badge_wrong.push({
            order_id: c.order_id,
            name: c.name,
            email: c.email || null,
            member: c.member,
            gym: c.gym,
            product: c.product,
            channel: c.channel,
            source: c.source,
            day: c.day,
            badges: badges.map((b) => ({ idc: b.idc, label: b.label })),
            abos: abos.map((a) => ({ idc: a.idc, label: a.label.slice(0, 80) })),
          });
          console.log('BADGE_WRONG', c.name, c.member, badges.map((b) => b.idc).join(','));
        } else {
          report.deciplus.badge_ok.push({ name: c.name, member: c.member, order_id: c.order_id });
        }
      } catch (err) {
        report.deciplus.badge_fail.push({
          name: c.name,
          member: c.member,
          order_id: c.order_id,
          error: String(err.message || err).slice(0, 140),
        });
        console.error('BADGE_FAIL', c.name, c.member, String(err.message || err).slice(0, 80));
        await closeGreyboxIfOpen(page).catch(() => {});
      }
      if (n % 5 === 0) save(report);
    }
  });
  await closeBrowser().catch(() => {});
  report.at = new Date().toISOString();
  save(report);
  console.log('\nWrote', OUT);
  console.log(
    JSON.stringify(
      {
        rib_missing_deciplus: report.deciplus.rib_missing.length,
        rib_ok_deciplus: report.deciplus.rib_ok.length,
        rib_fail: report.deciplus.rib_fail.length,
        badge_wrong: report.deciplus.badge_wrong.length,
        badge_ok: report.deciplus.badge_ok.length,
        badge_fail: report.deciplus.badge_fail.length,
      },
      null,
      2
    )
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
