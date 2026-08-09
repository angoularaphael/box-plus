'use strict';

const API_BASE = 'https://api.payplug.com/v1';
const API_VERSION = process.env.PAYPLUG_API_VERSION || '2019-08-06';

function isPayplugEnabled() {
  return Boolean(process.env.PAYPLUG_SECRET_KEY);
}

function headers() {
  const key = process.env.PAYPLUG_SECRET_KEY;
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
  const title = String(customer.gender || '').toUpperCase() === 'F' ? 'mrs' : 'mr';
  const common = {
    title,
    first_name: customer.first_name || '',
    last_name: customer.last_name || '',
    email: customer.email || '',
    address1: customer.address || '',
    postcode: customer.postal_code || '',
    city: customer.city || '',
    country: 'FR',
    language: 'fr',
  };
  const mobile = phoneE164(customer.phone);
  if (mobile) common.mobile_phone_number = mobile;
  return common;
}

function validateOneyCustomer(details) {
  const missing = [];
  if (!details.first_name) missing.push('prénom');
  if (!details.last_name) missing.push('nom');
  if (!details.email) missing.push('email');
  if (!details.mobile_phone_number || !isFrenchMobileE164(details.mobile_phone_number)) {
    missing.push('téléphone mobile FR (06/07…)');
  }
  if (!details.address1) missing.push('adresse');
  if (!details.postcode) missing.push('code postal');
  if (!details.city) missing.push('ville');
  return missing;
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
    const message = body.message || body.error || `Payplug HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function buildReturnUrls(baseUrl, order, { step = 4 } = {}) {
  if (order?.order_id && order?.access_token) {
    const returnBase = `${baseUrl}/inscription?order=${encodeURIComponent(order.order_id)}&token=${encodeURIComponent(order.access_token)}`;
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

async function createFourTimesPayment({ order, product, baseUrl, customerOverrides = {} }) {
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
  const urls = buildReturnUrls(baseUrl, order);
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
      order_id: order.order_id,
      lifecycle_order_id: order.order_id,
      product_id: String(product.id || ''),
      payment_plan: '4x',
    },
    notification_url: `${baseUrl}/api/webhooks/payplug`,
    hosted_payment: urls,
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

function isPayplugPaymentPaid(payment) {
  return Boolean(payment && payment.is_paid === true && !payment.failure);
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
  createHostedPayment,
  retrievePayment,
  isPayplugPaymentPaid,
  isPayplugPaymentPending,
  isPayplugEnabled,
  phoneE164,
  customerDetails,
  validateOneyCustomer,
  hostedPaymentUrl,
};
