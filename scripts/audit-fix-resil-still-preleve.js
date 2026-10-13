#!/usr/bin/env node
'use strict';
/**
 * Audit + fix : résiliations web marquées done/error mais encore des
 * prélèvements actifs sur Deciplus. Annule les contrats restants.
 *
 *   node scripts/audit-fix-resil-still-preleve.js --check
 *   node scripts/audit-fix-resil-still-preleve.js --apply
 *   node scripts/audit-fix-resil-still-preleve.js --apply --priority-only
 *   node scripts/audit-fix-resil-still-preleve.js --apply --member=22594
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.BOT_ID = process.env.BOT_ID || 'local-audit-resil';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;
delete process.env.BOXPLUS_BOT_URL_SALES_2;

const fs = require('fs');
const path = require('path');
const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check') || !APPLY;
const PRIORITY_ONLY = process.argv.includes('--priority-only');
const MEMBER_ARG = (process.argv.find((a) => a.startsWith('--member=')) || '').slice(9);
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-08-01T00:00:00.000Z';
const OUT = path.join(__dirname, '..', 'data', `audit-fix-resil-still-preleve-${Date.now()}.json`);

const { getSupabase } = require('../storefront/lib/supabase');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const {
  findActiveContracts,
  cancelSale,
  openContractPage,
  stopFutureScheduledPayments,
  reopenMemberAfterCancel,
} = require('../bot/cancel-sale');
const { isStaleOrInactiveAbo } = require('../lib/replace-existing-abo');

function looksLikePrelevement(label) {
  const t = String(label || '');
  if (/\bbadge\b/i.test(t) && !/essai|coaching/i.test(t)) return false;
  if (/pr[ée]l[èe]vement|4\s*semaines|sans\s*engagement|iban|sepa|mensuel|hebdo/i.test(t)) {
    return true;
  }
  // Abo actif sans marqueur comptant explicite = suspect prélèvement
  if (/comptant|259\s*€|12\s*mois|promo\s*12|1\s*[x×]\s*ou\s*4|forfait\s*annuel|baby\s*boxe|boxe\s*[eé]ducative/i.test(t)) {
    return false;
  }
  return /abonnement|contrat|offre|étudiant|etudiant|44[,.]?99|34[,.]?99|29[,.]?99|36[,.]?99/i.test(t);
}

function looksLikeResiliatedPrelevement(label) {
  const t = String(label || '');
  if (!isStaleOrInactiveAbo(t) && !/r[eéÉ]sili|annul/i.test(t)) return false;
  if (/\bbadge\b/i.test(t) && !/essai|coaching/i.test(t)) return true; // badge résilié peut garder échéance
  return looksLikePrelevement(t) || /r[eéÉ]sili|annul/i.test(t);
}

function rowName(p) {
  const c = p.customer || {};
  return `${c.first_name || p.first_name || ''} ${c.last_name || p.last_name || ''}`.trim();
}

async function loadCancelTargets() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, payload, created_at')
    .gte('created_at', SINCE)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;

  const cancels = (data || [])
    .map((r) => ({ ...(r.payload || {}), order_id: r.order_id, created_at: r.created_at }))
    .filter((p) => p.action === 'cancel' || String(p.order_id || '').startsWith('CANCEL-'));

  const byMember = new Map();
  for (const c of cancels) {
    const mid = c.deciplus_member_id ? String(c.deciplus_member_id) : null;
    if (!mid) continue;
    const st = String(c.cancel_status || c.bot_status || '').toLowerCase();
    const zeroDone = (st === 'done' || st === 'success') && Number(c.cancelled_count || 0) === 0;
    const errored = st === 'error' || st === 'failover';
    const done = st === 'done' || st === 'success';
    if (!done && !errored) continue;
    if (PRIORITY_ONLY && !zeroDone && !errored) continue;
    const prev = byMember.get(mid) || {
      member_id: mid,
      name: rowName(c),
      email: c.customer?.email || c.email || null,
      orders: [],
      priority: false,
    };
    prev.orders.push({
      order_id: c.order_id,
      cancel_status: c.cancel_status || null,
      cancelled_count: c.cancelled_count ?? null,
      cancel_date: c.cancel_date || null,
      created_at: c.created_at,
    });
    if (zeroDone || errored) prev.priority = true;
    if (!prev.name) prev.name = rowName(c);
    byMember.set(mid, prev);
  }

  let list = [...byMember.values()].sort((a, b) => Number(b.priority) - Number(a.priority));
  if (MEMBER_ARG) list = list.filter((r) => r.member_id === String(MEMBER_ARG));
  return list;
}

async function inspectMember(page, memberId) {
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId);
  const contracts = await findActiveContracts(page);
  const allContracts = await findActiveContracts(page, { includeInactive: true });
  const active = contracts.map((c) => ({
    idc: c.idc,
    label: c.label,
    isBadge: Boolean(c.isBadge),
    prelevement: !c.isBadge && looksLikePrelevement(c.label),
  }));
  const needCancel = active.filter((c) => c.prelevement);
  const resiliatedSuspects = allContracts
    .filter((c) => looksLikeResiliatedPrelevement(c.label) || c.isBadge)
    .filter((c) => !needCancel.some((n) => String(n.idc) === String(c.idc)))
    .map((c) => ({
      idc: c.idc,
      label: c.label,
      isBadge: Boolean(c.isBadge),
      contract: c,
    }));
  return {
    active,
    need_cancel: needCancel,
    resiliated_suspects: resiliatedSuspects.map(({ idc, label, isBadge }) => ({ idc, label, isBadge })),
    _resiliatedContracts: resiliatedSuspects.map((r) => r.contract),
  };
}

async function stopPaymentsOnContracts(page, memberId, contracts) {
  const stopped = [];
  for (const contract of contracts) {
    try {
      await reopenMemberAfterCancel(page, memberId);
      const opened = await openContractPage(page, contract);
      if (!opened) {
        stopped.push({ idc: contract.idc, ok: false, reason: 'open_failed' });
        continue;
      }
      const payments = await stopFutureScheduledPayments(page);
      stopped.push({
        idc: contract.idc,
        ok: true,
        payments_stopped: payments.stopped || 0,
        label: String(contract.label || '').slice(0, 80),
      });
    } catch (err) {
      stopped.push({
        idc: contract.idc,
        ok: false,
        reason: String(err.message || err).slice(0, 200),
      });
    }
  }
  return stopped;
}

(async () => {
  const targets = await loadCancelTargets();
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'check',
        since: SINCE,
        priority_only: PRIORITY_ONLY,
        targets: targets.length,
        members: targets.map((t) => ({
          member_id: t.member_id,
          name: t.name,
          priority: t.priority,
          orders: t.orders.length,
        })),
      },
      null,
      2
    )
  );

  const results = [];
  try {
    await runWithSession('audit-fix-resil-still-preleve', async (page) => {
      for (const t of targets) {
        const report = {
          member_id: t.member_id,
          name: t.name,
          email: t.email,
          priority: t.priority,
          orders: t.orders,
        };
        console.log(`\n=== ${t.name || '?'} #${t.member_id} ===`);
        try {
          const before = await inspectMember(page, t.member_id);
          const resiliatedContracts = before._resiliatedContracts || [];
          report.before = {
            active: before.active,
            need_cancel: before.need_cancel,
            resiliated_suspects: before.resiliated_suspects,
          };
          console.log(
            JSON.stringify(
              {
                active: before.active.length,
                need_cancel: before.need_cancel.map((c) => `${c.idc}:${c.label?.slice(0, 60)}`),
                resiliated_suspects: before.resiliated_suspects.map(
                  (c) => `${c.idc}:${c.label?.slice(0, 60)}`
                ),
              },
              null,
              2
            )
          );

          const hasWork = before.need_cancel.length > 0 || resiliatedContracts.length > 0;
          if (!hasWork) {
            report.action = 'already_clean';
            results.push(report);
            continue;
          }

          if (!APPLY) {
            report.action = 'would_fix';
            results.push(report);
            continue;
          }

          if (before.need_cancel.length) {
            const outcome = await cancelSale(page, t.member_id, {
              cancelDate: new Date(),
              cancelReason: 'resiliation_web_catchup',
            });
            report.cancel_outcome = {
              cancelled_count: outcome.cancelled_count,
              already: outcome.already || false,
              refused: outcome.refused || false,
              reason: outcome.reason || null,
              details: outcome.details || [],
            };
          }

          // Même sur contrats déjà résiliés : couper les échéances encore programmées.
          const suspects =
            resiliatedContracts.length > 0
              ? resiliatedContracts
              : (await inspectMember(page, t.member_id))._resiliatedContracts || [];
          if (suspects.length) {
            report.payments_stopped = await stopPaymentsOnContracts(page, t.member_id, suspects);
            console.log('PAYMENTS', JSON.stringify(report.payments_stopped, null, 2));
          }

          const after = await inspectMember(page, t.member_id).catch(() => null);
          report.after = after
            ? {
                active: after.active,
                need_cancel: after.need_cancel,
                resiliated_suspects: after.resiliated_suspects,
              }
            : null;
          const paymentsOk = (report.payments_stopped || []).every((p) => p.ok);
          const stillActive = after && after.need_cancel.length > 0;
          report.action = stillActive
            ? 'cancelled_partial'
            : paymentsOk || !suspects.length
              ? 'fixed_ok'
              : 'payments_partial';
          if (report.cancel_outcome) console.log(JSON.stringify(report.cancel_outcome, null, 2));
        } catch (err) {
          report.action = 'error';
          report.error = String(err.message || err).slice(0, 400);
          console.error('FAIL', t.member_id, report.error);
        }
        results.push(report);
      }
    });
  } finally {
    await closeBrowser().catch(() => {});
  }

  const summary = {
    at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'check',
    scanned: results.length,
    still_preleve: results.filter((r) => (r.before?.need_cancel || []).length > 0).length,
    had_resiliated_suspects: results.filter((r) => (r.before?.resiliated_suspects || []).length > 0)
      .length,
    fixed_ok: results.filter((r) => r.action === 'fixed_ok' || r.action === 'cancelled_ok').length,
    already_clean: results.filter((r) => r.action === 'already_clean').length,
    payments_stopped_total: results.reduce(
      (n, r) => n + (r.payments_stopped || []).reduce((a, p) => a + Number(p.payments_stopped || 0), 0),
      0
    ),
    errors: results.filter((r) => r.action === 'error').length,
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\nSUMMARY', JSON.stringify({ ...summary, results: undefined }, null, 2));
  console.log('Wrote', OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
