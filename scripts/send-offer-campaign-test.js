'use strict';

/**
 * Envoi test (WhatsApp bot boutique + mail) du message offres 29 / 259.
 *   node scripts/send-offer-campaign-test.js
 */
require('dotenv').config();
process.env.STORE_URL = 'https://boutique.boxingcenter.fr';

const { customerNudgeCopy } = require('../storefront/lib/essai-followup');
const { sendWhatsAppMessage, toWhatsAppPhone } = require('../storefront/lib/whatsapp-bot');
const { sendEmailViaBrevo, isConfigured } = require('../storefront/lib/brevo-send');

const TARGET = {
  first_name: 'Guillaume',
  last_name: 'Cessac',
  email: 'boxingcenter31@gmail.com',
  phone: '0684698028',
};

async function main() {
  const copy = customerNudgeCopy({ customer_short: TARGET }, 1);
  const to = toWhatsAppPhone(TARGET.phone);
  const out = { name: copy.name, subject: copy.subject, hubUrl: copy.hubUrl, whatsapp: null, email: null };

  if (!to) throw new Error('Numéro WhatsApp invalide');
  out.whatsapp = await sendWhatsAppMessage(to, copy.text);

  if (!isConfigured()) {
    out.email = { sent: false, reason: 'brevo_not_configured' };
  } else {
    out.email = await sendEmailViaBrevo({
      to: TARGET.email,
      subject: copy.subject,
      html: copy.html,
      text: copy.text,
    });
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
