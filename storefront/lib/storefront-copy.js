/** Textes légaux / information client — boutique Boxing Center */

const BADGE_FEE_AMOUNT = '34,99 €';

const BADGE_FEE_NOTICE =
  `En souscrivant un abonnement, votre badge d'accès (${BADGE_FEE_AMOUNT}) est prélevé automatiquement quelques jours après l'inscription. Le montant payé aujourd'hui par carte correspond à votre première échéance.`;

/** Retiré de la boutique — ne doit plus être vendu en ligne (Deciplus peut encore l’avoir en grille). */
const BANNED_STOREFRONT_PRODUCT_IDS = new Set([
  'offre-duo', 'offre-saison', 'offre-29', 'offre-259', 'offre_29', 'offre_259', 'offre-12mois', 'dp-104', 'dp-100',
  'offre-promo-9',
  'dp-101',
  'offre-promo-adulte',
  'dp-102',
  'offre-promo-etudiant',
  'dp-103',
]);

const BANNED_STOREFRONT_NAME_PATTERNS = [
  /offre\s*(?:a|duo)?\s*29(?:[,.]99)?\s*€/i,
  /offre\s*promo\s*12\s*mois/i,
  /offre\s*promo\s*9\s*€/i,
  /offre\s*promo\s*38[,.]99/i,
  /offre\s*promo\s*34[,.]99/i,
];

const BANNED_DECIPLUS_IDS = new Set([100, 101, 102, 103, 104]);

function isBannedStorefrontProduct(product) {
  if (!product) return false;
  const id = String(product.id || '').trim().toLowerCase();
  const legacy = String(product.legacy_id || '').trim().toLowerCase();
  if (BANNED_STOREFRONT_PRODUCT_IDS.has(id) || BANNED_STOREFRONT_PRODUCT_IDS.has(legacy)) {
    return true;
  }
  const name = String(product.name || product.title || product.display_name || '').trim();
  if (BANNED_STOREFRONT_NAME_PATTERNS.some((re) => re.test(name))) return true;
  const deciplusId = Number(product.deciplus_id);
  if (BANNED_DECIPLUS_IDS.has(deciplusId)) return true;
  return false;
}

function isStorefrontProduct(product) {
  if (!product) return false;
  if (isBannedStorefrontProduct(product)) return false;
  const name = String(product.name || product.title || '').trim();
  const type = product.type || product.categoryId || '';
  if (product.id === 'badge') return false;
  if (product.id === 'seance-essai' || product.manual) return true;
  if (type === 'decipass' || /decipass/i.test(String(product.category || ''))) return false;
  if (/^badge$/i.test(name)) return false;
  if (/essai/i.test(name) && product.price_cents === 0 && product.requires_payment === false) return false;
  return true;
}

function shouldShowBadgeFeeNotice(product) {
  if (!product?.requires_iban) return false;
  if (product.sale_type === 'abonnement') return true;
  return String(product.category || '').toLowerCase().includes('abonnement');
}

function getBadgeFeeNotice(product) {
  if (!shouldShowBadgeFeeNotice(product)) return null;
  return product.badge_fee_notice || BADGE_FEE_NOTICE;
}

module.exports = {
  BADGE_FEE_AMOUNT,
  BADGE_FEE_NOTICE,
  isBannedStorefrontProduct,
  isStorefrontProduct,
  shouldShowBadgeFeeNotice,
  getBadgeFeeNotice,
};
