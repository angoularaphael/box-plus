'use strict';

/**
 * CAWL ecommerce (Worldline Direct) — Hosted Checkout.
 * Portet uniquement : remplace PayPal pour comptant, 1ʳᵉ échéance abo, 4× Oney.
 *
 * Live  : https://payment.cawl-solutions.fr
 * Test  : https://payment.preprod.cawl-solutions.fr
 * Auth  : GCS v1HMAC (HMAC-SHA256)
 */

const crypto = require('crypto');
const { paymentVar, useTestPayments } = require('./test-env');
const { PRODUCTION_STORE_URL } = require('../../lib/app-urls');

const ONEY_4X_PRODUCT_ID = 5112;
/** Limite CAWL preprod observée (~200 car.) sur hostedCheckoutSpecificInput.returnUrl */
const CAWL_RETURN_URL_MAX_LEN = 200;

function normalizeCawlReturnBase(baseUrl) {
  let url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) url = PRODUCTION_STORE_URL;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
    return PRODUCTION_STORE_URL;
  }
  if (url.startsWith('http://')) {
    url = `https://${url.slice(7)}`;
  }
  return url;
}

/**
 * URL de retour Hosted Checkout — courte (pas de bc_token dupliqué), ≤ 200 car.
 * Le token est récupéré côté navigateur via localStorage / cookie de reprise.
 */
function buildCawlReturnUrl({
  baseUrl,
  path = '/inscription',
  orderId = '',
  accessToken = '',
  step = null,
} = {}) {
  const base = normalizeCawlReturnBase(baseUrl);
  const route = String(path || '/inscription').startsWith('/') ? path : `/${path}`;
  const oid = String(orderId || '').trim();
  const tok = String(accessToken || '').trim();
  const candidates = [];
  if (oid && tok) {
    const withStep = `${base}${route}?order=${encodeURIComponent(oid)}&token=${encodeURIComponent(tok)}&cawl_return=1&step=${encodeURIComponent(step ?? 4)}`;
    const noStep = `${base}${route}?order=${encodeURIComponent(oid)}&token=${encodeURIComponent(tok)}&cawl_return=1`;
    candidates.push(withStep, noStep);
  }
  if (oid) {
    candidates.push(`${base}${route}?order=${encodeURIComponent(oid)}&cawl_return=1`);
  }
  candidates.push(`${base}${route}?cawl_return=1`, `${base}${route}`);
  for (const url of candidates) {
    if (url.length <= CAWL_RETURN_URL_MAX_LEN) return url;
  }
  return candidates[candidates.length - 1];
}

function cawlMode() {
  const mode = String(paymentVar('CAWL_MODE') || (!useTestPayments() && process.env.CAWL_MODE) || 'live').toLowerCase();
  if (mode === 'test' || mode === 'preprod' || mode === 'sandbox') return 'test';
  if (useTestPayments() && paymentVar('CAWL_MERCHANT_ID')) return 'test';
  return 'live';
}

function apiHost() {
  return cawlMode() === 'test' ? 'payment.preprod.cawl-solutions.fr' : 'payment.cawl-solutions.fr';
}

function apiBase() {
  return `https://${apiHost()}`;
}

function credentials() {
  return {
    merchantId: String(paymentVar('CAWL_MERCHANT_ID') || '').trim(),
    apiKeyId: String(paymentVar('CAWL_API_KEY_ID') || '').trim(),
    apiSecret: String(paymentVar('CAWL_API_SECRET') || '').trim(),
  };
}

function isCawlEnabled() {
  const { merchantId, apiKeyId, apiSecret } = credentials();
  return Boolean(merchantId && apiKeyId && apiSecret);
}

function rfc1123Date(date = new Date()) {
  return date.toUTCString();
}

function merchantReference(id) {
  const raw = String(id || '')
    .replace(/[^0-9A-Za-z_-]/g, '')
    .slice(0, 30);
  return raw || `BC${Date.now()}`.slice(0, 30);
}

function hmacSignature(secret, subject) {
  return crypto.createHmac('sha256', secret).update(subject, 'utf8').digest('base64');
}

function buildSignatureSubject(method, contentType, date, resourcePath) {
  return `${method}\n${contentType}\n${date}\n${resourcePath}\n`;
}

function authorizationHeader(method, contentType, date, resourcePath, apiKeyId, apiSecret) {
  const subject = buildSignatureSubject(method, contentType, date, resourcePath);
  const signature = hmacSignature(apiSecret, subject);
  return `GCS v1HMAC:${apiKeyId}:${signature}`;
}

function phoneE164(value) {
  const raw = String(value || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^[67]\d{8}$/.test(digits)) digits = `0${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+33${digits.slice(1)}`;
  if (/^33\d{9}$/.test(digits)) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return undefined;
}

