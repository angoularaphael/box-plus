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

const ONEY_4X_PRODUCT_ID = 5112;

function cawlMode() {
  if (useTestPayments()) return 'test';
  const mode = String(paymentVar('CAWL_MODE') || process.env.CAWL_MODE || 'live').toLowerCase();
  if (mode === 'test' || mode === 'preprod' || mode === 'sandbox') return 'test';
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
  const parts = Array.isArray(body.errors)
    ? body.errors.map((e) => e.message || e.code).filter(Boolean)
    : [];
  const raw = String(err?.message || parts[0] || body.message || '');
  if (/ONEY|5112|5110|payment product/i.test(raw) || parts.some((p) => /oney|5112/i.test(p))) {
    return (
      'Le 4× sans frais (Oney) n’est pas encore actif sur le compte CAWL Portet. ' +
      'Dans le portail CAWL, activez Oney 4×, ou payez en une fois par carte.'
    );
  }
  if (/AUTHORIZATION|HMAC|NOT_AUTHORIZED|401/i.test(raw)) {
    return 'CAWL Portet est mal configuré (clé API). Vérifiez PSPID, API Key ID et secret.';
  }
  return [raw || null, parts.filter((p) => p !== raw).join(' ; ')].filter(Boolean).join(' — ') || 'Erreur CAWL';
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
              productType: 'Service',
            },
          },
        ],
      },
    },
    hostedCheckoutSpecificInput: {
      returnUrl,
      locale: 'fr_FR',
      showResultPage: false,
      cardPaymentMethodSpecificInput: {
        groupCards: true,
        authorizationMode: 'SALE',
      },
    },
  };

  if (paymentPlan === '4x') {
    payload.redirectPaymentMethodSpecificInput = {
      requiresApproval: false,
      paymentProductId: ONEY_4X_PRODUCT_ID,
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
  const returnBase = order?.access_token
    ? `${baseUrl}/inscription?order=${encodeURIComponent(order.order_id)}&token=${encodeURIComponent(order.access_token)}&bc_token=${encodeURIComponent(order.access_token)}`
    : `${baseUrl}/`;
  const resolvedReturn =
    returnUrl || `${returnBase}${returnBase.includes('?') ? '&' : '?'}step=4&cawl_return=1`;
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

  let created;
  try {
    created = await cawlRequest('POST', `/v2/${merchantId}/hostedcheckouts`, payload);
  } catch (err) {
    if (paymentPlan === '4x' && payload.redirectPaymentMethodSpecificInput) {
      delete payload.redirectPaymentMethodSpecificInput;
      created = await cawlRequest('POST', `/v2/${merchantId}/hostedcheckouts`, payload);
    } else {
      throw err;
    }
  }

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
  createHostedCheckout,
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
