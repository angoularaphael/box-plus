#!/usr/bin/env node
'use strict';
/**
 * 1) Retire les badges des abos comptant (audit juin)
 * 2) Annule les contrats en trop (en attente / leftover)
 * 3) Liste les fiches avec exactement 1 impayé Deciplus
 *
 *   node scripts/fix-june-badges-doubles-unpaid.js --apply
 *   node scripts/fix-june-badges-doubles-unpaid.js --apply --skip-unpaid
 *   node scripts/fix-june-badges-doubles-unpaid.js --unpaid-only
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
const { resolveSaleGymConfig } = require('../lib/gym-slugs');
const { isStaleOrInactiveAbo, leftoverBlocksNewSale } = require('../lib/replace-existing-abo');
const { isDeciplusBadgeLabel } = require('../lib/catalog-sale');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');

const APPLY = process.argv.includes('--apply');
const UNPAID_ONLY = process.argv.includes('--unpaid-only');
const SKIP_UNPAID = process.argv.includes('--skip-unpaid');
const DATA_DIR = path.join(__dirname, '..', 'data');
const BADGE_FILE = path.join(DATA_DIR, 'audit-rib-badge-since-june.json');
const DOUBLE_FILE = path.join(DATA_DIR, 'audit-double-abo-since-june.json');
const OUT = path.join(DATA_DIR, `fix-june-badges-doubles-${Date.now()}.json`);

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function slim(c) {
  return {
    idc: String(c.idc),
    badge: Boolean(c.isBadge) || isDeciplusBadgeLabel(c.label),
    pending: isPendingOrFutureContract(c.label),
    stale: isStaleOrInactiveAbo(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 140),
  };
}

function productHay(product) {
  return String(product || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function keepScore(c, product) {
  const label = String(c.label || '');
  const hay = productHay(product);
  const lhay = productHay(label);
  let s = 0;
  if (/jours restants/i.test(label)) s += 80;
  if (/annul/i.test(label)) s -= 200;
  if (/en attente/i.test(label)) s -= 50;
  if (/ete 2026|3 mois illimit/i.test(lhay)) s -= 60;
  if (/etudiant/i.test(lhay) && /12\s*mois|259|promo/.test(hay)) s -= 80;
  if (/baby/.test(hay) && /baby/.test(lhay)) s += 90;
  if (/educativ/.test(hay) && /educativ|enfants 295/.test(lhay)) s += 90;
  if (/12\s*mois|259|promo/.test(hay) && /promo 12|259/.test(lhay)) s += 90;
  if (/29/.test(hay) && /29|duo/.test(lhay)) s += 90;
  if (/44/.test(hay) && /44/.test(lhay)) s += 90;
  s += Number(c.idc) / 20000;
  return s;
}

function pickKeeper(started, product) {
  if (!started.length) return null;
  return [...started].sort((a, b) => keepScore(b, product) - keepScore(a, product))[0];
}

function mergeTargets() {
  const byMember = new Map();
  const badges = loadJson(BADGE_FILE).deciplus?.badge_wrong || [];
  const doubles = loadJson(DOUBLE_FILE).deciplus?.doubles || [];
  for (const x of badges) {
    byMember.set(String(x.member), {
      member: String(x.member),
      name: x.name,
      email: x.email || null,
      gym: x.gym || 'minimes',
      product: x.product,
      order_id: x.order_id,
      remove_badge: true,
      fix_double: false,
    });
  }
  for (const x of doubles) {
    const prev = byMember.get(String(x.member)) || {
      member: String(x.member),
      name: x.name,
      email: x.email || null,
      gym: x.gym || 'minimes',
      product: x.product,
      order_id: x.order_id,
      remove_badge: false,
      fix_double: false,
    };
    prev.fix_double = true;
    prev.product = prev.product || x.product;
    prev.live = x.live;
    byMember.set(String(x.member), prev);
  }
  return [...byMember.values()];
}

function unpaidMembers() {
  const members = loadJson(DOUBLE_FILE).members || [];
  const extra = (loadJson(BADGE_FILE).deciplus?.rib_missing || []).map((x) => ({
    member: String(x.member),
    name: x.name,
    gym: x.gym || 'minimes',
    product: x.product,
    email: x.email || null,
  }));
  const by = new Map();
  for (const m of [...members, ...extra]) {
    if (!m.member || !/^\d+$/.test(String(m.member))) continue;
    if (!by.has(String(m.member))) by.set(String(m.member), m);
  }
  return [...by.values()];
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts, cancelOneContract } = require('../bot/cancel-sale');
  const { countUnpaidRows } = require('../bot/unpaid-clean');
  const { isActiveBadgeContract } = require('../bot/sale');

  const report = {
    at: new Date().toISOString(),
    apply: APPLY,
    results: [],
    unpaid_one: [],
    unpaid_more: [],
    unpaid_fail: [],
  };

  const targets = UNPAID_ONLY ? [] : mergeTargets();
  console.log(APPLY ? 'APPLY' : 'CHECK', 'cibles', targets.length);

  await runWithSession('fix-june-badges-doubles', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));

    for (const t of targets) {
      const gym = resolveSaleGymConfig(t.gym || 'minimes', { gym: t.gym });
      console.log('\n===', t.name, t.member, t.product, t.remove_badge ? 'badge' : '', t.fix_double ? 'double' : '');
      const row = { ...t, cancelled: [], status: 'ok' };
      try {
        await closeGreyboxIfOpen(page).catch(() => {});
        await openMemberCheck(page, t.member, gym);
        let contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
        const badges = contracts.filter((c) => isActiveBadgeContract(c) || (c.isBadge && !isStaleOrInactiveAbo(c.label)));
        const abos = contracts
          .filter((c) => !c.isBadge && leftoverBlocksNewSale(c))
          .map(slim);
        const started = abos.filter((c) => !c.pending && !c.stale);
        const pending = abos.filter((c) => c.pending);

        const toCancel = [];
        if (t.remove_badge) {
          for (const b of badges) toCancel.push({ ...b, why: 'badge_comptant' });
        }
        if (t.fix_double) {
          for (const p of pending) toCancel.push({ ...p, why: 'pending_extra' });
          if (started.length > 1) {
            const keeper = pickKeeper(started, t.product);
            for (const s of started) {
              if (String(s.idc) !== String(keeper.idc)) toCancel.push({ ...s, why: 'abo_extra', keep: keeper.idc });
            }
            row.keeper = keeper?.idc || null;
          }
        }

        const seen = new Set();
        const uniq = toCancel.filter((c) => {
          if (seen.has(String(c.idc))) return false;
          seen.add(String(c.idc));
          return true;
        });
        row.plan = uniq.map((c) => ({ idc: c.idc, why: c.why, label: c.label }));
        console.log('  plan', row.plan.map((p) => `${p.why}:${p.idc}`).join(' ') || 'rien');

        if (!APPLY || !uniq.length) {
          row.status = uniq.length ? 'needs_fix' : 'ok';
          report.results.push(row);
          continue;
        }

        for (const c of uniq) {
          const raw = contracts.find((x) => String(x.idc) === String(c.idc)) || c;
          const out = await cancelOneContract(page, raw, { forceVoid: true });
          row.cancelled.push({ idc: c.idc, why: c.why, ...out });
          console.log('  cancel', c.why, c.idc, out.cancelled ? 'OK' : out.reason);
          await closeGreyboxIfOpen(page).catch(() => {});
          await openMemberCheck(page, t.member, gym).catch(() => {});
          contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
        }
        const after = contracts.map(slim);
        row.after_badges = after.filter((c) => c.badge && !c.stale).map((c) => c.idc);
        row.after_abos = after.filter((c) => !c.badge && leftoverBlocksNewSale(c)).map((c) => c.idc);
        row.status = 'done';
      } catch (err) {
        row.status = 'fail';
        row.error = String(err.message || err).slice(0, 160);
        console.error('  FAIL', err.message);
        await closeGreyboxIfOpen(page).catch(() => {});
      }
      report.results.push(row);
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    }

    if (!SKIP_UNPAID) {
      console.log('\n--- Impayés : découverte liste globale ---');
      const origin = new URL(page.url()).origin;
      const foundLinks = await page
        .evaluate(() =>
          [...document.querySelectorAll('a')]
            .map((a) => ({ href: a.href, text: String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) }))
            .filter((a) => /impay|echeance|trésor|tresor|facture/i.test(`${a.href} ${a.text}`))
        )
        .catch(() => []);
      report.unpaid_nav = foundLinks.slice(0, 30);
      console.log('  nav', foundLinks.slice(0, 8));

      const tryUrls = [
        ...foundLinks.map((l) => l.href),
        `${origin}/nextgen/unpaid`,
        `${origin}/nextgen/invoices`,
        `${origin}/nextgen/treasury`,
        `${origin}/impayes.php`,
        `${origin}/echeances.php`,
      ];
      let globalRows = [];
      for (const url of tryUrls) {
        if (!url) continue;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        const text = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 400);
        const n = await page.locator('tr:has-text("Impayé"), tr:has-text("Impayée")').count().catch(() => 0);
        if (n > 0) {
          globalRows = await page
            .evaluate(() =>
              [...document.querySelectorAll('tr')]
                .map((tr) => String(tr.innerText || '').replace(/\s+/g, ' ').trim())
                .filter((t) => /impay/i.test(t))
            )
            .catch(() => []);
          report.unpaid_global_url = url;
          report.unpaid_global_sample = globalRows.slice(0, 20);
          console.log('  GLOBAL', url, 'rows', globalRows.length);
          break;
        }
        if (/impay/i.test(text) && n === 0) {
          report.unpaid_global_url = url;
        }
      }

      const scan = unpaidMembers();
      console.log('--- Impayés fiche par fiche', scan.length);
      let i = 0;
      for (const m of scan) {
        i += 1;
        const gym = resolveSaleGymConfig(m.gym || 'minimes', { gym: m.gym });
        try {
          await closeGreyboxIfOpen(page).catch(() => {});
          await openMemberCheck(page, String(m.member), gym);
          const n = await countUnpaidRows(page);
          if (n === 1) {
            const snippet = await page
              .evaluate(() => {
                const tr = [...document.querySelectorAll('tr, .echeance, div')].find((el) =>
                  /impay/i.test(el.innerText || '')
                );
                return String(tr?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
              })
              .catch(() => '');
            report.unpaid_one.push({
              name: m.name,
              member: m.member,
              gym: m.gym,
              product: m.product,
              email: m.email || null,
              snippet,
            });
            console.log(`UNPAID1 ${i}/${scan.length}`, m.name, m.member, snippet.slice(0, 70));
          } else if (n > 1) {
            report.unpaid_more.push({ name: m.name, member: m.member, n, gym: m.gym });
            if (i % 20 === 0) console.log(`MORE ${i}/${scan.length}`, m.name, n);
          } else if (i % 25 === 0) {
            console.log(`OK0 ${i}/${scan.length}`, m.name);
          }
        } catch (err) {
          report.unpaid_fail.push({ name: m.name, member: m.member, error: String(err.message || err).slice(0, 120) });
          await closeGreyboxIfOpen(page).catch(() => {});
        }
        if (i % 8 === 0) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      }
    }
  });

  await closeBrowser().catch(() => {});
  report.at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nécrit', OUT);
  console.log(
    JSON.stringify(
      {
        fix: report.results.map((r) => ({ name: r.name, status: r.status, cancelled: (r.cancelled || []).length })),
        unpaid_one: report.unpaid_one.length,
        unpaid_more: report.unpaid_more.length,
      },
      null,
      2
    )
  );
})().catch(async (err) => {
  console.error(err);
  try {
    await require('../bot/browser-pool').closeBrowser();
  } catch {
    /* */
  }
  process.exit(1);
});
