'use strict';

const {
  sendEmailViaBrevo,
  isConfigured: brevoConfigured,
  senderEmail,
  defaultReplyTo,
} = require('./brevo-send');

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function payButton(url, label) {
  return `<p style="margin:20px 0"><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">${label}</a></p>`;
}

function euros(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function buildAm04GraceEmail({ firstName, product, failedDue, newDue, payUrl }) {
  const who = firstName ? `${firstName},` : 'Bonjour,';
  const subject = 'Paiement non passé — fonds insuffisants';
  const text = [
    who,
    '',
    'Votre prélèvement SEPA au Boxing Center n’a pas abouti : motif « fonds insuffisants » sur votre compte bancaire.',
    '',
    product ? `Abonnement concerné : ${product}.` : '',
    failedDue ? `Échéance initiale : ${failedDue}.` : '',
    '',
    `Une nouvelle tentative est programmée le ${newDue}. Merci de vous assurer que votre compte dispose des fonds nécessaires à cette date.`,
    '',
    'Sans paiement à cette nouvelle date, votre abonnement sera résilié automatiquement.',
    '',
    payUrl ? `Vous pouvez aussi régler tout de suite par carte : ${payUrl}` : '',
    payUrl ? 'Une fois réglé, la banque ne repassera pas le prélèvement.' : '',
    '',
    'Pour toute question : boxingcentertls@gmail.com ou l’accueil de votre salle.',
    '',
    'L’équipe Boxing Center',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border-radius:8px;line-height:1.55;font-size:15px">
    <p style="margin:0 0 16px">${who}</p>
    <p style="margin:0 0 14px">Votre prélèvement SEPA au <strong>Boxing Center</strong> n’a pas abouti : motif <strong>fonds insuffisants</strong> sur votre compte bancaire.</p>
    ${product ? `<p style="margin:0 0 14px">Abonnement concerné : <em>${product}</em>.</p>` : ''}
    ${failedDue ? `<p style="margin:0 0 14px">Échéance initiale : ${failedDue}.</p>` : ''}
    <p style="margin:0 0 14px">Une <strong>nouvelle tentative</strong> est programmée le <strong>${newDue}</strong>. Merci de vous assurer que votre compte dispose des fonds nécessaires à cette date.</p>
    <p style="margin:0 0 14px">Sans paiement à cette nouvelle date, votre abonnement sera <strong>résilié automatiquement</strong>.</p>
    ${payUrl ? `<p style="margin:0 0 6px">Vous préférez régler tout de suite par carte ? Une fois réglé, la banque ne repassera pas le prélèvement.</p>${payButton(payUrl, 'Régulariser mon paiement')}` : ''}
    <p style="margin:24px 0 0">L’équipe Boxing Center<br/><a href="mailto:boxingcentertls@gmail.com" style="color:#111">boxingcentertls@gmail.com</a></p>
  </div>
</body></html>`;

  return { subject, text, html };
}

async function sendAm04GraceEmail(member = {}, grace = {}) {
  if (!brevoConfigured()) return { sent: false, reason: 'brevo_not_configured' };
  const email = String(member.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, reason: 'no_email' };
  }
  const mail = buildAm04GraceEmail({
    firstName: firstNameOf(member.first_name || member.name),
    product: member.product,
    failedDue: grace.failed_due,
    newDue: grace.new_due,
    payUrl: grace.pay_url || null,
  });
  const out = await sendEmailViaBrevo({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    fromName: 'Boxing Center',
    fromEmail: senderEmail(),
    replyTo: defaultReplyTo(),
    headers: { 'X-Transactional': 'true' },
    tags: [{ name: 'category', value: 'unpaid-am04-grace' }],
  });
  return { sent: true, messageId: out.messageId, to: email };
}

function buildResiliationEmail({ firstName, payUrl, amountCents }) {
  const who = firstName ? `${firstName},` : 'Bonjour,';
  const subject = 'Contrat résilié — prélèvement non passé';
  const text = [
    who,
    '',
    'Votre prélèvement n’a pas abouti.',
    'Votre contrat Boxing Center est résilié.',
    '',
    payUrl ? `Il reste ${euros(amountCents)} à régler pour l’échéance non payée : ${payUrl}` : '',
    '',
    'Pour reprendre un abonnement, passez par la boutique ou l’accueil de votre salle.',
    '',
    'L’équipe Boxing Center',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border-radius:8px;line-height:1.55;font-size:15px">
    <p style="margin:0 0 16px">${who}</p>
    <p style="margin:0 0 14px">Votre prélèvement n’a pas abouti.</p>
    <p style="margin:0 0 14px">Votre contrat <strong>Boxing Center</strong> est <strong>résilié</strong>.</p>
    ${payUrl ? `<p style="margin:0 0 6px">Il reste <strong>${euros(amountCents)}</strong> à régler pour l’échéance non payée.</p>${payButton(payUrl, 'Régler l’échéance')}` : ''}
    <p style="margin:24px 0 0">L’équipe Boxing Center<br/><a href="mailto:boxingcentertls@gmail.com" style="color:#111">boxingcentertls@gmail.com</a></p>
  </div>
</body></html>`;
  return { subject, text, html };
}

async function sendContractCancelledEmail(member = {}, opts = {}) {
  if (!brevoConfigured()) return { sent: false, reason: 'brevo_not_configured' };
  const email = String(member.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { sent: false, reason: 'no_email' };
  const mail = buildResiliationEmail({
    firstName: firstNameOf(member.first_name || member.name),
    payUrl: opts.pay_url || null,
    amountCents: opts.amount_cents || 0,
  });
  const out = await sendEmailViaBrevo({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    fromName: 'Boxing Center',
    fromEmail: senderEmail(),
    replyTo: defaultReplyTo(),
    headers: { 'X-Transactional': 'true' },
    tags: [{ name: 'category', value: 'unpaid-resiliation' }],
  });
  return { sent: true, messageId: out.messageId, to: email };
}

/** Lien /regulariser redemande par le membre sur la boutique. */
function buildRegulLinkEmail({ firstName, payUrl, amountCents, failedDue }) {
  const who = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const subject = 'Votre lien pour régler votre échéance — Boxing Center';
  const du = failedDue ? ` du ${failedDue}` : '';
  const text = [
    who,
    '',
    `Vous nous avez demandé comment régler votre échéance${du}, restée impayée.`,
    `Montant : ${euros(amountCents)}. Vous pouvez la régler par carte avec ce lien : ${payUrl}`,
    '',
    'Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.',
    '',
    'L’équipe Boxing Center',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border-radius:8px;line-height:1.55;font-size:15px">
    <p style="margin:0 0 16px">${who}</p>
    <p style="margin:0 0 14px">Vous nous avez demandé comment régler votre échéance${du}, restée impayée.</p>
    <p style="margin:0 0 6px">Montant : <strong>${euros(amountCents)}</strong></p>
    ${payButton(payUrl, 'Régler mon échéance')}
    <p style="margin:18px 0 0;color:#555;font-size:13px">Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.</p>
    <p style="margin:24px 0 0">L’équipe Boxing Center<br/><a href="mailto:boxingcentertls@gmail.com" style="color:#111">boxingcentertls@gmail.com</a></p>
  </div>
</body></html>`;
  return { subject, text, html };
}

async function sendRegulLinkEmail(member = {}, opts = {}) {
  if (!brevoConfigured()) return { sent: false, reason: 'brevo_not_configured' };
  const email = String(member.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { sent: false, reason: 'no_email' };
  if (!opts.pay_url) return { sent: false, reason: 'no_pay_url' };
  const mail = buildRegulLinkEmail({
    firstName: firstNameOf(member.first_name || member.name),
    payUrl: opts.pay_url,
    amountCents: opts.amount_cents || 0,
    failedDue: opts.failed_due || '',
  });
  const out = await sendEmailViaBrevo({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    fromName: 'Boxing Center',
    fromEmail: senderEmail(),
    replyTo: defaultReplyTo(),
    headers: { 'X-Transactional': 'true' },
    tags: [{ name: 'category', value: 'unpaid-regul-link' }],
  });
  return { sent: true, messageId: out.messageId, to: email };
}

module.exports = {
  buildRegulLinkEmail,
  sendRegulLinkEmail,
  buildAm04GraceEmail,
  sendAm04GraceEmail,
  buildResiliationEmail,
  sendContractCancelledEmail,
};
