const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { logInfo, logWarn } = require('../../lib/logger');
const { readLegal } = require('./contract-pdf');

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
  <p>Vous trouverez en pièces jointes votre contrat, le règlement intérieur et les CGV.</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="https://boxingcenter.fr">boxingcenter.fr</a></p>
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

  const from = process.env.MAIL_FROM || 'boutique@boxingcenter.fr';
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
    from: process.env.MAIL_FROM || 'boutique@boxingcenter.fr',
    to: adminEmail,
    subject: 'Demande suppression données RGPD',
    text: `Email: ${data.email}\nMessage: ${data.message || '—'}`,
  });
  return { sent: true };
}

module.exports = { sendConfirmationEmail, sendGdprEraseRequest, buildConfirmationHtml };
