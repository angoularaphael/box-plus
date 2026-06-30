/** URLs et expéditeur email — Boxing Center */
const { DEFAULT_SENDER_EMAIL, DEFAULT_SENDER_NAME } = require('./brevo-send');

const CGV_URL = '/cgv';
const REGLEMENT_URL = '/reglement-interieur';
const SITE_URL = 'https://boxingcenter.fr';
const BOUTIQUE_URL = 'https://box-plus.vercel.app';
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
