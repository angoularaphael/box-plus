const AVENTURE_URL = 'https://aventure.boxingcenter.fr';

const BALMA_WA = [
  'Salut {prenom} — 29,99€ / 4 sem. ou 259€ / an. Résilie Cour des Miracles puis {lien}',
  'Bonjour {prenom}, offres 29,99€ ou 259€. Lien : {lien}',
  '{prenom}, Boxing Center continue. 29,99€ / 259€. {lien}',
  'Hey {prenom} ! 29€ ou 259€. {lien}',
  'Coucou {prenom}, 29,99€ / 4 sem. ou 259€ / an. {lien}',
  '{prenom} 29,99€ ou 259€ — 5 salles. {lien}',
  'Bonjour {prenom}, rentrée 29,99€ / 259€. {lien}',
  '{prenom} ! 29,99€ / 4 semaines ou 259€ / 12 mois. {lien}',
  'Salut {prenom}, reste aux 5 salles : 29,99€ ou 259€. {lien}',
  '{prenom}, 29,99€ / 4 sem. · 259€ / an. {lien}',
  'Hello {prenom}, rentrée 29,99€ ou 259€. {lien}',
  '{prenom}, on continue l’aventure. 29,99€ ou 259€. {lien}',
];

function fill(template, { prenom, lien } = {}) {
  return String(template || '')
    .replace(/\{prenom\}/g, String(prenom || '').trim() || 'toi')
    .replace(/\{lien\}/g, lien || AVENTURE_URL);
}

module.exports = { AVENTURE_URL, BALMA_WA, fill };
