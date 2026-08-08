const fs = require('fs');
const { logInfo, logWarn } = require('../../lib/logger');
const { readLegal } = require('./contract-pdf');
const { getMailFrom, CGV_URL, REGLEMENT_URL, SITE_URL } = require('./branding');
const {
  generateInscriptionInvoicePdf,
  generateMaterielInvoicePdf,
} = require('./invoice-pdf');
const { sendEmailViaBrevo, isConfigured, defaultReplyTo } = require('./brevo-send');

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
  <p>Vous trouverez en pièces jointes votre <strong>contrat d'adhésion Boxing Center</strong> au nom de ${short.first_name || ''} ${short.last_name || ''}, votre facture, le règlement intérieur et les CGV.</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="${SITE_URL}" style="color:#2EC4C6">${SITE_URL.replace('https://', '')}</a></p>
</body>
</html>`;
}

async function buildInscriptionAttachments(order, extra = []) {
  const attachments = [];
  const cgv = readLegal('cgv.md');
  const reglement = readLegal('reglement.md');
  if (cgv) {
    attachments.push({ filename: 'CGV-Boxing-Center.txt', content: cgv });
  }
  if (reglement) {
    attachments.push({ filename: 'Reglement-interieur.txt', content: reglement });
  }
  for (const att of extra) {
    if (att.filepath && fs.existsSync(att.filepath)) {
      attachments.push({ filename: att.filename, path: att.filepath });
    }
  }
  try {
    const invoice = await generateInscriptionInvoicePdf(order);
    if (invoice?.filepath) {
      attachments.push({ filename: invoice.filename, path: invoice.filepath });
    }
  } catch (err) {
    logWarn('Facture inscription non générée', { order_id: order.order_id, error: err.message });
  }
  return attachments;
}

async function sendConfirmationEmail(order, attachments = []) {
  const to = order.customer_short?.email;
  if (!to) {
    logWarn('Email confirmation ignoré — pas d\'email client', { order_id: order.order_id });
    return { sent: false, reason: 'no_email' };
  }

  const html = buildConfirmationHtml(order);
  const mailAttachments = await buildInscriptionAttachments(order, attachments);

  if (!isConfigured()) {
    logInfo('Email confirmation (mode log)', { to, order_id: order.order_id });
    return {
      sent: false,
      reason: 'brevo_not_configured',
      error: 'Service email non configuré (BREVO_API_KEY manquant sur Vercel)',
      preview: html,
    };
  }

  try {
    const result = await sendEmailViaBrevo({
      to,
      subject: `Confirmation inscription Boxing Center — ${order.order_id}`,
      html,
      replyTo: defaultReplyTo(),
      attachments: mailAttachments,
    });
    if (!result) {
      return {
        sent: false,
        reason: 'brevo_not_configured',
        error: 'Envoi email impossible — BREVO_API_KEY requis en production',
      };
    }
    logInfo('Email confirmation envoyé', { to, order_id: order.order_id, via: result.via });
    return { sent: true, via: result.via };
  } catch (err) {
    logWarn('Email confirmation échoué', { order_id: order.order_id, error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message };
  }
}

async function sendGdprEraseRequest(data) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.ALERT_EMAIL;
  if (!isConfigured() || !adminEmail) {
    logInfo('Demande RGPD (log)', data);
    return { sent: false };
  }
  try {
    await sendEmailViaBrevo({
      to: adminEmail,
      subject: 'Demande suppression données RGPD',
      text: `Email: ${data.email}\nMessage: ${data.message || '—'}`,
      replyTo: data.email,
    });
    return { sent: true };
  } catch (err) {
    logWarn('Email RGPD échoué', { error: err.message });
    return { sent: false, error: err.message };
  }
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
  <p>Votre facture est jointe à cet email.</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="https://boxingcenter.fr">boxingcenter.fr</a></p>
</body>
</html>`;
}

