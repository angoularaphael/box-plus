#!/usr/bin/env node
'use strict';
/**
 * Dossiers payés dont la fiche Deciplus demande encore d'enregistrer le RIB.
 *   node scripts/_tmp-fix-unregistered-ribs.js
 *   node scripts/_tmp-fix-unregistered-ribs.js --apply
 *   node scripts/_tmp-fix-unregistered-ribs.js --apply --only=ouaksel
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.TEMP = process.env.TEMP || 'D:\\tmp-playwright';
process.env.TMP = process.env.TMP || 'D:\\tmp-playwright';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-09-27';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = path.join(__dirname, '..', 'data', `fix-unregistered-ribs-${Date.now()}.json`);

const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { normalizeIban, isValidFrenchIban } = require('../lib/iban');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const {
  openMemberCheck,
  closeGreyboxIfOpen,
  openRibForm,
  setMemberIban,
  fillRibForm,
  submitRibForm,
  ribMandateNeedsSave,
} = require('../bot/wallet');

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.trim();
}

function wantsRib(p) {
  const name = String(
    p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || ''
  );
  const billing = String(p.billing_plan || p.payment?.billing_plan || '').toLowerCase();
  const plan = String(
    p.payment_plan || p.payment?.payment_plan || p.payment?.plan || ''
  ).toLowerCase();
  const requires =
    p.requires_iban === true ||
    p.product_snapshot?.requires_iban === true ||
    billing === 'rib' ||
    p.payment?.payplug_4x_prelevement === true;
  const hay = `${name} ${billing} ${plan}`;
  if (/scalapay/i.test(hay)) return false;
  if (/s[eé]ance d['’]?\s*essai|\bessai\b/i.test(name)) return false;
  if (/mat[eé]riel|gant|bandage|prot[eè]ge/i.test(name) && billing !== 'rib') return false;
  // 29 € / duo : souvent payment_plan=once (1er mois CB) + billing=rib (SEPA ensuite).
  if (requires || billing === 'rib') return true;
  if (billing === 'comptant' || plan === 'comptant') return false;
  if (plan === 'once') return false;
  return true;
}

async function loadOrders() {
  const sb = getSupabase();
  const since = new Date(`${SINCE}T00:00:00+02:00`).toISOString();
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, payload, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 399);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 400) break;
    from += 400;
  }

  const rows = [];
  const seen = new Set();
  for (const r of all) {
    const p = r.payload || {};
    p.order_id = p.order_id || r.order_id;
    if (!/^BC-/i.test(p.order_id)) continue;
    if (String(p.payment?.status || '').toLowerCase() !== 'paid') continue;
    if (!wantsRib(p)) continue;
    const member = String(p.deciplus_member_id || '').replace(/\D/g, '');
    if (!member || seen.has(member)) continue;
    const iban = normalizeIban(p.payment?.iban || p.customer_full?.iban || '');
    if (!isValidFrenchIban(iban)) continue;
    const name = rowName(p);
    const hay = `${name} ${p.order_id} ${member}`.toLowerCase();
    if (ONLY && !ONLY.split(',').some((s) => hay.includes(s.trim()))) continue;
    seen.add(member);
    rows.push({
      order_id: p.order_id,
      name,
      gym: p.customer_full?.gym || p.gym || 'minimes',
      member_id: member,
      product: p.product_snapshot?.name || p.product_name || '',
      iban,
      customer: {
        ...(p.customer || {}),
        ...(p.customer_full || {}),
        first_name: p.customer?.first_name || p.customer_short?.first_name || p.customer_full?.first_name,
        last_name: p.customer?.last_name || p.customer_short?.last_name || p.customer_full?.last_name,
      },
      created_at: r.created_at,
    });
  }
  rows.sort((a, b) => {
    const rank = (n) => (/ouaksel/i.test(n) ? 0 : /drummond/i.test(n) ? 1 : 2);
    return rank(a.name) - rank(b.name);
  });
  return rows;
}

async function pageBlob(page) {
  const parts = [];
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    try {
      const t = await ctx.locator('body').innerText({ timeout: 2500 });
      if (t) parts.push(t);
    } catch {
      /* frame */
    }
  }
  return parts.join('\n').replace(/\s+/g, ' ');
}

function alertOn(text) {
  // Bandeau rouge uniquement — pas le texte générique des menus HTML.
  return /veuillez\s+enregistrer\s+le\s+rib|enregistrer\s+le\s+rib\s+du\s+membre/i.test(text);
}

function alertSnippet(text) {
  const i = text.search(/enregistrer le rib/i);
  if (i < 0) return '';
  return text.slice(Math.max(0, i - 40), i + 220);
}

