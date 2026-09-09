#!/usr/bin/env node
'use strict';
/**
 * Depuis le 1er juin 2026 (hors Balma) : fiches Deciplus avec 2 ventes d’abo actives.
 *
 *   node scripts/audit-double-abo-june.js
 *   node scripts/audit-double-abo-june.js --deciplus
 *   node scripts/audit-double-abo-june.js --deciplus --resume
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
const { isCartePrestationOrder, isDeciplusBadgeLabel } = require('../lib/catalog-sale');
const { isAventureOrder } = require('../lib/aventure-policy');
const { isStaleOrInactiveAbo, leftoverBlocksNewSale } = require('../lib/replace-existing-abo');
const { isBalmaGymSlug, matchGymSlug, resolveSaleGymConfig } = require('../lib/gym-slugs');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');

const SINCE = '2026-06-01T00:00:00+02:00';
const DECIPLUS = process.argv.includes('--deciplus');
const RESUME = process.argv.includes('--resume');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'audit-double-abo-since-june.json');
const RIB_BADGE = path.join(DATA_DIR, 'audit-rib-badge-since-june.json');

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
function isTestRow(name, email) {
  return /\btest\b|boxplus-test|@boxplus-test\.local/.test(`${name || ''} ${email || ''}`.toLowerCase());
}
function isAboOrder(p) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (isCartePrestationOrder(p)) return false;
  const hay = `${p.product_snapshot?.name || ''} ${p.product_name || ''} ${p.product_id || ''}`;
  if (/essai|coaching|materiel/i.test(hay)) return false;
  return true;
}
function slim(c) {
  const label = String(c.label || '').replace(/\s+/g, ' ').slice(0, 140);
  return {
    idc: c.idc,
    pending: isPendingOrFutureContract(label),
    label,
  };
}

async function loadMembers() {
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
  const byMember = new Map();
  let skippedBalma = 0;
  for (const row of rows) {
    const p = row.payload || {};
    const gym = gymSlugOf(p);
    if (isBalmaRow(p, gym)) {
      skippedBalma += 1;
      continue;
    }
    if (!isAboOrder(p)) continue;
    const member = String(p.deciplus_member_id || '').trim();
    if (!/^\d+$/.test(member)) continue;
    const name = nameOf(p);
    const email = emailOf(p);
    if (isTestRow(name, email)) continue;
    const prev = byMember.get(member);
    const paidAt = p.payment?.paid_at || row.created_at;
    if (!prev || Date.parse(paidAt) > Date.parse(prev.paid_at || 0)) {
      byMember.set(member, {
        order_id: row.order_id,
        name,
        email: email || null,
        gym: gym || 'minimes',
        member,
        product: p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name,
        paid_at: paidAt,
      });
    }
  }
  return { skippedBalma, orders: rows.length, members: [...byMember.values()] };
}

function classifyContracts(list) {
  const abos = (list || [])
    .filter((c) => c && !c.isBadge && !isDeciplusBadgeLabel(c.label))
    .filter((c) => leftoverBlocksNewSale(c) && !isStaleOrInactiveAbo(c.label));
  const started = abos.filter((c) => !isPendingOrFutureContract(c.label)).map(slim);
  const pending = abos.filter((c) => isPendingOrFutureContract(c.label)).map(slim);
  return { started, pending, live: [...started, ...pending] };
}

function recapBlock(report) {
  const d = report.deciplus || {};
  const lines = [
    '=== RÉCAP doubles ventes (hors Balma, depuis 2026-06-01) ===',
    `Fiches vérifiées : ${d.ok?.length || 0}`,
    `Doubles ventes : ${d.doubles?.length || 0}`,
    `Échecs lecture : ${d.fail?.length || 0}`,
  ];
  for (const x of d.doubles || []) {
    const ids = (x.live || []).map((c) => c.idc).join(', ');
    lines.push(`- ${x.name} · ${x.gym} · membre ${x.member} · ${x.product} · ventes ${ids}`);
  }
  return lines.join('\n');
}

function fullRecap(doubleReport) {
  const lines = ['', '========== RÉCAP ANALYSE 1er juin → 9 sept 2026 (hors Balma) =========='];
  if (fs.existsSync(RIB_BADGE)) {
    const r = JSON.parse(fs.readFileSync(RIB_BADGE, 'utf8'));
    const d = r.deciplus || {};
    const noMember = r.rib_missing_no_member || [];
    lines.push('', '1) Prélèvement sans RIB Deciplus');
    for (const x of d.rib_missing || []) {
      lines.push(`- ${x.name} · ${x.channel} · membre ${x.member} · ${x.product || ''}`);
    }
    for (const x of noMember) {
      lines.push(`- ${x.name} · pas de fiche Deciplus · ${x.product} · ${x.day}`);
    }
    if (!(d.rib_missing || []).length && !noMember.length) lines.push('- aucun');
    lines.push('', '2) Abonnement comptant + Badge encore ACTIF');
    for (const x of d.badge_wrong || []) {
      const ids = (x.badges || []).map((b) => b.idc).join(', ');
      lines.push(`- ${x.name} · ${x.gym} · membre ${x.member} · ${x.product} · badge ${ids}`);
    }
    if (!(d.badge_wrong || []).length) lines.push('- aucun');
  }
  lines.push('', recapBlock(doubleReport));
  return lines.join('\n');
}

function save(report) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
}

(async () => {
  let report = RESUME && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (!report || !report.members) {
    const loaded = await loadMembers();
    report = {
      at: new Date().toISOString(),
      since: '2026-06-01',
      until: '2026-09-09',
      skip_balma: true,
      orders_scanned: loaded.orders,
      skipped_balma: loaded.skippedBalma,
      members: loaded.members,
      deciplus: { doubles: [], ok: [], fail: [] },
    };
    save(report);
    console.log(
      JSON.stringify(
        {
          orders: loaded.orders,
          skipped_balma: loaded.skippedBalma,
          members: loaded.members.length,
        },
        null,
        2
      )
    );
  }

  if (!DECIPLUS) {
    console.log('\nCibles écrites', OUT, '— relancer avec --deciplus');
    return;
  }

  if (!report.deciplus) report.deciplus = { doubles: [], ok: [], fail: [] };
  const done = new Set(
    [...(report.deciplus.doubles || []), ...(report.deciplus.ok || []), ...(report.deciplus.fail || [])].map((x) =>
      String(x.member)
    )
  );
  const targets = report.members.filter((m) => !done.has(String(m.member)));
  console.log('Deciplus doubles à vérifier', targets.length, 'déjà', done.size, '/', report.members.length);

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');

  await runWithSession('audit-double-abo-june', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
    let n = done.size;
    const total = report.members.length;
    for (const c of targets) {
      n += 1;
      try {
        await closeGreyboxIfOpen(page).catch(() => {});
        await openMemberCheck(page, String(c.member), resolveSaleGymConfig(c.gym || 'minimes', { gym: c.gym }));
        const list = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
        const { started, pending, live } = classifyContracts(list);
        const row = {
          order_id: c.order_id,
          name: c.name,
          email: c.email,
          member: c.member,
          gym: c.gym,
          product: c.product,
          started,
          pending,
          live,
        };
        if (live.length >= 2) {
          report.deciplus.doubles.push(row);
          console.log(`DOUBLE ${n}/${total}`, c.name, c.member, live.map((x) => x.idc).join(','));
        } else {
          report.deciplus.ok.push({ name: c.name, member: c.member, order_id: c.order_id, n_abo: live.length });
          if (n % 10 === 0) console.log(`OK ${n}/${total}`, c.name, live.length, 'abo');
        }
      } catch (err) {
        report.deciplus.fail.push({
          name: c.name,
          member: c.member,
          order_id: c.order_id,
          error: String(err.message || err).slice(0, 140),
        });
        console.error(`FAIL ${n}/${total}`, c.name, c.member, String(err.message || err).slice(0, 80));
        await closeGreyboxIfOpen(page).catch(() => {});
      }
      if (n % 5 === 0) save(report);
    }
  });
  await closeBrowser().catch(() => {});
  report.at = new Date().toISOString();
  save(report);
  const recap = fullRecap(report);
  console.log('\n' + recap);
  fs.writeFileSync(path.join(DATA_DIR, 'audit-recap-since-june.txt'), recap);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
