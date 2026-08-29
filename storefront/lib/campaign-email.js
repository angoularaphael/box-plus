'use strict';

const CAMPAIGN_FROM_NAME = 'Boxing Center';

function offerLink(hubUrl) {
  return String(hubUrl || 'https://boutique.boxingcenter.fr/offres-speciales');
}

function buildOfferCampaignEmail({ name, hubUrl }) {
  const subject = name ? `${name}, c’est l’équipe BC` : 'C’est l’équipe BC';
  const greeting = name
    ? `Salut ${name}, c’est l’équipe BC.`
    : 'Salut, c’est l’équipe BC.';
  const link = offerLink(hubUrl);
  const emailText = [
    greeting,
    '',
    'Il reste encore quelques places pour les deux formules en cours.',
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
    'BC',
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
  buildOfferCampaignEmail,
  buildUnsubscribeUrl: () => '',
};