function isFrenchMobileE164(value) {
  return /^\+33[67]\d{8}$/.test(String(value || ''));
}

function birthdateCompact(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const fr = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (fr) return `${fr[3]}${fr[2]}${fr[1]}`;
  if (/^\d{8}$/.test(raw)) return raw;
  return undefined;
}

function customerFromOrder(order, overrides = {}) {
  const customer = {
    ...(order?.customer_full || {}),
    ...(order?.customer_short || {}),
    ...(order?.customer || {}),
    ...overrides,
  };
  const genderRaw = String(customer.gender || '').toUpperCase();
  const female = genderRaw === 'F' || genderRaw === 'FEMALE';
  const male = genderRaw === 'M' || genderRaw === 'MALE';
  const street = String(customer.address || customer.address1 || customer.street || '').trim();
  const zip = String(customer.postal_code || customer.postcode || customer.zip || '').replace(/\s+/g, '');
  const city = String(customer.city || '').trim();
  const email = String(customer.email || '').trim();
  const phone = phoneE164(customer.phone || customer.mobile_phone_number);
  const dob = birthdateCompact(customer.birthdate || customer.dateOfBirth);
  const personalInformation = {
    name: {
      firstName: String(customer.first_name || customer.firstName || 'Client').slice(0, 50),
      surname: String(customer.last_name || customer.surname || 'Boxing').slice(0, 50),
    },
  };
  if (female || male) {
    personalInformation.gender = female ? 'female' : 'male';
    personalInformation.name.title = female ? 'Mrs.' : 'Mr.';
  }
  if (dob) personalInformation.dateOfBirth = dob;

  const billingAddress = {
    countryCode: 'FR',
  };
  if (street) billingAddress.street = street.slice(0, 50);
  if (zip) billingAddress.zip = zip.slice(0, 10);
  if (city) billingAddress.city = city.slice(0, 40);

  const contactDetails = {};
  if (email && email.includes('@')) contactDetails.emailAddress = email.slice(0, 70);
  if (phone) contactDetails.phoneNumber = phone;

  return {
    personalInformation,
    billingAddress,
    shippingAddress: { ...billingAddress },
    contactDetails,
    locale: 'fr_FR',
  };
}

function validateOneyCustomer(customer) {
  const missing = [];
  const name = customer?.personalInformation?.name || {};
  if (!name.firstName || name.firstName === 'Client') missing.push('prénom');
  if (!name.surname || name.surname === 'Boxing') missing.push('nom');
  if (!customer?.contactDetails?.emailAddress) missing.push('email');
  if (!customer?.personalInformation?.gender) missing.push('civilité');
  if (!isFrenchMobileE164(customer?.contactDetails?.phoneNumber)) {
    missing.push('téléphone mobile FR (06/07…)');
  }
  if (!customer?.billingAddress?.street) missing.push('adresse');
  if (!/^\d{5}$/.test(String(customer?.billingAddress?.zip || ''))) missing.push('code postal (5 chiffres)');
  if (!customer?.billingAddress?.city) missing.push('ville');
  return missing;
}

function formatCawlError(err) {
  const body = err?.body || {};
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const first = errors[0] || {};
  const parts = errors.map((e) => e.message || e.code).filter(Boolean);
  const raw = String(err?.message || first.message || parts[0] || body.message || '');
  const code = String(first.code || first.id || '');
  const property = String(first.propertyName || '');
  if (/ONEY|5112|5110|payment product/i.test(raw) || parts.some((p) => /oney|5112/i.test(p))) {
    return (
      'Le 4× sans frais (Oney) n’est pas encore actif sur le compte CAWL Portet. ' +
      'Dans le portail test (preprod), Affaires → Méthodes de paiement → activez Oney 4×, ou payez en une fois par carte.'
    );
  }
  if (
    code === '9007' ||
    /ACCESS_TO_MERCHANT_NOT_ALLOWED/i.test(raw) ||
    /ACCESS_TO_MERCHANT_NOT_ALLOWED/i.test(String(first.id || ''))
  ) {
    if (cawlMode() === 'test') {
      return (
        'CAWL test refuse ces clés (PSPID preprod). Dans le portail CAWL en mode Test : ' +
        'Développeur → API de paiement, recopiez PSPID + Key ID + secret dans CAWL_TEST_* . ' +
        'Les clés LIVE ne marchent pas sur preprod.'
      );
    }
    return (
      'CAWL live refuse ces clés API. Ouvrez le portail CAWL en mode LIVE (pas Test) → ' +
      'Développeur → API de paiement, recréez la clé, puis mettez à jour CAWL_API_KEY_ID et ' +
      'CAWL_API_SECRET sur Vercel. Pour tester le 4× sans toucher au live : /dev (studio).'
    );
  }
  if (/AUTHORIZATION|HMAC|NOT_AUTHORIZED|401/i.test(raw)) {
    return 'CAWL Portet est mal configuré (clé API). Vérifiez PSPID, API Key ID et secret.';
  }
  if (code === '1008' || /INVALID_VALUE/i.test(String(first.id || ''))) {
    if (/returnUrl/i.test(property)) {
      return 'URL de retour CAWL trop longue ou invalide. Réessayez : le paiement rouvre la boutique automatiquement.';
    }
    if (/merchantId|merchant/i.test(property) || /BoxingCenterTEST|CA131066056934/i.test(raw)) {
      return 'CAWL test : le PSPID ne correspond pas à l’environnement preprod. Utilisez le compte test, pas le PSPID live.';
    }
    return property
      ? `CAWL a refusé le champ « ${property} ». Vérifiez la configuration du compte test.`
      : 'CAWL a refusé la demande (code 1008). Vérifiez PSPID, clés API et méthodes de paiement actives.';
  }
  const httpBit = err?.status ? `CAWL HTTP ${err.status}` : null;
  return [raw && !/^CAWL HTTP /i.test(raw) ? raw : httpBit, parts.filter((p) => p !== raw).join(' ; ')]
    .filter(Boolean)
    .join(' — ') || 'Erreur CAWL';
}

