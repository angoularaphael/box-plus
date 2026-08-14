'use strict';

const { STEPS, listAllOrdersAsync, loadOrderAsync, saveOrderAsync } = require('./order-lifecycle');
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

const QUEUE_RETRY_MS = 3 * 60 * 1000;

function isNudgeDue(order, now = Date.now(), { force = false } = {}) {
  if (!isPaidIncomplete(order)) return false;
  if (order.funnel?.nudge_sent_at) return false;
  const queuedAt = Date.parse(order.funnel?.nudge_queued_at || '');
  if (Number.isFinite(queuedAt) && now - queuedAt < QUEUE_RETRY_MS) return false;
  const paidAt = Date.parse(order.payment?.paid_at || '');
  if (!Number.isFinite(paidAt)) return false;
  const hasDeadline = Boolean(order.funnel?.complete_deadline_at);
  if (!hasDeadline && now - paidAt > LEGACY_MAX_AGE_MS) return false;
  if (force) return true;
  const deadline = Date.parse(completeDeadlineAt(order) || '');
  return Number.isFinite(deadline) && now >= deadline;
}

const STEP_LABELS = {
  1: 'Offre',
  2: 'Salle',
  3: 'Identité',
  4: 'Paiement',
  5: 'IBAN',
  6: 'Dossier',
  7: 'Signature',
  8: 'Confirmé',
};

function isInscriptionTunnel(order) {
  if (!order || order.action) return false;
  const id = String(order.order_id || '');
  if (/^(COACH|CHANGE|VERIFY)-/i.test(id)) return false;
  return Boolean(order.access_token);
}

function resumeStep(order, { minStep, fallbackStep } = {}) {
  const raw = Number(order?.step);
  let step = Number.isFinite(raw) && raw > 0 ? raw : fallbackStep || STEPS.GYM;
  if (order?.signature?.signed_at || step >= STEPS.CONFIRMED) step = STEPS.CONFIRMED;
  if (minStep) step = Math.max(step, minStep);
  return Math.min(Math.max(step, STEPS.OFFER), STEPS.CONFIRMED);
}

function resumeUrl(order, opts) {
  const step = resumeStep(order, opts);
  const qs = new URLSearchParams();
  if (order?.product_id) qs.set('product', String(order.product_id));
  qs.set('order', String(order?.order_id || ''));
  const token = String(order?.access_token || '');
  if (token) {
    qs.set('token', token);
    qs.set('bc_token', token);
  }
  qs.set('step', String(step));
  return `${getStoreUrl()}/inscription?${qs}`;
}

function describeResume(order) {
  const step = resumeStep(order);
  const completed = step >= STEPS.CONFIRMED || Boolean(order?.signature?.signed_at);
  const short = order?.customer_short || {};
  return {
    order_id: order.order_id,
    url: resumeUrl(order),
    step,
    step_label: STEP_LABELS[step] || String(step),
    completed,
    can_resume: isInscriptionTunnel(order) && !completed,
    email: customerEmail(order),
    name: [short.first_name, short.last_name].filter(Boolean).join(' ').trim(),
    product: order.product_snapshot?.display_name || order.product_snapshot?.name || '',
  };
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
  const url = resumeUrl(order, { minStep: STEPS.IBAN, fallbackStep: STEPS.DOSSIER });
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
    resume_url: resumeUrl(order, { minStep: STEPS.IBAN, fallbackStep: STEPS.DOSSIER }),
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

async function sendNudgeEmail(order) {
  const item = summarizeNudge(order);
  if (!item.email || /@boxplus-test\.local$/i.test(item.email)) {
    return { sent: false, skipped: true, reason: 'no_email_or_test' };
  }
  const { sendEmailViaBrevo } = require('./brevo-send');
  const result = await sendEmailViaBrevo({
    to: item.email,
    subject: item.email_subject,
    html: item.email_html,
  });
  if (!result) return { sent: false, reason: 'brevo_not_configured' };
  return { sent: true, via: result.via || 'brevo' };
}

async function dispatchOneNudge(orderId, { force = false } = {}) {
  const order = await loadOrderAsync(orderId);
  if (!order) return { ok: false, error: 'not_found' };
  if (!isNudgeDue(order, Date.now(), { force })) {
    return { ok: true, skipped: true, reason: order.funnel?.nudge_sent_at ? 'already_sent' : 'not_due' };
  }
  return sendAndMarkNudge(order);
}

async function sendAndMarkNudge(order) {
  const email = customerEmail(order);
  if (!email || /@boxplus-test\.local$/i.test(email)) {
    await markNudgeSent(order.order_id);
    return { ok: true, skipped: true, reason: 'no_email_or_test' };
  }
  await markNudgeQueued(order.order_id);
  try {
    const mailed = await sendNudgeEmail(order);
    if (mailed.sent) {
      await markNudgeSent(order.order_id);
      logInfo('Relance inscription envoyée', { order_id: order.order_id, via: mailed.via });
      return { ok: true, sent: true };
    }
    logWarn('Relance inscription — email non envoyé', {
      order_id: order.order_id,
      reason: mailed.reason || mailed.skipped,
    });
    return { ok: false, error: mailed.reason || 'email_not_sent' };
  } catch (err) {
    logWarn('Relance inscription — envoi échoué', {
      order_id: order.order_id,
      error: err.message,
    });
    return { ok: false, error: err.message };
  }
}

async function dispatchDueNudges() {
  const due = await listDueNudges();
  const results = [];
  for (const item of due) {
    const order = await loadOrderAsync(item.order_id);
    if (!order) {
      results.push({ order_id: item.order_id, ok: false, error: 'not_found' });
      continue;
    }
    const out = await sendAndMarkNudge(order);
    results.push({ order_id: item.order_id, ...out });
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
  resumeStep,
  describeResume,
  isInscriptionTunnel,
  STEP_LABELS,
  nudgeEmailSubject,
  nudgeEmailHtml,
  listDueNudges,
  markNudgeQueued,
  markNudgeSent,
  dispatchOneNudge,
  dispatchDueNudges,
};
