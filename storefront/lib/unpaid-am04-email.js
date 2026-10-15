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

function buildAm04GraceEmail({ firstName, product, failedDue, newDue }) {
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

module.exports = {
  buildAm04GraceEmail,
  sendAm04GraceEmail,
};