async function cawlRequest(method, resourcePath, body = null) {
  const { merchantId, apiKeyId, apiSecret } = credentials();
  if (!merchantId || !apiKeyId || !apiSecret) {
    throw new Error('CAWL_MERCHANT_ID / CAWL_API_KEY_ID / CAWL_API_SECRET manquants');
  }
  const date = rfc1123Date();
  const hasBody = body != null && method !== 'GET' && method !== 'DELETE';
  const contentType = hasBody ? 'application/json' : '';
  const headers = {
    Date: date,
    Accept: 'application/json',
    Authorization: authorizationHeader(method, contentType, date, resourcePath, apiKeyId, apiSecret),
  };
  if (hasBody) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${apiBase()}${resourcePath}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const msg =
      data.errors?.[0]?.message ||
      data.message ||
      data.errorId ||
      `CAWL HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function hostedPayment(session) {
  return session?.createdPaymentOutput?.payment || null;
}

function isCawlPaid(session) {
  const category = String(session?.createdPaymentOutput?.paymentStatusCategory || '').toUpperCase();
  if (category === 'SUCCESSFUL') return true;
  const status = String(hostedPayment(session)?.status || '').toUpperCase();
  if (['CAPTURED', 'PAID', 'ACCOUNT_VERIFIED'].includes(status)) return true;
  const code = Number(hostedPayment(session)?.statusOutput?.statusCode || 0);
  return code === 9 || code === 5;
}

function isCawlCancelled(session) {
  const status = String(session?.status || '').toUpperCase();
  return status === 'CANCELLED_BY_CONSUMER' || status === 'CANCELLED';
}

function cawlPaidCents(session) {
  const amount = hostedPayment(session)?.paymentOutput?.amountOfMoney?.amount;
  if (amount == null || amount === '') return null;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}

function cawlMerchantReference(session) {
  return String(
    hostedPayment(session)?.paymentOutput?.references?.merchantReference ||
      session?.merchantReference ||
      ''
  ).trim();
}

function cawlPaymentId(session) {
  return String(hostedPayment(session)?.id || '').trim();
}

function splitStreet(street) {
  const raw = String(street || '').trim();
  const m = raw.match(/^(\d+\s*(?:bis|ter|quater)?)\s+(.+)$/i);
  if (m) return { houseNumber: m[1].slice(0, 15), street: m[2].slice(0, 50) };
  return { street: raw.slice(0, 50) };
}

function withHouseNumber(address) {
  if (!address?.street) return address;
  const split = splitStreet(address.street);
  return { ...address, ...split };
}

function buildHostedCheckoutPayload({
  order,
  product,
  amountCents,
  returnUrl,
  paymentPlan = 'once',
  description = null,
  customerOverrides = {},
  metadata = {},
}) {
  const amount = Number(amountCents || product?.price_cents || 0);
  if (!amount) throw new Error('Montant CAWL invalide');
  const itemName = String(
    description || product?.display_name || product?.name || 'Boxing Center Portet'
  ).slice(0, 50);
  const ref = merchantReference(order?.order_id || metadata.order_id || metadata.merchantReference);
  const customer = customerFromOrder(order, customerOverrides);
  customer.billingAddress = withHouseNumber(customer.billingAddress);
  customer.shippingAddress = withHouseNumber(customer.shippingAddress || customer.billingAddress);

  const hostedCheckoutSpecificInput = {
    returnUrl,
    locale: 'fr_FR',
    showResultPage: false,
  };

  const payload = {
    order: {
      amountOfMoney: {
        currencyCode: 'EUR',
        amount,
      },
      customer,
      references: {
        merchantReference: ref,
      },
      shoppingCart: {
        items: [
          {
            amountOfMoney: { currencyCode: 'EUR', amount },
            invoiceData: { description: itemName },
            orderLineDetails: {
              productName: itemName,
              productCode: String(product?.id || metadata.product_id || 'portet').slice(0, 12),
              productPrice: amount,
              quantity: 1,
              lineAmountTotal: amount,
              productType: 'service',
            },
          },
        ],
      },
    },
    hostedCheckoutSpecificInput,
  };

  if (paymentPlan === '4x') {
    // Forcer Oney 4× (5112). Sans ça, CAWL ouvre la page carte 1× du montant total.
    hostedCheckoutSpecificInput.paymentProductFilters = {
      restrictTo: { products: [ONEY_4X_PRODUCT_ID] },
    };
    payload.redirectPaymentMethodSpecificInput = {
      requiresApproval: false,
      paymentProductId: ONEY_4X_PRODUCT_ID,
    };
    const option = String(paymentVar('CAWL_ONEY_4X_PAYMENT_OPTION') || '').trim();
    if (option) payload.redirectPaymentMethodSpecificInput.paymentOption = option;
  } else {
    hostedCheckoutSpecificInput.cardPaymentMethodSpecificInput = {
      groupCards: true,
      authorizationMode: 'SALE',
    };
  }

  return payload;
}

async function createHostedCheckout({
  order,
  product,
  amountCents,
  baseUrl,
  paymentPlan = 'once',
  description = null,
  metadata = {},
  returnUrl = null,
  cancelUrl = null,
  customerOverrides = {},
}) {
  const { merchantId } = credentials();
  const resolvedReturn =
    returnUrl ||
    buildCawlReturnUrl({
      baseUrl,
      orderId: order?.order_id || metadata.order_id,
      accessToken: order?.access_token,
      step: 4,
    });
  void cancelUrl;

  if (paymentPlan === '4x') {
    const customer = customerFromOrder(order, customerOverrides);
    const missing = validateOneyCustomer(customer);
    if (missing.length) {
      const err = new Error(`Infos manquantes pour le 4× CAWL : ${missing.join(', ')}`);
      err.code = 'cawl_customer_incomplete';
      err.missing = missing;
      throw err;
    }
  }

  const payload = buildHostedCheckoutPayload({
    order,
    product,
    amountCents,
    returnUrl: resolvedReturn,
    paymentPlan,
    description,
    customerOverrides,
    metadata,
  });

  // Ne jamais retomber sur la page carte 1× si le client a choisi 4×.
  const created = await cawlRequest('POST', `/v2/${merchantId}/hostedcheckouts`, payload);

  const redirectUrl = created.redirectUrl
    ? created.redirectUrl
    : created.partialRedirectUrl
      ? `https://${created.partialRedirectUrl.replace(/^https?:\/\//, '')}`
      : null;

  return {
    id: created.hostedCheckoutId,
    hostedCheckoutId: created.hostedCheckoutId,
    returnMac: created.RETURNMAC || created.returnMac,
    redirectUrl,
    merchantReference: created.merchantReference || payload.order.references.merchantReference,
    raw: created,
    payment_plan: paymentPlan,
  };
}

