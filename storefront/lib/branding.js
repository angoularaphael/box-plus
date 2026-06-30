/** URLs et expéditeur email — alignés PrestaShop / campagne Boxing Center */
const CGV_URL = 'https://boutique.boxingcenter.fr/content/3-conditions';
const REGLEMENT_URL = 'https://boxingcenter.fr/participez-seance-essai/';
const SITE_URL = 'https://boxingcenter.fr';
const BOUTIQUE_URL = 'https://boutique.boxingcenter.fr';
const DEFAULT_MAIL_FROM = 'Boxing Center <no-reply@boxing-center-portet.fr>';

function getMailFrom() {
  return process.env.MAIL_FROM || DEFAULT_MAIL_FROM;
}

module.exports = {
  CGV_URL,
  REGLEMENT_URL,
  SITE_URL,
  BOUTIQUE_URL,
  DEFAULT_MAIL_FROM,
  getMailFrom,
};
