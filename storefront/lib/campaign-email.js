'use strict';

const CAMPAIGN_FROM_NAME = 'David';
const CAMPAIGN_SIGN_OFF = 'David de Boxing Center';

function offerLink(hubUrl) {
  return String(hubUrl || 'https://boutique.boxingcenter.fr/offres-speciales');
}

function buildOfferCampaignEmail({ name, hubUrl }) {
  const subject = name ? `${name}, c’est David` : 'C’est David';
  const greeting = name ? `Salut ${name},` : 'Salut,';
  const link = offerLink(hubUrl);
  const emailText = [
    greeting,
    '',
    'C’est David. Il reste encore quelques places pour les deux formules en cours.',
    '',
    '29 euros les 4 semaines : sans engagement, sans préavis si tu pars, accès aux 5 salles, toutes les disciplines, tous les cours.',
    '',
    '259 euros les 12 mois : au lieu de 400 euros, tu peux payer en 4 fois sans frais. Mêmes salles, mêmes cours.',
    '',
    'Tout se passe ici :',
    link,
    '',
    '29 euros sans engagement, 259 euros pour l’année. Tant qu’il reste de la place.',
    '',
    'À plus tard,',
    CAMPAIGN_SIGN_OFF,
  ].join('\n');

  return {
    fromName: CAMPAIGN_FROM_NAME,
    subject,
    html: undefined,
    emailText,
    headers: undefined,
    attachments: [],
    unsubscribeUrl: '',
    preheader: '',
  };
}

module.exports = {
  CAMPAIGN_FROM_NAME,
  CAMPAIGN_SIGN_OFF,
  buildOfferCampaignEmail,
  buildUnsubscribeUrl: () => '',
};
