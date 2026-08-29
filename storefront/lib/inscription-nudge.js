'use strict';

const { STEPS, gymLabel, listAllOrdersAsync, loadOrderAsync, saveOrderAsync } = require('./order-lifecycle');
const { getStoreUrl } = require('../../lib/app-urls');
const { logInfo, logWarn } = require('../../lib/logger');

const NUDGE_AFTER_MS = Number(process.env.BOXPLUS_INSCRIPTION_NUDGE_MS || 30 * 60 * 1000);
const MAX_NUDGE_ATTEMPTS = 3;
const LEGACY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const QUEUE_RETRY_MS = 3 * 60 * 1000;

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

function nudgeEmailDone(order) {
  return Boolean(order?.funnel?.nudge_email_sent_at || order?.funnel?.nudge_sent_at);
}

function nudgeWhatsappDone(order) {
  return Boolean(order?.funnel?.nudge_whatsapp_sent_at || order?.funnel?.nudge_whatsapp_skipped_at);
}

function nudgeAttemptCount(order) {
  const n = Number(order?.funnel?.nudge_attempts || 0);
  if (n > 0) return n;
  if (nudgeEmailDone(order) && nudgeWhatsappDone(order)) return 1;
  return 0;
}

function lastNudgeAtMs(order) {
  const explicit = Date.parse(order?.funnel?.last_nudge_at || '');
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const stamps = [
    order?.funnel?.nudge_whatsapp_sent_at,
    order?.funnel?.nudge_email_sent_at,
    order?.funnel?.nudge_sent_at,
    order?.funnel?.nudge_whatsapp_skipped_at,
  ];
  let latest = 0;
  for (const stamp of stamps) {
    const t = Date.parse(stamp || '');
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest;
}

function nudgeFullySent(order) {
  return nudgeAttemptCount(order) >= MAX_NUDGE_ATTEMPTS;
}

function isStuckIncomplete(order) {
  if (!isInscriptionTunnel(order)) return false;
  if (Number(order.step || 0) >= STEPS.CONFIRMED || order.signature?.signed_at) return false;
  if (!customerEmail(order) && !customerPhone(order)) return false;
  return true;
}

function stepEnteredMs(order) {
  const entered = Date.parse(order?.funnel?.step_entered_at || '');
  if (Number.isFinite(entered)) return entered;
  const deadline = Date.parse(order?.funnel?.complete_deadline_at || '');
  if (Number.isFinite(deadline)) return deadline - NUDGE_AFTER_MS;
  const paid = Date.parse(order?.payment?.paid_at || '');
  if (Number.isFinite(paid)) return paid;
  const fallback = Date.parse(order?.updated_at || order?.created_at || '');
  return Number.isFinite(fallback) ? fallback : 0;
}

function firstAttemptIncomplete(order) {
  if (nudgeAttemptCount(order) > 0) return false;
  const email = nudgeEmailDone(order);
  const wa = nudgeWhatsappDone(order);
  return (email && !wa) || (!email && wa);
}

function isNudgeDue(order, now = Date.now(), { force = false } = {}) {
  if (!isStuckIncomplete(order)) return false;
  if (nudgeFullySent(order)) return false;
  const queuedAt = Date.parse(order.funnel?.nudge_queued_at || '');
  if (!force && Number.isFinite(queuedAt) && now - queuedAt < QUEUE_RETRY_MS) return false;
  const last = lastNudgeAtMs(order);
  if (last && now - last < NUDGE_AFTER_MS) return false;
  if (firstAttemptIncomplete(order)) {
    const entered = stepEnteredMs(order);
    if (force || (entered && now - entered >= NUDGE_AFTER_MS) || last) return true;
  }
  const entered = stepEnteredMs(order);
  if (!entered) return false;
  if (!order.funnel?.step_entered_at && !order.funnel?.complete_deadline_at) {
    if (now - entered > LEGACY_MAX_AGE_MS) return false;
  }
  if (force) return true;
  return now - entered >= NUDGE_AFTER_MS;
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

function productNeedsPayment(order) {
  const p = order?.product_snapshot || {};
  if (p.requires_payment === false) return false;
  if (Number(p.price_cents || 0) <= 0) return false;
  if (/gratuit/i.test(String(p.price_label || p.stripe_price_label || ''))) return false;
  return true;
}

function canPayOrder(order) {
  if (!isInscriptionTunnel(order) || order.access_blocked) return false;
  const st = String(order?.payment?.status || 'pending');
  if (st === 'paid' || st === 'free' || st === 'past_due') return false;
  return productNeedsPayment(order);
}

function resumeStep(order, { minStep, fallbackStep, forceStep } = {}) {
  if (forceStep) {
    return Math.min(Math.max(Number(forceStep) || STEPS.PAYMENT, STEPS.OFFER), STEPS.CONFIRMED);
  }
  const raw = Number(order?.step);
  let step = Number.isFinite(raw) && raw > 0 ? raw : fallbackStep || STEPS.GYM;
  if (order?.signature?.signed_at || step >= STEPS.CONFIRMED) step = STEPS.CONFIRMED;
  if (minStep) step = Math.max(step, minStep);
  return Math.min(Math.max(step, STEPS.OFFER), STEPS.CONFIRMED);
}

function resumeUrl(order, opts = {}) {
  const step = resumeStep(order, opts);
  const qs = new URLSearchParams();
  if (order?.product_id) qs.set('product', String(order.product_id));
  qs.set('order', String(order?.order_id || ''));
  const token = String(order?.access_token || '');
  if (token) {
    qs.set('token', token);
    qs.set('bc_token', token);
  }
  if (opts.pay) qs.set('pay', '1');
  qs.set('step', String(step));
  return `${getStoreUrl()}/inscription?${qs}`;
}

function describeResume(order, { kind } = {}) {
  const pay = kind === 'pay';
  const step = pay ? STEPS.PAYMENT : resumeStep(order);
  const completed = resumeStep(order) >= STEPS.CONFIRMED || Boolean(order?.signature?.signed_at);
  const short = order?.customer_short || {};
  return {
    order_id: order.order_id,
    kind: pay ? 'pay' : 'resume',
    url: resumeUrl(order, pay ? { forceStep: STEPS.PAYMENT, pay: true } : {}),
    step,
    step_label: STEP_LABELS[step] || String(step),
    completed,
    can_resume: isInscriptionTunnel(order) && !completed,
    can_pay: canPayOrder(order),
    email: customerEmail(order),
    phone: customerPhone(order) || null,
    name: [short.first_name, short.last_name].filter(Boolean).join(' ').trim(),
    product: order.product_snapshot?.display_name || order.product_snapshot?.name || '',
  };
}

function customerEmail(order) {
  return String(order.customer_short?.email || order.customer_full?.email || order.customer?.email || '').trim();
}

function customerPhone(order) {
  return String(
    order?.customer_short?.phone ||
      order?.customer_full?.phone ||
      order?.customer_full?.mobile ||
      order?.customer?.phone ||
      ''
  ).trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function firstName(order) {
  return String(order?.customer_short?.first_name || order?.customer_full?.first_name || '').trim();
}

function productLabel(order) {
  return String(
    order?.product_snapshot?.display_name || order?.product_snapshot?.name || 'votre offre Boxing Center'
  ).trim();
}

function wantsPayCta(order, { kind } = {}) {
  if (kind === 'pay') return true;
  return canPayOrder(order) && resumeStep(order) === STEPS.PAYMENT;
}

function ctaButton(url, label) {
  return `<p style="text-align:center;margin:28px 0 12px">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#E8001C;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 28px;border-radius:8px">${escapeHtml(label)}</a>
    </p>
    <p style="font-size:13px;color:#5C6370;word-break:break-all;line-height:1.5">Si le bouton ne s’affiche pas, copiez ce lien dans votre navigateur :<br/><a href="${escapeHtml(url)}" style="color:#E8001C">${escapeHtml(url)}</a></p>`;
}

function wrapCommercialEmail({ kicker, title, inner }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#0C1829;max-width:600px;margin:0 auto;padding:24px;background:#f4f5f7">
  <div style="background:#0C1829;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
    <p style="margin:0;letter-spacing:0.12em;font-size:12px;color:#C8902F;text-transform:uppercase">${escapeHtml(kicker)}</p>
    <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25">${escapeHtml(title)}</h1>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
    ${inner}
    <p style="margin:28px 0 0">Sportivement,<br/><strong>L’équipe Boxing Center</strong></p>
  </div>
</body>
</html>`;
}

function resumeEmailSubject(order, { kind } = {}) {
  if (wantsPayCta(order, { kind })) {
    return 'Votre inscription Boxing Center — il ne reste plus qu’à payer';
  }
  const step = STEP_LABELS[resumeStep(order)] || 'inscription';
  return `Reprenez votre inscription Boxing Center (étape ${step})`;
}

function resumeEmailHtml(order, { kind } = {}) {
  const info = describeResume(order, { kind });
  const pay = wantsPayCta(order, { kind });
  const url = info.url;
  const hello = firstName(order) ? `Bonjour ${escapeHtml(firstName(order))},` : 'Bonjour,';
  const offer = escapeHtml(productLabel(order));
  const gym = escapeHtml(gymLabel(order.customer_full?.gym) || '');
  const step = escapeHtml(info.step_label || 'inscription');
  const inner = pay
    ? `<p>${hello}</p>
    <p>Votre inscription <strong>${offer}</strong>${gym ? ` à <strong>${gym}</strong>` : ''} est presque terminée. Il ne reste plus qu’à <strong>régler en ligne</strong> pour débloquer l’accès aux 5 salles.</p>
    <p>Cliquez sur le bouton ci-dessous : vous arrivez <strong>directement sur la page de paiement</strong>. Choisissez <strong>carte bancaire</strong> ou <strong>PayPal</strong> — cela prend moins d’une minute.</p>
    ${ctaButton(url, 'Payer maintenant')}
    <p style="font-size:14px;color:#334155">Votre place vous attend. Plus vous validez tôt, plus vite vous pouvez enfiler les gants.</p>`
    : `<p>${hello}</p>
    <p>Vous avez commencé votre inscription <strong>${offer}</strong>${gym ? ` à <strong>${gym}</strong>` : ''} et vous vous êtes arrêté à l’étape <strong>${step}</strong>.</p>
    <p>Un clic suffit pour reprendre <strong>exactement là où vous en étiez</strong> — sans tout recommencer.</p>
    ${ctaButton(url, 'Reprendre mon inscription')}
    <p style="font-size:14px;color:#334155">Les coachs et les 5 salles Boxing Center sont prêts. On vous attend.</p>`;
  return wrapCommercialEmail({
    kicker: 'Boxing Center — Inscription',
    title: pay ? 'Il ne reste plus qu’à payer' : 'Reprenez là où vous en étiez',
    inner,
  });
}

function nudgeEmailSubject() {
  return 'Vous n’avez pas finalisé votre inscription Boxing Center';
}

function nudgeResumeUrl(order) {
  if (isPaidIncomplete(order) && resumeStep(order) >= STEPS.IBAN) {
    return resumeUrl(order, { minStep: STEPS.IBAN, fallbackStep: STEPS.DOSSIER });
  }
  return resumeUrl(order);
}

function nudgeEmailHtml(order) {
  const hello = firstName(order) ? `Bonjour ${escapeHtml(firstName(order))},` : 'Bonjour,';
  const url = nudgeResumeUrl(order);
  const step = escapeHtml(STEP_LABELS[resumeStep(order)] || 'inscription');
  const paidDossier = isPaidIncomplete(order) && resumeStep(order) >= STEPS.IBAN;
  const inner = paidDossier
    ? `<p>${hello}</p>
    <p>Vous n’avez <strong>pas finalisé</strong> votre inscription. Votre règlement est bien reçu, mais il reste <strong>le dossier et la signature</strong> (environ 2 minutes). Tant que ce n’est pas validé, <strong>vous n’êtes pas encore inscrit en salle</strong>.</p>
    <p>Cliquez sur le bouton : vous reprenez directement à l’étape restante.</p>
    ${ctaButton(url, 'Finaliser mon inscription')}
    <p style="font-size:14px;color:#334155">Sans cette validation, les coachs ne vous verront pas sur la feuille d’émargement.</p>`
    : `<p>${hello}</p>
    <p>Vous n’avez <strong>pas finalisé</strong> votre inscription Boxing Center — vous êtes encore à l’étape <strong>${step}</strong>.</p>
    <p>Un clic suffit pour reprendre exactement là où vous en étiez, sans tout recommencer.</p>
    ${ctaButton(url, 'Finaliser mon inscription')}
    <p style="font-size:14px;color:#334155">Sans cette validation, votre inscription n’est pas enregistrée en salle.</p>`;
  return wrapCommercialEmail({
    kicker: 'Boxing Center — Inscription à finaliser',
    title: 'Vous n’avez pas finalisé votre inscription',
    inner,
  });
}

function nudgeWhatsAppText(order) {
  const hello = firstName(order) ? `Bonjour ${firstName(order)},` : 'Bonjour,';
  const url = nudgeResumeUrl(order);
  const step = STEP_LABELS[resumeStep(order)] || 'inscription';
  const paidDossier = isPaidIncomplete(order) && resumeStep(order) >= STEPS.IBAN;
  if (paidDossier) {
    return (
      `${hello}\n\n` +
      `Vous n’avez pas finalisé votre inscription Boxing Center. Votre règlement est bien reçu, mais il reste le dossier et la signature (environ 2 minutes). Tant que ce n’est pas validé, vous n’êtes pas encore inscrit en salle.\n\n` +
      `Finalisez ici :\n${url}\n\n` +
      `Sportivement,\nL’équipe Boxing Center`
    );
  }
  return (
    `${hello}\n\n` +
    `Vous n’avez pas finalisé votre inscription Boxing Center — vous êtes encore à l’étape ${step}.\n\n` +
    `Reprenez ici :\n${url}\n\n` +
    `Sportivement,\nL’équipe Boxing Center`
  );
}

async function sendResumeEmail(order, { kind = 'resume', to } = {}) {
  const dest = String(to || customerEmail(order) || '').trim();
  if (!dest) return { sent: false, error: 'no_email' };
  if (/@boxplus-test\.local$/i.test(dest)) {
    return { sent: false, skipped: true, reason: 'test_email' };
  }
  const { sendEmailViaBrevo } = require('./brevo-send');
  const result = await sendEmailViaBrevo({
    to: dest,
    subject: resumeEmailSubject(order, { kind }),
    html: resumeEmailHtml(order, { kind }),
  });
  if (!result) return { sent: false, error: 'brevo_not_configured' };
  return { sent: true, via: result.via || 'brevo', to: dest };
}

function resumeWhatsAppText(order, { kind } = {}) {
  const info = describeResume(order, { kind });
  const pay = wantsPayCta(order, { kind });
  const hello = firstName(order) ? `Bonjour ${firstName(order)},` : 'Bonjour,';
  const offer = productLabel(order);
  const gym = gymLabel(order.customer_full?.gym) || '';
  const step = info.step_label || 'inscription';
  if (pay) {
    return (
      `${hello}\n\n` +
      `Votre inscription ${offer}${gym ? ` à ${gym}` : ''} est presque terminée. Il ne reste plus qu’à régler en ligne pour débloquer l’accès aux 5 salles.\n\n` +
      `Payez ici (carte bancaire ou PayPal) :\n${info.url}\n\n` +
      `Sportivement,\nL’équipe Boxing Center`
    );
  }
  return (
    `${hello}\n\n` +
    `Vous avez commencé votre inscription ${offer}${gym ? ` à ${gym}` : ''} et vous vous êtes arrêté à l’étape ${step}.\n\n` +
    `Reprenez exactement là où vous en étiez :\n${info.url}\n\n` +
    `Sportivement,\nL’équipe Boxing Center`
  );
}

async function sendResumeWhatsApp(order, { kind = 'resume' } = {}) {
  const { isPromoWhatsAppPaused } = require('./whatsapp-outbound');
  if (isPromoWhatsAppPaused()) {
    return { sent: false, error: 'promo_paused', message: 'WhatsApp promo en pause (compte restreint)' };
  }
  const { toWhatsAppPhone, sendWhatsAppMessage } = require('./whatsapp-bot');
  const raw = customerPhone(order);
  const dest = toWhatsAppPhone(raw);
  if (!dest) return { sent: false, error: 'no_phone' };
  await sendWhatsAppMessage(raw, resumeWhatsAppText(order, { kind }), { kind: 'promo' });
  return { sent: true, to: dest };
}

function summarizeNudge(order) {
  return {
    order_id: order.order_id,
    gym: order.customer_full?.gym || 'minimes',
    email: customerEmail(order),
    phone: customerPhone(order),
    first_name: order.customer_short?.first_name || '',
    last_name: order.customer_short?.last_name || '',
    resume_url: nudgeResumeUrl(order),
    paid_at: order.payment?.paid_at || null,
    deadline_at: completeDeadlineAt(order),
    step: order.step,
    product_name: order.product_snapshot?.display_name || order.product_snapshot?.name || '',
    email_subject: nudgeEmailSubject(),
    email_html: nudgeEmailHtml(order),
    whatsapp_text: nudgeWhatsAppText(order),
  };
}

async function listDueNudges(now = Date.now()) {
  const all = await listAllOrdersAsync();
  return all.filter((o) => isNudgeDue(o, now)).map(summarizeNudge);
}

async function patchNudgeFunnel(orderId, patch) {
  const order = await loadOrderAsync(orderId);
  if (!order) return null;
  const funnel = { ...(order.funnel || {}), ...patch };
  if (nudgeEmailDone({ funnel }) && nudgeWhatsappDone({ funnel }) && !funnel.nudge_sent_at) {
    funnel.nudge_sent_at = new Date().toISOString();
  }
  order.funnel = funnel;
  return saveOrderAsync(order);
}

async function markNudgeQueued(orderId) {
  return patchNudgeFunnel(orderId, { nudge_queued_at: new Date().toISOString() });
}

async function markNudgeSent(orderId) {
  return patchNudgeFunnel(orderId, {
    nudge_email_sent_at: new Date().toISOString(),
  });
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
    text: item.whatsapp_text,
  });
  if (!result) return { sent: false, reason: 'brevo_not_configured' };
  return { sent: true, via: result.via || 'brevo' };
}

async function sendNudgeWhatsApp(order) {
  const { isPromoWhatsAppPaused } = require('./whatsapp-outbound');
  if (isPromoWhatsAppPaused()) return { sent: false, skipped: true, reason: 'promo_paused' };
  const phone = customerPhone(order);
  const { toWhatsAppPhone, sendWhatsAppMessage } = require('./whatsapp-bot');
  const to = toWhatsAppPhone(phone);
  if (!to) return { sent: false, skipped: true, reason: 'no_phone' };
  await sendWhatsAppMessage(phone, nudgeWhatsAppText(order), { kind: 'promo' });
  return { sent: true, phone: to };
}

async function dispatchOneNudge(orderId, { force = false } = {}) {
  const order = await loadOrderAsync(orderId);
  if (!order) return { ok: false, error: 'not_found' };
  if (!isNudgeDue(order, Date.now(), { force })) {
    return {
      ok: true,
      skipped: true,
      complete: nudgeFullySent(order),
      reason: nudgeFullySent(order) ? 'already_sent' : 'not_due',
    };
  }
  return sendAndMarkNudge(order);
}

async function sendAndMarkNudge(order) {
  await markNudgeQueued(order.order_id);
  const out = {
    ok: true,
    sent: false,
    complete: false,
    email: { sent: false },
    whatsapp: { sent: false },
  };

  try {
    const mailed = await sendNudgeEmail(order);
    if (mailed.sent) {
      await patchNudgeFunnel(order.order_id, { nudge_email_sent_at: new Date().toISOString() });
      out.email = { sent: true, via: mailed.via };
      out.sent = true;
    } else if (mailed.skipped) {
      await patchNudgeFunnel(order.order_id, {
        nudge_email_sent_at: new Date().toISOString(),
        nudge_email_skipped: mailed.reason,
      });
      out.email = { sent: false, skipped: true, reason: mailed.reason };
    } else {
      out.ok = false;
      out.email = { sent: false, error: mailed.reason || 'email_not_sent' };
      logWarn('Relance inscription — email non envoyé', {
        order_id: order.order_id,
        reason: mailed.reason || mailed.skipped,
      });
    }
  } catch (err) {
    out.ok = false;
    out.email = { sent: false, error: err.message };
    logWarn('Relance inscription — email échoué', {
      order_id: order.order_id,
      error: err.message,
    });
  }

  try {
    const wa = await sendNudgeWhatsApp(order);
    if (wa.sent) {
      await patchNudgeFunnel(order.order_id, { nudge_whatsapp_sent_at: new Date().toISOString() });
      out.whatsapp = { sent: true, phone: wa.phone };
      out.sent = true;
    } else if (wa.skipped) {
      await patchNudgeFunnel(order.order_id, {
        nudge_whatsapp_skipped_at: new Date().toISOString(),
        nudge_whatsapp_skipped: wa.reason,
      });
      out.whatsapp = { sent: false, skipped: true, reason: wa.reason };
      logWarn('Relance inscription — WhatsApp ignoré', {
        order_id: order.order_id,
        reason: wa.reason,
      });
    } else {
      out.ok = false;
      out.whatsapp = { sent: false, error: wa.error || 'whatsapp_not_sent' };
    }
  } catch (err) {
    out.ok = false;
    out.whatsapp = { sent: false, error: err.message };
    logWarn('Relance inscription — WhatsApp échoué', {
      order_id: order.order_id,
      error: err.message,
    });
  }

  const latest = await loadOrderAsync(order.order_id);
  const delivered = Boolean(out.email.sent || out.whatsapp.sent);
  const emailDone = Boolean(out.email.sent || out.email.skipped);
  const waDone = Boolean(out.whatsapp.sent || out.whatsapp.skipped);
  if (delivered || (emailDone && waDone)) {
    const nextAttempts = Math.min(MAX_NUDGE_ATTEMPTS, nudgeAttemptCount(latest || order) + 1);
    const patch = {
      nudge_attempts: nextAttempts,
      last_nudge_at: new Date().toISOString(),
    };
    if (nextAttempts >= MAX_NUDGE_ATTEMPTS) patch.nudge_sent_at = patch.last_nudge_at;
    await patchNudgeFunnel(order.order_id, patch);
  }
  const after = await loadOrderAsync(order.order_id);
  out.complete = nudgeFullySent(after);
  out.attempts = nudgeAttemptCount(after);
  if (out.sent || out.complete) {
    logInfo('Relance inscription envoyée', {
      order_id: order.order_id,
      email: out.email.sent,
      whatsapp: out.whatsapp.sent,
      attempts: out.attempts,
      complete: out.complete,
    });
  }
  return out;
}

async function dispatchDueNudges() {
  const due = (await listDueNudges()).slice(0, 10);
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
  MAX_NUDGE_ATTEMPTS,
  nudgeDelayMs,
  completeDeadlineAt,
  isPaidIncomplete,
  isStuckIncomplete,
  isNudgeDue,
  nudgeAttemptCount,
  resumeUrl,
  resumeStep,
  describeResume,
  isInscriptionTunnel,
  productNeedsPayment,
  canPayOrder,
  STEP_LABELS,
  resumeEmailSubject,
  resumeEmailHtml,
  resumeWhatsAppText,
  sendResumeEmail,
  sendResumeWhatsApp,
  nudgeEmailSubject,
  nudgeEmailHtml,
  nudgeWhatsAppText,
  customerPhone,
  nudgeEmailDone,
  nudgeWhatsappDone,
  nudgeFullySent,
  listDueNudges,
  markNudgeQueued,
  markNudgeSent,
  dispatchOneNudge,
  dispatchDueNudges,
};
