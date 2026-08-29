'use strict';

function offerLink(hubUrl) {
  return String(hubUrl || 'https://boutique.boxingcenter.fr/offres-speciales');
}

function buildOfferCampaignEmail({ name, hubUrl }) {
  const subject = name ? `${name}, c’est Guillaume` : 'C’est Guillaume';
  const greeting = name ? `Salut ${name},` : 'Salut,';
  const link = offerLink(hubUrl);
  const emailText = [
    greeting,
    '',
    'On s’est croisés à la salle. Si tu veux continuer, voilà comment ça se passe.',
    '',
    'Tu peux venir 4 semaines pour 29 euros, sans t’engager, et tu arrêtes quand tu veux. Les cinq salles sont ouvertes, tous les cours.',
    '',
    'Si tu restes l’année, c’est 259 euros au lieu de 400, en 4 fois si tu préfères.',
    '',
    link,
    '',
    'À plus tard,',
    'Guillaume',
  ].join('\n');

  return {
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
  buildOfferCampaignEmail,
  buildUnsubscribeUrl: () => '',
};
