/** URLs et expéditeur email — Boxing Center */
const { DEFAULT_SENDER_EMAIL, senderEmail } = require('./resend-send');

const CGV_URL = '/cgv';
const REGLEMENT_URL = '/reglement-interieur';
const SITE_URL = 'https://boxingcenter.fr';
const BOUTIQUE_URL = 'https://boutique.boxingcenter.fr';
const DEFAULT_MAIL_FROM = `Boxing Center <${DEFAULT_SENDER_EMAIL}>`;

function getMailFrom() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  const email = process.env.RESEND_SENDER_EMAIL || senderEmail();
  const name = process.env.RESEND_INVOICE_FROM_NAME || 'Boxing Center';
  return `${name} <${email}>`;
}

module.exports = {
  CGV_URL,
  REGLEMENT_URL,
  SITE_URL,
  BOUTIQUE_URL,
  DEFAULT_MAIL_FROM,
  getMailFrom,
};
