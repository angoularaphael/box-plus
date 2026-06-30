const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { logInfo, logWarn } = require('../../lib/logger');
const { readLegal } = require('./contract-pdf');
const { getMailFrom, CGV_URL, REGLEMENT_URL, SITE_URL } = require('./branding');

function createTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: user ? { user, pass } : undefined,
  });
}

function buildConfirmationHtml(order) {
  const short = order.customer_short || {};
  const product = order.product_snapshot || {};
  const gym = order.customer_full?.gym || '—';
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Confirmation Boxing Center</title></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#0B1F3A">Bienvenue chez Boxing Center !</h1>
  <p>Bonjour ${short.first_name || ''},</p>
  <p>Votre inscription est confirmée. Voici le récapitulatif :</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Offre</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${product.display_name || product.name}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Référence</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${order.order_id}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Salle principale</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${gym}</td></tr>
  </table>
  <p><strong>Pour bien démarrer :</strong></p>
  <ul>
    <li>Présentez-vous 15 minutes avant votre premier cours</li>
    <li>Munissez-vous d'une tenue de sport et d'une bouteille d'eau</li>
    <li>Pas besoin d'expérience — nos coachs vous accueillent</li>
    <li>Votre abonnement donne accès à nos 5 salles</li>
  </ul>
  <p>Vous trouverez en pièces jointes votre contrat signé, le règlement intérieur et les CGV.</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="${SITE_URL}" style="color:#2EC4C6">${SITE_URL.replace('https://', '')}</a></p>
</body>
</html>`;
}

async function sendConfirmationEmail(order, attachments = []) {
  const transport = createTransport();
  const to = order.customer_short?.email;
  if (!to) {
    logWarn('Email confirmation ignoré — pas d\'email client', { order_id: order.order_id });
    return { sent: false, reason: 'no_email' };
  }

  const from = getMailFrom();
  const html = buildConfirmationHtml(order);

  const defaultAttachments = [];
  const cgv = readLegal('cgv.md');
  const reglement = readLegal('reglement.md');
  if (cgv) {
    defaultAttachments.push({ filename: 'CGV-Boxing-Center.txt', content: cgv });
  }
  if (reglement) {
    defaultAttachments.push({ filename: 'Reglement-interieur.txt', content: reglement });
  }
  for (const att of attachments) {
    if (att.filepath && fs.existsSync(att.filepath)) {
      defaultAttachments.push({ filename: att.filename, path: att.filepath });
    }
  }

  if (!transport) {
    logInfo('Email confirmation (mode log)', { to, order_id: order.order_id });
    return { sent: false, reason: 'smtp_not_configured', preview: html };
  }

  await transport.sendMail({
    from,
    to,
    subject: `Confirmation inscription Boxing Center — ${order.order_id}`,
    html,
    attachments: defaultAttachments,
  });

  logInfo('Email confirmation envoyé', { to, order_id: order.order_id });
  return { sent: true };
}

async function sendGdprEraseRequest(data) {
  const transport = createTransport();
  const adminEmail = process.env.ADMIN_EMAIL || process.env.ALERT_EMAIL;
  if (!transport || !adminEmail) {
    logInfo('Demande RGPD (log)', data);
    return { sent: false };
  }
  await transport.sendMail({
    from: process.env.MAIL_FROM || getMailFrom(),
    to: adminEmail,
    subject: 'Demande suppression données RGPD',
    text: `Email: ${data.email}\nMessage: ${data.message || '—'}`,
  });
  return { sent: true };
}

function formatEuros(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function buildMaterielConfirmationHtml(order) {
  const customer = order.customer || {};
  const rows = (order.items || [])
    .map(
      (item) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${item.name}${item.variant_label ? ` (${item.variant_label})` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${item.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatEuros(item.line_total_cents)}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Commande matériel Boxing Center</title></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#0B1F3A">Commande matériel confirmée</h1>
  <p>Bonjour ${customer.first_name || ''},</p>
  <p>Merci pour votre achat. Votre commande est payée et prête à être retirée en salle.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tr style="background:#f5f6f8">
      <th style="padding:8px;text-align:left">Article</th>
      <th style="padding:8px;text-align:center">Qté</th>
      <th style="padding:8px;text-align:right">Total</th>
    </tr>
    ${rows}
    <tr>
      <td colspan="2" style="padding:8px;font-weight:bold">Total TTC</td>
      <td style="padding:8px;text-align:right;font-weight:bold">${formatEuros(order.total_cents)}</td>
    </tr>
  </table>
  <p><strong>Lieu de retrait :</strong> ${order.pickup_gym || customer.pickup_gym || '—'}</p>
  <p><strong>Référence commande :</strong> ${order.order_id}</p>
  <p>Présentez cet email à l'accueil de la salle pour récupérer votre matériel.</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="https://boxingcenter.fr">boxingcenter.fr</a></p>
</body>
</html>`;
}

async function sendMaterielConfirmationEmail(order) {
  const transport = createTransport();
  const to = order.customer?.email;
  if (!to) {
    logWarn('Email matériel ignoré — pas d\'email client', { order_id: order.order_id });
    return { sent: false, reason: 'no_email' };
  }

  const from = getMailFrom();
  const html = buildMaterielConfirmationHtml(order);

  if (!transport) {
    logInfo('Email matériel (mode log)', { to, order_id: order.order_id });
    return { sent: false, reason: 'smtp_not_configured', preview: html };
  }

  await transport.sendMail({
    from,
    to,
    subject: `Commande matériel Boxing Center — ${order.order_id}`,
    html,
  });

  logInfo('Email matériel envoyé', { to, order_id: order.order_id });
  return { sent: true };
}

module.exports = {
  sendConfirmationEmail,
  sendMaterielConfirmationEmail,
  sendGdprEraseRequest,
  buildConfirmationHtml,
  buildMaterielConfirmationHtml,
};
