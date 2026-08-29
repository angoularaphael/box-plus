'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTACT = 'boxingcentertls@gmail.com';
const SITE = 'https://boxingcenter.fr/';
const LOGO_URL = 'https://gestion-manager.vercel.app/logo.png';
const MANAGER_BASE = 'https://manager.boxingcenter.fr';
const LEGAL =
  'Boxing Center — clubs de boxe à Toulouse et agglomération (France)';

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

function logoAttachment() {
  const candidates = [
    path.join(__dirname, '../../gestion-manager/public/logo.png'),
    path.join(__dirname, '../../../gestion-manager/public/logo.png'),
    path.join(__dirname, '../public/logo.png'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return {
          filename: 'logo.png',
          content: fs.readFileSync(file).toString('base64'),
          content_type: 'image/png',
          content_id: 'bc-logo@boxingcenter',
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function buildOfferCampaignEmail({ name, hubUrl, email }) {
  const unsubscribeUrl = buildUnsubscribeUrl(email);
  const subject = name
    ? `${name}, offres Boxing Center — 29 € ou 259 €`
    : 'Offres Boxing Center — 29 € ou 259 €';
  const preheader = '29 € / 4 semaines sans engagement, ou 259 € / 12 mois. Accès aux 5 salles.';
  const greeting = name ? `Bonjour ${name},` : 'Bonjour,';
  const emailText = [
    greeting,
    '',
    'Deux formules sont ouvertes chez Boxing Center.',
    '',
    '29 € / 4 semaines',
    'Sans engagement, sans préavis en cas de résiliation.',
    'Accès aux 5 salles, toutes les disciplines et tous les cours.',
    '',
    '259 € / 12 mois',
    'Au lieu de 400 €, paiement possible en 4 fois sans frais.',
    'Accès aux 5 salles, toutes les disciplines et tous les cours.',
    '',
    `Voir les offres : ${hubUrl}`,
    '',
    '29 € sans engagement, 259 € pour 12 mois.',
    '',
    'L’équipe Boxing Center',
    '',
    '—',
    LEGAL,
    `Contact : ${CONTACT}`,
    `Site : ${SITE}`,
    `Se désabonner : ${unsubscribeUrl}`,
    '',
    'Vous recevez cet email car vous êtes client ou contact Boxing Center.',
  ].join('\n');

  const logo = logoAttachment();
  const logoSrc = logo ? 'cid:bc-logo@boxingcenter' : LOGO_URL;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0 0 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:20px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="height:4px;background:#161A2E;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:26px 26px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
                <tr>
                  <td valign="middle" style="padding-right:12px">
                    <img src="${escapeHtml(logoSrc)}" alt="Boxing Center" width="48" height="48" border="0"
                      style="display:block;width:48px;height:48px;border:0;border-radius:50%;background:#ffffff" />
                  </td>
                  <td valign="middle">
                    <p style="margin:0;letter-spacing:.16em;text-transform:uppercase;font-size:12px;color:#6D3111">Boxing Center</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 14px;font-size:16px;color:#0f172a;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">Deux formules sont ouvertes chez Boxing Center.</p>
              <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">29 € / 4 semaines</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">Sans engagement, sans préavis en cas de résiliation. Accès aux <strong>5 salles</strong>, toutes les disciplines et tous les cours.</p>
              <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">259 € / 12 mois</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#334155;">Au lieu de 400 €, paiement possible en <strong>4 fois sans frais</strong>. Accès aux <strong>5 salles</strong>, toutes les disciplines et tous les cours.</p>
              <p style="margin:0 0 22px;">
                <a href="${escapeHtml(hubUrl)}" style="display:inline-block;background:#E8001C;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Voir les offres</a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
                <a href="${escapeHtml(hubUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(hubUrl)}</a>
              </p>
              <p style="margin:0;font-size:15px;color:#0f172a;">29 € sans engagement, 259 € pour 12 mois.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 26px 24px;">
              <p style="margin:18px 0 0;font-size:14px;color:#334155;">L’équipe Boxing Center</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;border-collapse:collapse;">
                <tr>
                  <td style="padding:16px 0 0;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#64748b;">
                    <p style="margin:0 0 8px;">${escapeHtml(LEGAL)}</p>
                    <p style="margin:0 0 8px;">
                      <a href="${SITE}" style="color:#2563eb;text-decoration:none;">boxingcenter.fr</a>
                      · <a href="mailto:${CONTACT}" style="color:#2563eb;text-decoration:none;">${CONTACT}</a>
                    </p>
                    <p style="margin:0;">
                      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Se désabonner</a>
                      — vous ne recevrez plus nos emails promotionnels.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    fromName: 'Boxing Center',
    subject,
    html,
    emailText,
    headers: listUnsubscribeHeaders(unsubscribeUrl),
    attachments: logo ? [logo] : [],
    unsubscribeUrl,
    preheader,
  };
}

module.exports = {
  buildOfferCampaignEmail,
  buildUnsubscribeUrl,
};
