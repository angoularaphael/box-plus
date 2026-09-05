'use strict';

const CAMPAIGN_FROM_NAME = 'David';
const CAMPAIGN_SIGN_OFF = 'David de Boxing Center';
const CLUB_POSTAL_ADDRESS = '12 rue de Fenouillet, 31200 Toulouse';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSimpleHtmlEmail({ greeting, paragraphs = [], ctaUrl, ctaLabel, signOff }) {
  const intro = greeting
    ? `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111">${escapeHtml(greeting)}</p>`
    : '';
  const body = paragraphs
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">${escapeHtml(line)}</p>`
    )
    .join('');
  const cta = ctaUrl
    ? `<p style="margin:22px 0 8px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600">${escapeHtml(ctaLabel || 'Voir les cours enfants')}</a></p>`
    : '';
  const footer = signOff
    ? `<p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${escapeHtml(signOff)}</p>`
    : '';
  const legal = `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e8e8e8;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#666">Boxing Center — ${escapeHtml(CLUB_POSTAL_ADDRESS)}<br>Répondre à ce message ou écrire à boxingcentertls@gmail.com</p>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f4f4f5"><div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border-radius:12px">${intro}${body}${cta}${footer}${legal}</div></body></html>`;
}

function campaignReplyHeaders() {
  return {
    'List-Unsubscribe': '<mailto:boxingcentertls@gmail.com?subject=Desinscription>',
  };
}

function firstNameOf(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return raw
    .split(/([\s'-]+)/)
    .map((part, i) => {
      if (i % 2 === 1 || !part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function buildDavidPlainEmail({ name, lines }) {
  const who = firstNameOf(name);
  const greeting = who ? `Salut ${who},` : 'Salut,';
  const subject = who ? `${who}, c’est David` : 'C’est David';
  return {
    fromName: CAMPAIGN_FROM_NAME,
    subject,
    html: undefined,
    emailText: [greeting, '', ...lines, '', 'À plus tard,', CAMPAIGN_SIGN_OFF].join('\n'),
    headers: undefined,
    attachments: [],
  };
}

function buildInscriptionNudgeEmail({ name, url, paidDossier = false }) {
  const link = String(url || '').trim();
  const lines = paidDossier
    ? [
        'C’est David. Petit mot pour toi.',
        '',
        'Le règlement est bon. Il reste juste le dossier.',
        '',
        'C’est ici :',
        link,
      ]
    : [
        'C’est David. Petit mot pour toi.',
        '',
        'Tu n’as pas fini. Reprends ici :',
        link,
      ];
  return buildDavidPlainEmail({ name, lines });
}

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

const ENFANTS_CAMPAIGN_URL = 'https://boutique.boxingcenter.fr/abonnements#enfants';

function enfantsCampaignBodyLines() {
  return [
    "Salut c'est David de Boxing Center.",
    'Les cours enfants ont repris dans nos 5 clubs et il reste encore des places disponibles.',
    '',
    'Baby Boxe dès 3 ans, Boxe Éducative enfants/ados pour les 7/11 et 12/16 ans — cours encadrés par des coachs professionnels.',
    '',
    'Baby Boxe : samedi 14h15-15h.',
    'Boxe Éducative (7/11 ans et 12/16 ans) : mercredi et samedi 15h/16h & 16h/17h.',
    'Vacances scolaires incluses.',
    '',
    'Paiement possible en 4× sans frais depuis notre boutique en ligne :',
    ENFANTS_CAMPAIGN_URL,
    '',
    "Séance d'essai offerte pour les enfants.",
    '',
    'L’équipe Boxing Center',
  ];
}

function buildEnfantsCampaignEmail({ name } = {}) {
  const who = firstNameOf(name);
  const greeting = who ? `Salut ${who},` : 'Salut,';
  const subject = who ? `${who}, c'est David` : "C'est David";
  const emailText = [
    greeting,
    '',
    "C'est David de Boxing Center. Les cours enfants ont repris dans nos 5 clubs.",
    '',
    'Baby Boxe dès 3 ans — samedi 14h15-15h.',
    'Boxe éducative 7/11 et 12/16 ans — mercredi et samedi 15h/16h et 16h/17h.',
    'Vacances scolaires incluses.',
    '',
    "Séance d'essai offerte pour les enfants.",
    '',
    'Horaires et inscriptions ici :',
    ENFANTS_CAMPAIGN_URL,
    '',
    'À bientôt,',
    CAMPAIGN_SIGN_OFF,
    '',
    CLUB_POSTAL_ADDRESS,
    '',
    'Répondre à ce mail ou écrire à boxingcentertls@gmail.com',
    'Pour ne plus recevoir ce type de message : répondez « désinscription ».',
  ].join('\n');
  return {
    fromName: 'David de Boxing Center',
    subject,
    html: undefined,
    emailText,
    headers: campaignReplyHeaders(),
    attachments: [],
    unsubscribeUrl: '',
    preheader: '',
    replyTo: 'boxingcentertls@gmail.com',
  };
}

function enfantsCampaignSmsText() {
  return [
    "Salut c'est David de Boxing Center.",
    'Les cours enfants ont repris dans nos 5 clubs et il reste encore des places disponibles.',
    '',
    'Baby Boxe des 3 ans, Boxe Educative enfants/ados pour les 7/11 et 12/16 ans. Cours encadres par des coachs professionnels.',
    '',
    'Baby Boxe : samedi 14h15-15h.',
    'Boxe Educative (7/11 ans et 12/16 ans) : mercredi et samedi 15h/16h et 16h/17h.',
    'Vacances scolaires incluses.',
    '',
    'Paiement possible en 4x sans frais depuis notre boutique en ligne :',
    ENFANTS_CAMPAIGN_URL,
    '',
    "Seance d'essai offerte pour les enfants.",
    '',
    "L'equipe Boxing Center",
  ].join('\n');
}

module.exports = {
  CAMPAIGN_FROM_NAME,
  CAMPAIGN_SIGN_OFF,
  ENFANTS_CAMPAIGN_URL,
  buildOfferCampaignEmail,
  buildEnfantsCampaignEmail,
  enfantsCampaignSmsText,
  buildDavidPlainEmail,
  buildInscriptionNudgeEmail,
  buildSimpleHtmlEmail,
  campaignReplyHeaders,
  buildUnsubscribeUrl: () => '',
};
