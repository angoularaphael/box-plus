'use strict';

/**
 * Envoi test campagne 29/259.
 * Mail = Resend (no-reply@boxingcenter.fr). WhatsApp = bot boutique.
 *
 *   node scripts/send-offer-campaign-test.js           # mail seulement
 *   node scripts/send-offer-campaign-test.js --wa      # mail + WhatsApp
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '..', 'gestion-manager', '.env.local'));
loadEnvFile(path.join(ROOT, '..', 'gestion-manager', '.env'));
loadEnvFile(path.join(ROOT, '..', 'gestion-manager', 'bots', 'deploy', 'email-resend', '.env'));

process.env.STORE_URL = 'https://boutique.boxingcenter.fr';
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'resend';
process.env.EMAIL_UNSUBSCRIBE_BASE =
  process.env.EMAIL_UNSUBSCRIBE_BASE || 'https://manager.boxingcenter.fr';
process.env.RESEND_SENDER_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
process.env.RESEND_SENDER_NAME = process.env.RESEND_SENDER_NAME || 'Boxing Center';

const { customerNudgeCopy } = require('../storefront/lib/essai-followup');
const { sendWhatsAppMessage, toWhatsAppPhone } = require('../storefront/lib/whatsapp-bot');
const { sendEmailViaResend, isConfigured, senderEmail } = require('../storefront/lib/resend-send');

const TARGET = {
  first_name: 'Guillaume',
  last_name: 'Cessac',
  email: 'boxingcenter31@gmail.com',
  phone: '0684698028',
};

const WITH_WA = process.argv.includes('--wa');

async function main() {
  const copy = customerNudgeCopy({ customer_short: TARGET }, 1);
  const out = {
    name: copy.name,
    subject: copy.subject,
    hubUrl: copy.hubUrl,
    from: senderEmail(),
    whatsapp: WITH_WA ? null : { skipped: true },
    email: null,
  };

  if (!isConfigured()) {
    throw new Error('RESEND_API_KEY manquant (BOXPLUS ou gestion-manager .env)');
  }

  out.email = await sendEmailViaResend({
    to: TARGET.email,
    subject: copy.subject,
    html: copy.html,
    text: copy.emailText || copy.text,
    headers: copy.headers,
    attachments: copy.attachments,
  });

  if (WITH_WA) {
    const to = toWhatsAppPhone(TARGET.phone);
    if (!to) throw new Error('Numéro WhatsApp invalide');
    out.whatsapp = await sendWhatsAppMessage(to, copy.text);
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
