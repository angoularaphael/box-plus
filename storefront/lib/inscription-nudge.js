'use strict';

const { STEPS, listAllOrdersAsync, loadOrderAsync, saveOrderAsync } = require('./order-lifecycle');
const { forwardJobToBot } = require('../../lib/bot-forward');
const { getStoreUrl } = require('../../lib/app-urls');
const { logInfo, logWarn } = require('../../lib/logger');

const NUDGE_AFTER_MS = Number(process.env.BOXPLUS_INSCRIPTION_NUDGE_MS || 30 * 60 * 1000);
const LEGACY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function nudgeDelayMs() {
  return NUDGE_AFTER_MS;
}

function completeDeadlineAt(order) {
  if (order?.funnel?.complete_deadline_at) return order.funnel.complete_deadline_at;
  const paid = Date.parse(order?.payment?.paid_at || '');
  if (!Number.isFinite(paid)) return null;
  return new Date(paid + NUDGE_AFTER_MS).toISOString();
}

function isPaidIncomplete(order) {
  if (!order) return false;
  if (Number(order.step || 0) >= STEPS.CONFIRMED || order.signature?.signed_at) return false;
  if (String(order.payment?.status || '') !== 'paid') return false;
  return true;
}

function isNudgeDue(order, now = Date.now()) {
  if (!isPaidIncomplete(order)) return false;
  if (order.funnel?.nudge_sent_at || order.funnel?.nudge_queued_at) return false;
  const paidAt = Date.parse(order.payment?.paid_at || '');
  if (!Number.isFinite(paidAt)) return false;
  const hasDeadline = Boolean(order.funnel?.complete_deadline_at);
  if (!hasDeadline && now - paidAt > LEGACY_MAX_AGE_MS) return false;
  const deadline = Date.parse(completeDeadlineAt(order) || '');
  return Number.isFinite(deadline) && now >= deadline;
}

function resumeUrl(order) {
  const step = Math.max(Number(order.step || STEPS.DOSSIER), STEPS.IBAN);
  const token = order.access_token || '';
  return `${getStoreUrl()}/inscription?order=${encodeURIComponent(order.order_id)}&token=${encodeURIComponent(token)}&step=${step}`;
}

function customerEmail(order) {
  return String(order.customer_short?.email || order.customer_full?.email || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nudgeEmailSubject() {
  return 'Gong ! Ton inscription Boxing Center n’est pas encore sur le ring';
}

function nudgeEmailHtml(order) {
  const first = escapeHtml(order.customer_short?.first_name || '');
  const url = resumeUrl(order);
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Round non terminé</title></head>
<body style="font-family:Arial,sans-serif;color:#0C1829;max-width:600px;margin:0 auto;padding:24px;background:#f4f5f7">
  <div style="background:#0C1829;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
    <p style="margin:0;letter-spacing:0.12em;font-size:12px;color:#C8902F;text-transform:uppercase">Boxing Center — Round de 30 min</p>
    <h1 style="margin:8px 0 0;font-size:26px">Le gong a sonné.</h1>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
    <p>Salut ${first || 'champion'},</p>
    <p>Tu as <strong>payé</strong>, mais le combat n’est pas fini : dossier + signature sont encore ouverts. Tant que ce round n’est pas bouclé, <strong>tu n’es pas inscrit en salle</strong> — les coachs ne te verront pas sur la feuille.</p>
    <p>Remets les gants et termine maintenant (moins de 2 minutes) :</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#E8001C;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:8px">Finir le round</a>
    </p>
    <p style="font-size:13px;color:#5C6370">Sans ça, tu risques d’arriver au club et d’entendre : « tu n’es pas dans le système ». On ne veut pas de ça.</p>
    <p>À tout de suite sur le ring,<br/>Boxing Center</p>
  </div>
</body>
</html>`;
}

function summarizeNudge(order) {
  return {
    order_id: order.order_id,
    gym: order.customer_full?.gym || 'minimes',
    email: customerEmail(order),
    first_name: order.customer_short?.first_name || '',
    last_name: order.customer_short?.last_name || '',
    resume_url: resumeUrl(order),
    paid_at: order.payment?.paid_at || null,
    deadline_at: completeDeadlineAt(order),
    step: order.step,
    product_name: order.product_snapshot?.display_name || order.product_snapshot?.name || '',
    email_subject: nudgeEmailSubject(),
    email_html: nudgeEmailHtml(order),
  };
}

async function listDueNudges(now = Date.now()) {
  const all = await listAllOrdersAsync();
  return all.filter((o) => isNudgeDue(o, now)).map(summarizeNudge);
}

async function markNudgeQueued(orderId) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.funnel = {
    ...(order.funnel || {}),
    nudge_queued_at: new Date().toISOString(),
  };
  return saveOrderAsync(order);
}

async function markNudgeSent(orderId) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  order.funnel = {
    ...(order.funnel || {}),
    nudge_sent_at: new Date().toISOString(),
    nudge_queued_at: order.funnel?.nudge_queued_at || new Date().toISOString(),
  };
  return saveOrderAsync(order);
}

async function dispatchOneNudge(orderId) {
  const order = await loadOrderAsync(orderId);
  if (!order) return { ok: false, error: 'not_found' };
  if (!isNudgeDue(order)) return { ok: true, skipped: true };
  const [result] = (await dispatchDueNudges()).results.filter((r) => r.order_id === orderId);
  return { ok: true, ...(result || { dispatched: true }) };
}

async function dispatchDueNudges() {
  const due = await listDueNudges();
  const results = [];
  for (const item of due) {
    if (!item.email || /@boxplus-test\.local$/i.test(item.email)) {
      await markNudgeSent(item.order_id);
      results.push({ order_id: item.order_id, skipped: true, reason: 'no_email_or_test' });
      continue;
    }
    try {
      await markNudgeQueued(item.order_id);
      const forwarded = await forwardJobToBot({
        action: 'inscription_nudge',
        order_id: item.order_id,
        gym: item.gym,
        customer: {
          first_name: item.first_name,
          last_name: item.last_name,
          email: item.email,
        },
        email: item.email,
        resume_url: item.resume_url,
        email_subject: item.email_subject,
        email_html: item.email_html,
        product_name: item.product_name,
      });
      results.push({ order_id: item.order_id, forwarded: forwarded.forwarded !== false });
    } catch (err) {
      logWarn('Relance inscription — envoi bot échoué', {
        order_id: item.order_id,
        error: err.message,
      });
      results.push({ order_id: item.order_id, ok: false, error: err.message });
    }
  }
  if (results.length) {
    logInfo('Relances inscription dispatchées', { count: results.length });
  }
  return { ok: true, count: results.length, results };
}

module.exports = {
  NUDGE_AFTER_MS,
  nudgeDelayMs,
  completeDeadlineAt,
  isPaidIncomplete,
  isNudgeDue,
  resumeUrl,
  nudgeEmailSubject,
  nudgeEmailHtml,
  listDueNudges,
  markNudgeQueued,
  markNudgeSent,
  dispatchOneNudge,
  dispatchDueNudges,
};
