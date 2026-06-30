/** URLs et expéditeur email — alignés PrestaShop / campagne Boxing Center */
const { DEFAULT_SENDER_EMAIL, DEFAULT_SENDER_NAME } = require('./brevo-send');

const CGV_URL = 'https://boutique.boxingcenter.fr/content/3-conditions';
const REGLEMENT_URL = 'https://boxingcenter.fr/participez-seance-essai/';
const SITE_URL = 'https://boxingcenter.fr';
const BOUTIQUE_URL = 'https://boutique.boxingcenter.fr';
const DEFAULT_MAIL_FROM = `${DEFAULT_SENDER_NAME} <${DEFAULT_SENDER_EMAIL}>`;

function getMailFrom() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  const email = process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER_EMAIL;
  const name = process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME;
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
