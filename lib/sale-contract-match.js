'use strict';

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function productNeedles(product = {}) {
  return [
    product.deciplus_product_name,
    product.deciplus_product_search,
    product.label,
    product.name,
    product.title,
    product.display_name,
  ]
    .filter(Boolean)
    .map(normalizeLabel);
}

function isAnnualPromoProduct(product = {}) {
  const hay = productNeedles(product).join(' ');
  return /offre promo|12\s*mois|12mois|\b259\b/.test(hay);
}

function isMonthlyFlexProduct(product = {}) {
  const hay = productNeedles(product).join(' ');
  return /44,?99|4 semaines|sans engagement/.test(hay) && !isAnnualPromoProduct(product);
}

/**
 * Un contrat Deciplus déjà présent (ex. 44,99 € / 4 semaines) ne doit pas
 * valider une vente 259 € / 12 mois — et inversement.
 */
function saleContractMatches(contractLabel, product = {}) {
  const label = normalizeLabel(contractLabel);
  if (!label) return false;
  if (/resilie|annule|termine|inactif|clotur/.test(label)) return false;

  if (isAnnualPromoProduct(product)) {
    if (/44,?99|4 semaines|sans engagement/.test(label) && !/12\s*mois|12mois|offre promo|\b259\b/.test(label)) {
      return false;
    }
    return /offre promo|12\s*mois|12mois|\b259\b/.test(label);
  }

  if (isMonthlyFlexProduct(product)) {
    return /44,?99|4 semaines|sans engagement/.test(label);
  }

  const needles = productNeedles(product).filter((n) => n.length >= 6);
  if (!needles.length) return !/\bbadge\b/.test(label);
  return needles.some((n) => label.includes(n.slice(0, Math.min(18, n.length))));
}

module.exports = {
  normalizeLabel,
  saleContractMatches,
  isAnnualPromoProduct,
  isMonthlyFlexProduct,
};
