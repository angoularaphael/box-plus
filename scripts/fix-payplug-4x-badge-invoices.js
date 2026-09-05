#!/usr/bin/env node
'use strict';
/**
 * Rattrapage 259 € en 4× PayPlug prélèvement (depuis hier) :
 * - analyse les commandes concernées
 * - annule les ventes Badge Deciplus en trop
 * - régénère les factures (libellé prélèvement, pas comptant)
 *
 *   node scripts/fix-payplug-4x-badge-invoices.js --check
 *   node scripts/fix-payplug-4x-badge-invoices.js --apply
 *   node scripts/fix-payplug-4x-badge-invoices.js --apply --email
 *   node scripts/fix-payplug-4x-badge-invoices.js --check --since=2026-09-04
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
const { isPayplug4xPrelevementOrder } = require('../lib/billing-plan');
const { offerDocumentCopy } = require('../lib/offer-document-copy');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
const { generateInscriptionInvoicePdf } = require('../storefront/lib/invoice-pdf');
const { sendConfirmationEmail } = require('../storefront/lib/mailer');

const CHECK = process.argv.includes('--check');
const APPLY = process.argv.includes('--apply');
const SEND_EMAIL = process.argv.includes('--email');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const SINCE_ARG = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);
const OUT = path.join(__dirname, '..', 'data', `fix-payplug-4x-badge-${Date.now()}.json`);

function defaultSinceIso() {
  if (SINCE_ARG) {
    const d = new Date(`${SINCE_ARG}T00:00:00+02:00`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.replace(/\s+/g, ' ').trim();
}

function is259SaisonProduct(p) {
  const productId = String(p.product_id || p.product_reference || '').toLowerCase();
  const productName = String(p.product_name || p.product_snapshot?.name || '').toUpperCase();
  if (productId === 'offre-duo' || productId === 'dp-104') return false;
  if (productId === 'baby-boxe' || productId === 'boxe-educative' || productId === 'dp-93' || productId === 'dp-45') {
    return false;
  }
  if (/OFFRE\s*A\s*29|OFFRE\s*DUO/i.test(productName)) return false;
  return (
    productId === 'dp-100' ||
    productId === 'offre-saison' ||
    /OFFRE\s*PROMO\s*12\s*MOIS/.test(productName) ||
    Number(p.product_snapshot?.price_cents || 0) === 25900
  );
}

function isTarget259Payplug4x(p) {
  if (!p || String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  if (String(p.payment?.method || '').toLowerCase() !== 'payplug') return false;
  if (!is259SaisonProduct(p)) return false;

  let amount = Number(p.payment?.amount);
  if (!Number.isFinite(amount) && p.payment?.amount_cents != null) {
    amount = Number(p.payment.amount_cents) / 100;
  }
  const quarter = 64.75;
  const isQuarter = Number.isFinite(amount) && Math.abs(amount - quarter) < 0.02;
  const is4x =
    isPayplug4xPrelevementOrder(p) ||
    p.payment?.payment_plan === '4x' ||
    p.payment_plan === '4x' ||
    (p.payment?.billing_plan === 'rib' || p.billing_plan === 'rib') ||
    isQuarter;

  return is4x;
}

function slimContracts(list) {
  return (list || []).map((c) => ({
    idc: c.idc,
    badge: Boolean(c.isBadge),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
}

async function loadTargets() {
  const sb = getSupabase();
  const since = defaultSinceIso();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, created_at, payload')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const found = [];
  for (const row of data || []) {
    const p = row.payload || {};
    const name = rowName(p);
    const hay = `${name} ${row.order_id} ${p.customer_short?.email || ''}`.toLowerCase();
    if (ONLY && !hay.includes(ONLY)) continue;
    if (!isTarget259Payplug4x(p)) continue;
    found.push({
      order_id: row.order_id,
      created_at: row.created_at,
      name,
      email: p.customer_short?.email || p.customer_full?.email || '',
      gym: p.customer_full?.gym || p.gym || 'minimes',
      member_id: p.deciplus_member_id || null,
      sale_id: p.deciplus_sale_id || null,
      bot_status: p.bot_status || null,
      badge_action: p.badge_action || p.bot_badge_action || null,
      pay_amount: p.payment?.amount ?? p.payment?.amount_cents / 100,
      invoice_type_before: offerDocumentCopy(p.product_snapshot || {}, p).typeLabel,
      payload: p,
    });
  }
  return { since, targets: found };
}

function patchOrderForInvoice(order) {
  const next = { ...order };
  next.paiement_comptant = false;
  next.payment_plan = '4x';
  next.billing_plan = 'rib';
  next.payment = {
    ...(next.payment || {}),
    method: next.payment?.method || 'payplug',
    status: next.payment?.status || 'paid',
    payment_plan: '4x',
    billing_plan: 'rib',
  };
  next.badge_timing = null;
  next.badge_method = null;
  if (next.payment) {
    next.payment.badge_timing = null;
    next.payment.badge_method = null;
  }
  next.badge_fix = {
    ...(next.badge_fix || {}),
    at: new Date().toISOString(),
    reason: 'payplug_4x_prelevement_no_badge',
  };
  return next;
}

async function cancelMemberBadges(page, memberId, gym) {
  const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts, cancelOneContract } = require('../bot/cancel-sale');
  const gymConfig = getGymConfig(gym || 'minimes');

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const badges = contracts.filter((c) => c.isBadge);
  const results = [];

  for (const badge of badges) {
    if (CHECK || !APPLY) {
      results.push({ idc: badge.idc, label: badge.label, skipped: 'check_only' });
      continue;
    }
    const out = await cancelOneContract(page, badge);
    results.push({
      idc: badge.idc,
      label: badge.label,
      cancelled: out.cancelled,
      reason: out.reason,
    });
    await closeGreyboxIfOpen(page).catch(() => {});
    await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  }

  const after = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  return {
    before: slimContracts(contracts),
    badges_found: badges.length,
    badge_results: results,
    after: slimContracts(after),
    badges_remaining: after.filter((c) => c.isBadge).length,
  };
}

async function regenerateInvoice(orderId) {
  const order = await loadOrderAsync(orderId);
  if (!order) throw new Error(`commande introuvable ${orderId}`);
  const patched = patchOrderForInvoice(order);
  const copy = offerDocumentCopy(patched.product_snapshot || {}, patched);
  const invoice = await generateInscriptionInvoicePdf(patched);
  patched.documents = {
    ...(patched.documents || {}),
    invoice_pdf: invoice.filepath,
    invoice_filename: invoice.filename,
    invoice_regenerated_at: new Date().toISOString(),
  };
  patched.invoice_type_label = copy.typeLabel;
  await saveOrderAsync(patched);
  return {
    invoice_type_after: copy.typeLabel,
    invoice_path: invoice.filepath,
    invoice_filename: invoice.filename,
    email: patched.customer_short?.email || patched.customer_full?.email || null,
    order: patched,
  };
}

async function repairOne(page, target) {
  const summary = {
    order_id: target.order_id,
    name: target.name,
    created_at: target.created_at,
    member_id: target.member_id,
    sale_id: target.sale_id,
    pay_amount: target.pay_amount,
    invoice_type_before: target.invoice_type_before,
    badge_action: target.badge_action,
  };

  if (!target.member_id) {
    return repairInvoiceOnly(target);
  }

  summary.deciplus = await cancelMemberBadges(page, target.member_id, target.gym);

  if (CHECK || !APPLY) {
    summary.skipped = 'check_only';
    const preview = patchOrderForInvoice({ ...target.payload, order_id: target.order_id });
    summary.invoice_type_after = offerDocumentCopy(preview.product_snapshot || {}, preview).typeLabel;
    return summary;
  }

  try {
    const invoice = await regenerateInvoice(target.order_id);
    summary.invoice = {
      type_after: invoice.invoice_type_after,
      path: invoice.invoice_path,
      filename: invoice.invoice_filename,
    };

    if (SEND_EMAIL && invoice.email) {
      summary.email = await sendConfirmationEmail(invoice.order);
    }
  } catch (err) {
    summary.invoice_error = err.message;
  }

  return summary;
}

async function repairInvoiceOnly(target) {
  const summary = {
    order_id: target.order_id,
    name: target.name,
    skipped_deciplus: 'no_member_id',
  };
  if (CHECK || !APPLY) {
    const preview = patchOrderForInvoice({ ...target.payload, order_id: target.order_id });
    summary.invoice_type_after = offerDocumentCopy(preview.product_snapshot || {}, preview).typeLabel;
    return summary;
  }
  try {
    const invoice = await regenerateInvoice(target.order_id);
    summary.invoice = {
      type_after: invoice.invoice_type_after,
      path: invoice.invoice_path,
      filename: invoice.invoice_filename,
    };
    if (SEND_EMAIL && invoice.email) {
      summary.email = await sendConfirmationEmail(invoice.order);
    }
  } catch (err) {
    summary.invoice_error = err.message;
  }

  return summary;
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const { since, targets } = await loadTargets();
  console.log(`Depuis ${since} — ${targets.length} commande(s) 259 € 4× PayPlug prélèvement`);
  console.log(
    targets
      .map(
        (t) =>
          `  ${t.name} | ${t.order_id} | ${t.pay_amount} € | member ${t.member_id || '—'} | facture: ${t.invoice_type_before}`
      )
      .join('\n') || '  (aucune)'
  );

  const report = {
    at: new Date().toISOString(),
    since,
    check: CHECK,
    apply: APPLY,
    email: SEND_EMAIL,
    results: [],
  };

  if (!targets.length) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nRapport', OUT);
    return;
  }

  if (!APPLY && !CHECK) {
    console.log('\nMode analyse implicite — ajoutez --apply pour exécuter (ou --check explicite).');
  }

  const needsDeciplus = targets.some((t) => t.member_id);
  if (needsDeciplus && (APPLY || CHECK)) {
    const { login } = require('../bot/auth');
    const { runWithSession, closeBrowser } = require('../bot/browser-pool');

    await runWithSession('fix-payplug-4x-badge-invoices', async (page) => {
      try {
        await login(page, { siteLabel: 'Minimes' });
      } catch (err) {
        console.warn('Login retry', err.message);
        await login(page, { siteLabel: 'Minimes' });
      }
      for (const target of targets) {
        try {
          const out = await repairOne(page, target);
          report.results.push(out);
          console.log('\n===', target.name, '===');
          console.log(JSON.stringify(out, null, 2));
        } catch (err) {
          console.error('FAIL', target.name, err.message);
          report.results.push({ order_id: target.order_id, name: target.name, error: err.message });
        }
      }
    });
    await require('../bot/browser-pool').closeBrowser().catch(() => {});
  } else {
    for (const target of targets) {
      report.results.push({ ...target, skipped: 'no_member_id' });
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nRapport', OUT);

  const failed = report.results.filter((r) => r.error || r.invoice_error);
  const badgesLeft = report.results.filter((r) => (r.deciplus?.badges_remaining || 0) > 0);
  if (failed.length || (APPLY && badgesLeft.length)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
