'use strict';

const API_BASE = 'https://api.payplug.com/v1';
const API_VERSION = process.env.PAYPLUG_API_VERSION || '2019-08-06';

const { paymentVar, useTestPayments, runPaymentContext } = require('./test-env');

/** Message visiteur tant que PayPlug LIVE n’a pas activé Oney 4× sans frais. */
const ONEY_4X_UNAVAILABLE_MESSAGE =
  'Le 4× sans frais par carte est momentanément indisponible. Vous pouvez payer en 4× via PayPal, ou régler en une fois par carte ou PayPal.';

const SCALAPAY_UNAVAILABLE_MESSAGE =
  'Le paiement CB en plusieurs fois n’est pas disponible pour le moment. Vous pouvez régler par carte en une fois.';

const SCALAPAY_FEES_HINT =
  'CB en plusieurs fois : 3× sans frais pour vous, ou 4× avec 1,5 % de frais (à votre charge).';

const SCALAPAY_REFUSAL_HELP =
  'Si le paiement CB en plusieurs fois refuse votre carte, écrivez à boxingcenter31@gmail.com en expliquant votre situation : nous allons vous proposer une solution de paiement alternative.';

/** Bornes officielles PayPlug / Scalapay (centimes). */
const SCALAPAY_MIN_CENTS = 500;
const SCALAPAY_MAX_CENTS = 200000;

/**
 * 4× Oney live : off tant que PayPlug n’a pas ouvert l’option sur le compte.
 * PAYPLUG_ONEY_4X_ENABLED=1 pour le réactiver. Le studio (/dev) reste testable.
 */