async function getHostedCheckout(hostedCheckoutId) {
  const { merchantId } = credentials();
  const id = String(hostedCheckoutId || '').trim();
  if (!id) throw new Error('hostedCheckoutId manquant');
  return cawlRequest('GET', `/v2/${merchantId}/hostedcheckouts/${encodeURIComponent(id)}`);
}

async function getPayment(paymentId) {
  const { merchantId } = credentials();
  const id = String(paymentId || '').trim();
  if (!id) throw new Error('paymentId manquant');
  return cawlRequest('GET', `/v2/${merchantId}/payments/${encodeURIComponent(id)}`);
}

module.exports = {
  ONEY_4X_PRODUCT_ID,
  isCawlEnabled,
  cawlMode,
  apiHost,
  apiBase,
  credentials,
  merchantReference,
  buildSignatureSubject,
  hmacSignature,
  authorizationHeader,
  rfc1123Date,
  customerFromOrder,
  validateOneyCustomer,
  formatCawlError,
  buildCawlReturnUrl,
  normalizeCawlReturnBase,
  CAWL_RETURN_URL_MAX_LEN,
  createHostedCheckout,
  buildHostedCheckoutPayload,
  getHostedCheckout,
  getPayment,
  isCawlPaid,
  isCawlCancelled,
  cawlPaidCents,
  cawlMerchantReference,
  cawlPaymentId,
  hostedPayment,
  phoneE164,
};