async function readRibState(page, memberId) {
  const ctx = await openRibForm(page, memberId, { forceFresh: true });
  const meta = await ctx
    .evaluate(() => ({
      iban: document.querySelector('input[name="iban"]')?.value || '',
      rum: document.querySelector('input[name="rum"]')?.value || '',
      date: document.querySelector('input[name="date_mandat"]')?.value || '',
    }))
    .catch(() => ({ iban: '', rum: '', date: '' }));
  const needs = await ribMandateNeedsSave(ctx).catch(() => false);
  await closeGreyboxIfOpen(page).catch(() => {});
  return {
    iban: normalizeIban(meta.iban),
    rum: meta.rum || '',
    date: meta.date || '',
    needs_save: needs,
  };
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  fs.mkdirSync(process.env.TEMP, { recursive: true });

  const orders = await loadOrders();
  console.log(`${APPLY ? 'APPLY' : 'CHECK'} — ${orders.length} dossier(s) RIB depuis ${SINCE}`);

  const results = [];
  await runWithSession('fix-unregistered-ribs', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
    let currentSite = '';
    for (const row of orders) {
      const gym = getGymConfig(row.gym === 'etats-unis' ? 'minimes' : row.gym);
      const site = gym.deciplus_label || 'Minimes';
      const entry = { name: row.name, member_id: row.member_id, product: row.product, site };
      try {
        if (site !== currentSite) {
          await switchDeciplusSite(page, site);
          currentSite = site;
        }
        await closeGreyboxIfOpen(page).catch(() => {});
        const { openMemberDetail, ficheRibCleared } = require('../bot/wallet');
        await openMemberCheck(page, row.member_id, gym);
        const beforeCheck = await pageBlob(page);
        await openMemberDetail(page, row.member_id).catch(() => {});
        const beforeDetail = await pageBlob(page);
        const before = `${beforeCheck}\n${beforeDetail}`;
        const alert = alertOn(before);
        entry.snippet = alertSnippet(before);
        const rib = await readRibState(page, row.member_id).catch((err) => ({ error: err.message }));
        entry.rib_before = {
          rum: rib.rum || '',
          needs_save: Boolean(rib.needs_save),
          has_iban: Boolean(rib.iban),
          iban_suffix: rib.iban ? String(rib.iban).slice(-4) : '',
          error: rib.error || null,
        };
        // Vraie erreur = bandeau fiche « enregistrer le RIB » (check.php OU joueurs.php),
        // ou pas de RUM alors qu’on attend un mandat.
        const broken =
          FORCE ||
          alert ||
          Boolean(rib.error) ||
          (!rib.rum && Boolean(rib.needs_save)) ||
          (Boolean(rib.rum) && !rib.iban);
        entry.alert_before = broken;
        if (!broken) {
          entry.status = 'ok';
          console.log(
            `ok | ${row.name} | ${row.member_id} | rum=${rib.rum || '-'} needs_save=${Boolean(rib.needs_save)}`
          );
          results.push(entry);
          continue;
        }
        console.log(
          `mandat_a_revalider | ${row.name} | ${row.member_id} | alert=${alert} needs_save=${Boolean(rib.needs_save)} rum=${rib.rum || '-'} iban=${Boolean(rib.iban)}`
        );
        if (!APPLY) {
          entry.status = 'alerte';
          results.push(entry);
          continue;
        }
        let saved = await setMemberIban(page, row.member_id, row.iban, row.customer, gym).catch((err) => ({
          error: err.message,
        }));
        if (saved !== true) {
          const ctx = await openRibForm(page, row.member_id, { forceFresh: true });
          await fillRibForm(ctx, row.iban, row.customer, gym);
          await submitRibForm(ctx, page);
          const { postCurrentRibForm } = require('../bot/wallet');
          await postCurrentRibForm(ctx);
          await closeGreyboxIfOpen(page).catch(() => {});
          saved = saved?.error ? `force_post:${saved.error}` : 'force_post';
        }
        await closeGreyboxIfOpen(page).catch(() => {});
        const cleared = await ficheRibCleared(page, row.member_id, gym).catch(() => false);
        const ribAfter = await readRibState(page, row.member_id).catch(() => ({}));
        const stillBroken =
          !cleared || (!ribAfter.rum && Boolean(ribAfter.needs_save)) || (Boolean(ribAfter.rum) && !ribAfter.iban);
        entry.alert_after = stillBroken;
        entry.rib_after = {
          rum: ribAfter.rum || '',
          needs_save: Boolean(ribAfter.needs_save),
          has_iban: Boolean(ribAfter.iban),
        };
        entry.snippet_after = '';
        entry.saved = saved === true ? 'ok' : saved;
        entry.status = stillBroken ? 'encore' : 'fixe';
        console.log(`${entry.status} | ${row.name} | ${row.member_id} | ${entry.saved}`);
        results.push(entry);
      } catch (err) {
        entry.status = 'erreur';
        entry.error = String(err.message || err).slice(0, 180);
        console.log(`erreur | ${row.name} | ${row.member_id} | ${entry.error}`);
        results.push(entry);
      }
    }
  });

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    alerte: results.filter((r) => r.status === 'alerte').length,
    fixe: results.filter((r) => r.status === 'fixe').length,
    encore: results.filter((r) => r.status === 'encore').map((r) => r.name),
    erreur: results.filter((r) => r.status === 'erreur').map((r) => ({ name: r.name, error: r.error })),
  };
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, summary, results }, null, 2));
  console.log('écrit', OUT);
  console.log(JSON.stringify(summary));
  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
