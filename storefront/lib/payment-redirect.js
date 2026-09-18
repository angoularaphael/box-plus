'use strict';

/**
 * Redirection sécurisée vers l’URL hosted PayPlug (Scalapay / CB).
 * Safari iOS laisse souvent une page blanche sur les enchaînements
 * boutique → PayPlug → portal.scalapay.com ; une page intermédiaire
 * same-origin + soumission de formulaire corrige ce cas.
 */

const ALLOWED_HOSTS = new Set(['secure.payplug.com', 'payplug.com']);

function isAllowedPayplugPaymentUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:') return false;
    if (!ALLOWED_HOSTS.has(u.hostname)) return false;
    // /pay/{id} ou /pay/test/{id}
    if (!/^\/pay(\/test)?\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function isPayplugTestPaymentUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.pathname.includes('/pay/test/');
  } catch {
    return false;
  }
}

/**
 * @param {string} baseUrl ex. https://boutique.boxingcenter.fr
 * @param {string} paymentUrl hosted_payment.payment_url PayPlug
 * @param {{ cancelUrl?: string, kind?: string }} [opts]
 */
function buildPaymentRedirectUrl(baseUrl, paymentUrl, opts = {}) {
  if (!isAllowedPayplugPaymentUrl(paymentUrl)) return paymentUrl || null;
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return paymentUrl;
  const q = new URLSearchParams();
  q.set('u', paymentUrl);
  if (opts.cancelUrl) q.set('c', String(opts.cancelUrl));
  if (opts.kind) q.set('k', String(opts.kind).slice(0, 24));
  return `${base}/paiement-redirect.html?${q.toString()}`;
}

module.exports = {
  isAllowedPayplugPaymentUrl,
  isPayplugTestPaymentUrl,
  buildPaymentRedirectUrl,
};