function isOney4xEnabled() {
  const flag = String(process.env.PAYPLUG_ONEY_4X_ENABLED || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * Scalapay via PayPlug API (`payment_method: "scalapay"`).
 * Offre marchande + API test validées : activé par défaut.
 * Désactiver avec PAYPLUG_SCALAPAY_ENABLED=0. Forcer ON avec =1.
 * Ne s’affiche PAS tout seul sur la page CB hosted — paramètre API obligatoire.
 */
function isScalapayEnabled() {
  const flag = String(process.env.PAYPLUG_SCALAPAY_ENABLED || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return true;
}

function isAmountEligibleForScalapay(amountCents) {
  const n = Number(amountCents);
  return Number.isFinite(n) && n >= SCALAPAY_MIN_CENTS && n <= SCALAPAY_MAX_CENTS;
}

function isPayplugEnabled() {
  return Boolean(paymentVar('PAYPLUG_SECRET_KEY'));
}

function headers() {
  const key = paymentVar('PAYPLUG_SECRET_KEY');
  if (!key) throw new Error('PAYPLUG_SECRET_KEY manquante');
  return {
    Authorization: `Bearer ${key}`,
    'PayPlug-Version': API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function phoneE164(value) {
  const raw = String(value || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  // 0033… → 33…
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Mobile FR saisi sans le 0 : 6XXXXXXXX / 7XXXXXXXX
  if (/^[67]\d{8}$/.test(digits)) digits = `0${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+33${digits.slice(1)}`;
  if (/^33\d{9}$/.test(digits)) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return undefined;
}

/** Mobile FR requis pour Oney (+336… / +337…). */
function isFrenchMobileE164(value) {
  return /^\+33[67]\d{8}$/.test(String(value || ''));
}

function customerDetails(order, overrides = {}) {
  const customer = {
    ...(order.customer_full || {}),
    ...(order.customer_short || {}),
    ...(order.customer || {}),
    ...overrides,
  };
  const genderRaw = String(customer.gender || '').toUpperCase();
  const title = genderRaw === 'F' ? 'mrs' : genderRaw === 'M' ? 'mr' : '';
  const common = {
    first_name: customer.first_name || '',
    last_name: customer.last_name || '',
    email: customer.email || '',
    address1: customer.address || customer.address1 || '',
    postcode: String(customer.postal_code || customer.postcode || '').replace(/\s+/g, ''),
    city: customer.city || '',
    country: 'FR',
    language: 'fr',
  };
  if (title) common.title = title;
  const mobile = phoneE164(customer.phone);
  if (mobile) common.mobile_phone_number = mobile;
  return common;
}

function validateOneyCustomer(details) {
  const missing = [];
  if (!details.first_name) missing.push('prénom');
  if (!details.last_name) missing.push('nom');
  if (!details.email) missing.push('email');
  if (!details.title) missing.push('civilité');
  if (!details.mobile_phone_number || !isFrenchMobileE164(details.mobile_phone_number)) {
    missing.push('téléphone mobile FR (06/07…)');
  }
  if (!details.address1) missing.push('adresse');
  if (!/^\d{5}$/.test(String(details.postcode || ''))) missing.push('code postal (5 chiffres)');
  if (!details.city) missing.push('ville');
  return missing;
}

function formatPayplugError(err) {
  const body = err?.body || {};
  const raw = String(err?.message || body.message || body.error || '');
  if (/access to this feature is not available|can'?t use this feature|cannot use this feature/i.test(raw)) {
    if (/scalapay/i.test(JSON.stringify(body)) || /scalapay/i.test(raw)) {
      return SCALAPAY_UNAVAILABLE_MESSAGE;
    }
    return (
      'Le 4× carte (Oney) n’est pas activé sur le compte PayPlug. ' +
      'Dans le portail PayPlug, demandez l’activation du paiement fractionné 4× sans frais, puis réessayez. ' +
      'En attendant, payez en une fois ou via PayPal.'
    );
  }
  const details = Array.isArray(body.details)
    ? body.details
        .map((d) => d.message || d.field || d.description)
        .filter(Boolean)
        .join(' ; ')
    : '';
  return [raw || null, details].filter(Boolean).join(' — ');
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const details = Array.isArray(body.details)
      ? body.details.map((d) => d.message || d.field).filter(Boolean).join(' ; ')
      : '';
    const message =
      [body.message || body.error || `Payplug HTTP ${response.status}`, details]
        .filter(Boolean)
        .join(' — ') || `Payplug HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function buildReturnUrls(baseUrl, order, { step = 4 } = {}) {
  if (order?.order_id && order?.access_token) {
    const returnBase = `${baseUrl}/inscription?order=${encodeURIComponent(order.order_id)}&token=${encodeURIComponent(order.access_token)}&bc_token=${encodeURIComponent(order.access_token)}`;
    return {
      return_url: `${returnBase}&step=${step}&payplug_return=1`,
      cancel_url: `${returnBase}&step=${step}&cancelled=1`,
    };
  }
  return {
    return_url: `${baseUrl}/`,
    cancel_url: `${baseUrl}/`,
  };
}

async function createFourTimesPayment({
  order,
  product,
  baseUrl,
  customerOverrides = {},
  returnUrl = null,
  cancelUrl = null,
  metadata = {},
}) {
  const customer = customerDetails(order, customerOverrides);
  const missing = validateOneyCustomer(customer);
  if (missing.length) {
    const err = new Error(`Infos manquantes pour le 4× PayPlug : ${missing.join(', ')}`);
    err.code = 'payplug_customer_incomplete';
    err.missing = missing;
    throw err;
  }

  const itemName = product.display_name || product.name || 'OFFRE PROMO 12 MOIS';
  const amount = Number(product.price_cents);
  const urls =
    returnUrl && cancelUrl
      ? { return_url: returnUrl, cancel_url: cancelUrl }
      : buildReturnUrls(baseUrl, order);
  // Accès club = retrait en salle (Oney n’accepte plus delivery_type "digital")
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 1);
  const expectedDelivery = deliveryDate.toISOString().slice(0, 10);

  const payload = {
    // Oney = paiement différé uniquement (pas le champ amount)
    authorized_amount: amount,
    auto_capture: true,
    currency: 'EUR',
    payment_method: 'oney_x4_without_fees',
    billing: customer,
    shipping: {
      ...customer,
      delivery_type: 'BILLING',
      company_name: 'Boxing Center',
    },
    payment_context: {
      cart: [
        {
          delivery_label: 'Boxing Center',
          delivery_type: 'storepickup',
          brand: 'Boxing Center',
          merchant_item_id: String(product.id || 'offre-saison'),
          name: String(itemName).slice(0, 80),
          expected_delivery_date: expectedDelivery,
          total_amount: amount,
          price: amount,
          quantity: 1,
        },
      ],
    },
    description: String(itemName).slice(0, 80),
    metadata: {
      order_id: String(order.order_id || ''),
      lifecycle_order_id: String(order.order_id || ''),
      product_id: String(product.id || ''),
      payment_plan: '4x',
      ...(metadata.order_type ? { order_type: String(metadata.order_type).slice(0, 20) } : {}),
    },
    notification_url: `${baseUrl}/api/webhooks/payplug`,
    hosted_payment: urls,
  };
  return request('/payments', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Scalapay (3×/4×) via PayPlug APM — montant total garanti au marchand.
 * Différent d’Oney : champ `amount` (pas `authorized_amount`) + payment_method "scalapay".
 * Le client choisit 3× ou 4× sur la page Scalapay après redirect.
 */
async function createScalapayPayment({
  order = null,
  product = null,
  items = null,
  baseUrl,
  amountCents,
  description,
  metadata = {},
  customerOverrides = {},
  returnUrl = null,
  cancelUrl = null,
}) {
  const amount = Number(amountCents || product?.price_cents || 0);
  if (!isAmountEligibleForScalapay(amount)) {
    const err = new Error(
      `Le paiement CB en plusieurs fois est disponible entre ${SCALAPAY_MIN_CENTS / 100} € et ${SCALAPAY_MAX_CENTS / 100} €.`
    );
    err.code = 'scalapay_amount_ineligible';
    throw err;
  }

  const customer = order
    ? customerDetails(order, customerOverrides)
    : customerDetails({ customer: customerOverrides }, {});
  const missing = validateOneyCustomer(customer);
  if (missing.length) {
    const err = new Error(`Infos manquantes pour le paiement CB en plusieurs fois : ${missing.join(', ')}`);
    err.code = 'payplug_customer_incomplete';
    err.missing = missing;
    throw err;
  }

  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 1);
  const expectedDelivery = deliveryDate.toISOString().slice(0, 10);

  let cart;
  if (Array.isArray(items) && items.length) {
    cart = items.map((item, idx) => {
      const qty = Math.max(1, Number(item.qty) || 1);
      const unit = Number(item.unit_cents || item.price_cents || 0);
      const lineTotal = Number(item.line_total_cents != null ? item.line_total_cents : unit * qty);
      const label = item.variant_label
        ? `${item.name || 'Article'} (${item.variant_label})`
        : item.name || item.description || `Article ${idx + 1}`;
      return {
        delivery_label: 'Boxing Center',
        delivery_type: 'storepickup',
        brand: 'Boxing Center',
        merchant_item_id: String(item.product_id || item.id || `item-${idx + 1}`).slice(0, 40),
        name: String(label).slice(0, 80),
        expected_delivery_date: expectedDelivery,
        total_amount: lineTotal,
        price: unit,
        quantity: qty,
      };
    });
  } else {
    const itemName =
      description || product?.display_name || product?.name || 'Paiement Boxing Center';
    cart = [
      {
        delivery_label: 'Boxing Center',
        delivery_type: 'storepickup',
        brand: 'Boxing Center',
        merchant_item_id: String(product?.id || metadata.order_id || 'scalapay').slice(0, 40),
        name: String(itemName).slice(0, 80),
        expected_delivery_date: expectedDelivery,
        total_amount: amount,
        price: amount,
        quantity: 1,
      },
    ];
  }

  const itemName =
    description ||
    product?.display_name ||
    product?.name ||
    (cart[0] && cart[0].name) ||
    'Paiement Boxing Center';
  const urls = buildReturnUrls(baseUrl, order);

  const payload = {
    amount,
    currency: 'EUR',
    payment_method: 'scalapay',
    payment_context: { cart },
    billing: customer,
    shipping: {
      ...customer,
      delivery_type: 'BILLING',
      company_name: 'Boxing Center',
    },
    description: String(itemName).slice(0, 80),
    metadata: {
      ...(order?.order_id
        ? { order_id: order.order_id, lifecycle_order_id: order.order_id }
        : {}),
      ...(product?.id ? { product_id: String(product.id) } : {}),
      payment_plan: 'scalapay',
      ...metadata,
    },
    notification_url: `${baseUrl}/api/webhooks/payplug`,
    hosted_payment: {
      return_url: returnUrl || urls.return_url,
      cancel_url: cancelUrl || urls.cancel_url,
    },
  };
  return request('/payments', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Paiement carte hosted PayPlug (1×) — comptant, 1ʳᵉ échéance, matériel, etc.
 */
async function createHostedPayment({
  order = null,
  product = null,
  baseUrl,
  amountCents,
  description,
  metadata = {},
  customerOverrides = {},
  returnUrl = null,
  cancelUrl = null,
}) {
  const amount = Number(amountCents || product?.price_cents || 0);
  if (!amount || amount < 100) {
    throw new Error('Montant PayPlug invalide');
  }
  const itemName =
    description || product?.display_name || product?.name || 'Paiement Boxing Center';
  const customer = order
    ? customerDetails(order, customerOverrides)
    : customerDetails({ customer: customerOverrides }, {});
  const urls = buildReturnUrls(baseUrl, order);
  const billing = {
    first_name: customer.first_name || 'Client',
    last_name: customer.last_name || 'Boxing',
    email: customer.email || undefined,
    address1: customer.address1 || customer.address || 'Boxing Center',
    postcode: customer.postcode || customer.postal_code || '31000',
    city: customer.city || 'Toulouse',
    country: 'FR',
    language: 'fr',
  };
  if (customer.mobile_phone_number) {
    billing.mobile_phone_number = customer.mobile_phone_number;
  }
  if (customer.title) billing.title = customer.title;

  // PayPlug exige shipping même pour un service (retrait / facturation)
  const shipping = {
    ...billing,
    delivery_type: 'BILLING',
  };

  const payload = {
    amount,
    currency: 'EUR',
    billing,
    shipping,
    description: itemName.slice(0, 80),
    metadata: {
      ...(order?.order_id
        ? { order_id: order.order_id, lifecycle_order_id: order.order_id }
        : {}),
      ...(product?.id ? { product_id: String(product.id) } : {}),
      payment_plan: metadata.payment_plan || 'once',
      ...metadata,
    },
    notification_url: `${baseUrl}/api/webhooks/payplug`,
    hosted_payment: {
      return_url: returnUrl || urls.return_url,
      cancel_url: cancelUrl || urls.cancel_url,
    },
  };
  return request('/payments', { method: 'POST', body: JSON.stringify(payload) });
}

function retrievePayment(paymentId) {
  return request(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

/** Live d’abord, puis clés test (IPN PayPlug sans cookie studio). */
async function retrievePaymentLiveOrTest(paymentId) {
  try {
    return { payment: await retrievePayment(paymentId), test: false };
  } catch (liveErr) {
    try {
      const payment = await runPaymentContext({ test: true }, () => retrievePayment(paymentId));
      return { payment, test: true };
    } catch {
      throw liveErr;
    }
  }
}

async function listPayments({ page = 0, perPage = 10 } = {}) {
  const q = new URLSearchParams();
  const pageNum = Number(page);
  q.set('page', String(Number.isFinite(pageNum) && pageNum >= 0 ? pageNum : 0));
  q.set('per_page', String(Math.min(100, Math.max(1, Number(perPage) || 10))));
  return request(`/payments?${q}`, { method: 'GET' });
}

function isPayplugPaymentPaid(payment) {
  if (!payment || payment.failure) return false;
  if (payment.is_paid === true) return true;
  // Oney : une fois autorisé, auto_capture encaisse le total pour le marchand.
  const authorizedAt = payment.authorization?.authorized_at || payment.authorized_at;
  const pending = payment.payment_method?.is_pending === true;
  return Boolean(authorizedAt) && !pending && payment.auto_capture !== false;
}

function isPayplugPaymentPending(payment) {
  if (!payment || payment.failure || payment.is_paid) return false;
  return (
    payment.payment_method?.is_pending === true ||
    String(payment.host_status || '').toLowerCase() === 'pending' ||
    Boolean(payment.hosted_payment?.payment_url)
  );
}

function hostedPaymentUrl(payment) {
  return payment?.hosted_payment?.payment_url || null;
}

module.exports = {
  createFourTimesPayment,
  createScalapayPayment,
  createHostedPayment,
  retrievePayment,
  retrievePaymentLiveOrTest,
  listPayments,
  isPayplugPaymentPaid,
  isPayplugPaymentPending,
  isPayplugEnabled,
  isOney4xEnabled,
  isScalapayEnabled,
  isAmountEligibleForScalapay,
  ONEY_4X_UNAVAILABLE_MESSAGE,
  SCALAPAY_UNAVAILABLE_MESSAGE,
  SCALAPAY_FEES_HINT,
  SCALAPAY_REFUSAL_HELP,
  SCALAPAY_MIN_CENTS,
  SCALAPAY_MAX_CENTS,
  phoneE164,
  customerDetails,
  validateOneyCustomer,
  formatPayplugError,
  hostedPaymentUrl,
};
