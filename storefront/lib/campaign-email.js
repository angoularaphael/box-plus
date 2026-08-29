'use strict';

const crypto = require('crypto');

const CONTACT = 'boxingcenter31@gmail.com';
const MANAGER_BASE = 'https://manager.boxingcenter.fr';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unsubscribeSecret() {
  return String(
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || ''
  ).trim();
}

function unsubscribeBase() {
  return String(process.env.EMAIL_UNSUBSCRIBE_BASE || MANAGER_BASE).replace(/\/$/, '');
}

function buildUnsubscribeUrl(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  const secret = unsubscribeSecret();
  if (!normalized || !secret) {
    return `mailto:${CONTACT}?subject=${encodeURIComponent('Desabonnement')}`;
  }
  const exp = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ id: null, email: normalized, exp })).toString(
    'base64url'
  );
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${unsubscribeBase()}/api/email/unsubscribe?token=${encodeURIComponent(`${payload}.${sig}`)}`;
}

function listUnsubscribeHeaders(unsubscribeUrl) {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${CONTACT}?subject=${encodeURIComponent('Desabonnement')}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function p(html) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111111;">${html}</p>`;
}

function buildOfferCampaignEmail({ name, hubUrl, email }) {
  const unsubscribeUrl = buildUnsubscribeUrl(email);
  const subject = name ? `${name}, il reste quelques places` : 'Il reste quelques places au club';
  const preheader = 'Il reste encore quelques places. 29 € les 4 semaines, ou 259 € l’année.';
  const greeting = name ? `Bonjour ${name},` : 'Bonjour,';
  const link = String(hubUrl || 'https://boutique.boxingcenter.fr/offres-speciales');
  const emailText = [
    greeting,
    '',
    'Il reste encore quelques places pour rejoindre Boxing Center.',
    '',
    'Tu as deux façons de t’y prendre.',
    '',
    '29 € les 4 semaines : sans engagement, sans préavis si tu pars, accès aux 5 salles, toutes les disciplines, tous les cours.',
    '',
    '259 € les 12 mois : au lieu de 400 €, tu peux payer en 4 fois sans frais. Mêmes salles, mêmes cours.',
    '',
    'Tout se passe ici :',
    link,
    '',
    '29 € sans engagement, 259 € pour l’année. Tant qu’il reste de la place.',
    '',
    'À tout de suite sur le plateau,',
    'L’équipe Boxing Center',
    '',
    `Se désabonner : ${unsubscribeUrl}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
  <div style="max-width:560px;padding:20px 8px;color:#111111;">
    ${p(escapeHtml(greeting))}
    ${p('Il reste encore quelques places pour rejoindre Boxing Center.')}
    ${p('Tu as deux façons de t’y prendre.')}
    ${p('29 € les 4 semaines : sans engagement, sans préavis si tu pars, accès aux 5 salles, toutes les disciplines, tous les cours.')}
    ${p('259 € les 12 mois : au lieu de 400 €, tu peux payer en 4 fois sans frais. Mêmes salles, mêmes cours.')}
    ${p(`Tout se passe ici :<br><a href="${escapeHtml(link)}" style="color:#111111;text-decoration:underline">${escapeHtml(link)}</a>`)}
    ${p('29 € sans engagement, 259 € pour l’année. Tant qu’il reste de la place.')}
    <p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#111111;">À tout de suite sur le plateau,<br>L’équipe Boxing Center</p>
    <p style="margin:28px 0 0;font-size:11px;line-height:1.5;color:#888888;">
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;">Se désabonner</a>
    </p>
  </div>
</body>
</html>`;

  return {
    subject,
    html,
    emailText,
    headers: listUnsubscribeHeaders(unsubscribeUrl),
    attachments: [],
    unsubscribeUrl,
    preheader,
  };
}

module.exports = {
  buildOfferCampaignEmail,
  buildUnsubscribeUrl,
};