async function sendMaterielConfirmationEmail(order) {
  const to = order.customer?.email;
  if (!to) {
    logWarn('Email matériel ignoré — pas d\'email client', { order_id: order.order_id });
    return { sent: false, reason: 'no_email' };
  }

  const html = buildMaterielConfirmationHtml(order);
  const attachments = [];
  try {
    const invoice = await generateMaterielInvoicePdf(order);
    if (invoice?.filepath) {
      attachments.push({ filename: invoice.filename, path: invoice.filepath });
    }
  } catch (err) {
    logWarn('Facture matériel non générée', { order_id: order.order_id, error: err.message });
  }

  if (!isConfigured()) {
    logInfo('Email matériel (mode log)', { to, order_id: order.order_id });
    return { sent: false, reason: 'brevo_not_configured', preview: html };
  }

  try {
    const result = await sendEmailViaBrevo({
      to,
      subject: `Commande matériel Boxing Center — ${order.order_id}`,
      html,
      replyTo: defaultReplyTo(),
      attachments,
    });
    if (!result) {
      return { sent: false, reason: 'brevo_not_configured' };
    }
    logInfo('Email matériel envoyé', { to, order_id: order.order_id, via: result.via });
    return { sent: true, via: result.via };
  } catch (err) {
    logWarn('Email matériel échoué', { order_id: order.order_id, error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message };
  }
}

async function sendTestEmail(to) {
  if (!isConfigured()) {
    return { sent: false, reason: 'brevo_not_configured' };
  }
  try {
    const result = await sendEmailViaBrevo({
      to,
      subject: 'Test BOXPLUS — Boxing Center',
      html: `<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;padding:24px">
        <h1 style="color:#0B1F3A">Test email BOXPLUS</h1>
        <p>Ceci est un email de test envoyé depuis la boutique Boxing Center.</p>
        <p style="color:#6B7280;font-size:13px">Si vous recevez ce message, l'envoi Brevo fonctionne correctement.</p>
      </body></html>`,
      replyTo: defaultReplyTo(),
    });
    if (!result) return { sent: false, reason: 'brevo_not_configured' };
    logInfo('Email test envoyé', { to, via: result.via });
    return { sent: true, via: result.via };
  } catch (err) {
    logWarn('Email test échoué', { to, error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message };
  }
}

async function sendUnpaidSubscriptionEmail(
  order,
  { portalUrl, failCount = 1, accessBlocked = false, adminAlert = false } = {}
) {
  const to = order.customer_short?.email;
  if (!to) {
    logWarn('Email impayé ignoré — pas d\'email client', { order_id: order.order_id });
    return { sent: false, reason: 'no_email' };
  }

  const short = order.customer_short || {};
  const product = order.product_snapshot || {};
  const adminTo =
    process.env.ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL || process.env.ALERT_EMAIL || '';
  const payLink = portalUrl
    ? `<p><a href="${portalUrl}" style="display:inline-block;padding:12px 20px;background:#C8902F;color:#0B1F3A;text-decoration:none;font-weight:700;border-radius:6px">Mettre à jour mon moyen de paiement</a></p>`
    : `<p>Connectez-vous à votre espace bancaire / Stripe pour mettre à jour votre carte, ou contactez le club.</p>`;

  const blockNote = accessBlocked
    ? `<p style="color:#b00020"><strong>Votre accès est suspendu</strong> après ${failCount} tentative(s) de recouvrement en échec.</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Paiement en échec — Boxing Center</title></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#0B1F3A">Paiement d'abonnement en échec</h1>
  <p>Bonjour ${short.first_name || ''},</p>
  <p>Le renouvellement de votre abonnement <strong>${product.display_name || product.name || ''}</strong> n'a pas pu être débité (tentative ${failCount}).</p>
  ${blockNote}
  <p>Sans régularisation, l'accès au club pourra être suspendu.</p>
  ${payLink}
  <p>Référence : ${order.order_id}</p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — <a href="${SITE_URL}" style="color:#2EC4C6">${SITE_URL.replace('https://', '')}</a></p>
</body>
</html>`;

  if (!isConfigured()) {
    logInfo('Email impayé (mode log)', { to, order_id: order.order_id });
    return { sent: false, reason: 'brevo_not_configured', preview: html };
  }

  try {
    const result = await sendEmailViaBrevo({
      to,
      subject: accessBlocked
        ? 'Accès suspendu — échec de paiement Boxing Center'
        : 'Action requise — échec de paiement Boxing Center',
      html,
      replyTo: defaultReplyTo(),
    });
    if (adminTo && adminTo !== to && (adminAlert || failCount >= 3 || accessBlocked)) {
      await sendEmailViaBrevo({
        to: adminTo,
        subject: `[CB refusée / bloquée] ${short.email || order.order_id} — ${failCount} échec(s)`,
        html: `<p>Échec recouvrement Stripe après ${failCount} tentative(s).</p>
          <p>Accès bloqué : ${accessBlocked ? 'oui' : 'non'}</p>
          <p>Client : ${short.first_name || ''} ${short.last_name || ''} — ${to}</p>
          <p>Commande : ${order.order_id}</p>
          <p>Offre : ${product.display_name || product.name || ''}</p>`,
        replyTo: defaultReplyTo(),
      }).catch(() => null);
    }
    if (!result) return { sent: false, reason: 'brevo_not_configured' };
    logInfo('Email impayé envoyé', { to, order_id: order.order_id, failCount, accessBlocked });
    return { sent: true };
  } catch (err) {
    logWarn('Email impayé échoué', { to, order_id: order.order_id, error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message };
  }
}

async function sendNewMemberAdminEmail(payload = {}) {
  if (/@boxplus-test\.local$/i.test(String(payload.email || ''))) {
    return { sent: false, reason: 'test_email_skipped' };
  }
  const adminTo =
    process.env.ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL || process.env.ALERT_EMAIL || '';
  if (!adminTo) return { sent: false, reason: 'no_admin_email' };
  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;padding:24px">
    <h2>Nouveau membre créé dans Deciplus</h2>
    <p><strong>Commande :</strong> ${payload.order_id || '—'}</p>
    <p><strong>Membre Deciplus :</strong> ${payload.member_id || '—'}</p>
    <p><strong>Nom :</strong> ${payload.first_name || ''} ${payload.last_name || ''}</p>
    <p><strong>Email :</strong> ${payload.email || '—'}</p>
    <p><strong>Salle :</strong> ${payload.gym || '—'}</p>
    <p><strong>Offre :</strong> ${payload.product_name || '—'}</p>
  </body></html>`;
  if (!isConfigured()) {
    logInfo('Email nouveau membre (mode log)', { adminTo, order_id: payload.order_id });
    return { sent: false, reason: 'brevo_not_configured' };
  }
  try {
    await sendEmailViaBrevo({
      to: adminTo,
      subject: `[Nouveau membre] ${payload.first_name || ''} ${payload.last_name || ''} — ${payload.order_id || ''}`.trim(),
      html,
      replyTo: defaultReplyTo(),
    });
    return { sent: true };
  } catch (err) {
    logWarn('Email nouveau membre échoué', { error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message };
  }
}

module.exports = {
  sendConfirmationEmail,
  sendMaterielConfirmationEmail,
  sendGdprEraseRequest,
  sendTestEmail,
  sendUnpaidSubscriptionEmail,
  sendNewMemberAdminEmail,
  buildConfirmationHtml,
  buildMaterielConfirmationHtml,
  getMailFrom,
};
