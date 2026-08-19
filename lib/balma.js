/**
 * Campagne Balma → Boxing Center.
 * Auto-migration sur toutes les ventes : désactivée par défaut
 * (BALMA_AUTOMIGRATE_ON_SALE=0). Uniquement la page Aventure.
 */

const BALMA_SOURCE = 'balma_retour';
const AVENTURE_HOST = 'aventure.boxingcenter.fr';
const AVENTURE_PATH = '/aventure';
const CLUB_CONTACT = 'boxingcenter31@gmail.com';
const COUR_DES_MIRACLES_EMAIL = 'contactgotatoulouse@gmail.com';

function isBalmaRetourSource(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  return raw === BALMA_SOURCE || raw === 'balma' || raw.includes('balma_retour');
}

function isBalmaRetourOrder(order = {}) {
  return (
    isBalmaRetourSource(order.source) ||
    isBalmaRetourSource(order.utm?.source) ||
    isBalmaRetourSource(order.utm?.campaign)
  );
}

function isOffre29Product(product = {}, order = {}) {
  const ids = [product.id, product.product_id, product.legacy_id, order.product_id]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  if (ids.some((id) => id === 'offre-duo' || id === 'offre_29' || id === 'dp-104')) return true;
  const name = String(product.name || product.display_name || order.product_name || '');
  return /29[,.]?99|offre\s*duo|offre\s*a\s*29/i.test(name);
}

function isOffre259Product(product = {}, order = {}) {
  const ids = [product.id, product.product_id, product.legacy_id, order.product_id]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  if (ids.some((id) => id === 'offre-saison' || id === 'offre_259' || id === 'dp-100')) return true;
  const name = String(product.name || product.display_name || order.product_name || '');
  return /offre\s*saison|259\s*€|OFFRE\s*PROMO\s*12\s*MOIS/i.test(name);
}

/** Badge 34,99 € en comptant uniquement si source Balma + offre 29. */
function shouldGiftBadgeComptant(order = {}, product = {}) {
  return isBalmaRetourOrder(order) && isOffre29Product(product, order);
}

function balmaBadgePaymentFields(order = {}, product = {}) {
  if (!shouldGiftBadgeComptant(order, product)) return null;
  return {
    badge_timing: 'immediate',
    badge_method: 'comptant',
    badge_paiement_comptant: true,
  };
}

function isBalmaAutomigrateOnSaleEnabled() {
  return String(process.env.BALMA_AUTOMIGRATE_ON_SALE || '0') === '1';
}

function isAventureHost(req) {
  const host = String(req?.headers?.host || req?.get?.('host') || '')
    .split(':')[0]
    .toLowerCase();
  return host === AVENTURE_HOST || host.startsWith('aventure.');
}

function offerToProductId(offer) {
  const raw = String(offer || '')
    .trim()
    .toLowerCase();
  if (raw === '259' || raw === 'offre-saison' || raw === 'saison') return 'offre-saison';
  return 'offre-duo';
}

function inscriptionUrl({ productId, firstName, lastName, birthdate, boutiqueBase }) {
  const base = String(boutiqueBase || 'https://boutique.boxingcenter.fr').replace(/\/$/, '');
  const params = new URLSearchParams({
    product: productId,
    source: BALMA_SOURCE,
    prenom: firstName || '',
    nom: lastName || '',
  });
  if (birthdate) params.set('birthdate', birthdate);
  return `${base}/inscription?${params.toString()}`;
}

function normalizeBirthdate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const fr = raw.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (fr) {
    const d = fr[1].padStart(2, '0');
    const m = fr[2].padStart(2, '0');
    return `${fr[3]}-${m}-${d}`;
  }
  return raw;
}

function validateBirthdate(value) {
  const raw = normalizeBirthdate(value);
  if (!raw) return 'Date de naissance requise';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'Date de naissance invalide';
  const [y, m, d] = raw.split('-').map(Number);
  if (y < 1900 || y > new Date().getFullYear()) return 'Année de naissance invalide';
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return 'Date de naissance invalide';
  }
  if (dt > new Date()) return 'Date de naissance invalide';
  return null;
}

function validateBalmaSwitchPayload(body = {}) {
  const errors = [];
  const first_name = String(body.first_name || body.prenom || '').trim();
  const last_name = String(body.last_name || body.nom || '').trim();
  const birthdate = normalizeBirthdate(body.birthdate || body.naissance || body.date_naissance);
  const prelevement =
    body.prelevement === true ||
    body.prelevement === '1' ||
    body.prelevement === 'on' ||
    body.prelevement === 'true';
  const offer = offerToProductId(body.offer || body.offre || body.product);

  if (!first_name) errors.push('Prénom requis');
  if (!last_name) errors.push('Nom requis');
  const birthErr = validateBirthdate(birthdate);
  if (birthErr) errors.push(birthErr);
  if (!prelevement) {
    errors.push(
      `Cette page est réservée aux adhérents en prélèvement. Si tu es en paiement comptant, contacte le club : ${CLUB_CONTACT}`
    );
  }
  if (offer !== 'offre-duo' && offer !== 'offre-saison') {
    errors.push('Choisis l’offre 29 € ou 259 €');
  }
  return { errors, first_name, last_name, birthdate, prelevement, offer };
}

function buildBalmaSwitchOrder({ first_name, last_name, birthdate, offer }) {
  const stamp = Date.now();
  return {
    order_id: `BALMA-${stamp}`,
    action: 'balma_switch',
    gym: 'minimes',
    source: BALMA_SOURCE,
    offer,
    product_id: offer,
    customer: {
      first_name,
      last_name,
      birthdate: birthdate || '',
    },
    payment: { status: 'pending', amount: 0 },
  };
}

module.exports = {
  BALMA_SOURCE,
  AVENTURE_HOST,
  AVENTURE_PATH,
  CLUB_CONTACT,
  COUR_DES_MIRACLES_EMAIL,
  isBalmaRetourSource,
  isBalmaRetourOrder,
  isOffre29Product,
  isOffre259Product,
  shouldGiftBadgeComptant,
  balmaBadgePaymentFields,
  isBalmaAutomigrateOnSaleEnabled,
  isAventureHost,
  offerToProductId,
  inscriptionUrl,
  validateBalmaSwitchPayload,
  buildBalmaSwitchOrder,
};
