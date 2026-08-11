'use strict';

/**
 * PayPal natif (hors Stripe) — Orders API v2 + capture.
 * Pay Later / 4× FR : proposé par PayPal si le compte + client sont éligibles
 * (enable-funding=paylater côté SDK ; ici flux redirect approve).
 */

function isPaypalEnabled() {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET
  );
}

function paypalMode() {
  const mode = String(process.env.PAYPAL_MODE || '').toLowerCase();
  if (mode === 'live' || mode === 'production') return 'live';
  if (String(process.env.PAYPAL_CLIENT_ID || '').startsWith('A') && process.env.PAYPAL_LIVE === '1') {
    return 'live';
  }
  // sandbox par défaut si sk/client sandbox, sinon live si PAYPAL_MODE=live
  return mode === 'sandbox' || !mode ? 'sandbox' : 'live';
}

function apiBase() {
  return paypalMode() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function publicClientId() {
  return process.env.PAYPAL_CLIENT_ID || '';
}

let cachedToken = { value: null, exp: 0 };

async function getAccessToken() {
  if (cachedToken.value && Date.now() < cachedToken.exp - 30_000) {
    return cachedToken.value;
  }
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET manquants');

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || body.error || `PayPal OAuth ${res.status}`);
  }
  cachedToken = {
    value: body.access_token,
    exp: Date.now() + Number(body.expires_in || 300) * 1000,
  };
  return cachedToken.value;
}

async function paypalRequest(path, { method = 'GET', body = null } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
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
      data.message ||
      data.error_description ||
      data.details?.[0]?.description ||
      `PayPal HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function eurosFromCents(cents) {
  return (Number(cents) / 100).toFixed(2);
}

function approveUrl(order) {
  const link = (order.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return link?.href || null;
}

/**
 * Crée une commande PayPal (CAPTURE) et renvoie l’URL d’approbation.
 */
async function createPaypalOrder({
  order,
  product,
  amountCents,
  baseUrl,
  paymentPlan = 'once',
  description = null,
  metadata = {},
  returnUrl = null,
  cancelUrl = null,
}) {
  const amount = Number(amountCents || product?.price_cents || 0);
  if (!amount) throw new Error('Montant PayPal invalide');

  const itemName = description || product?.display_name || product?.name || 'Boxing Center';
  const returnBase = order?.access_token
    ? `${baseUrl}/inscription?order=${encodeURIComponent(order.order_id)}&token=${encodeURIComponent(order.access_token)}`
    : `${baseUrl}/`;
  const resolvedReturn = returnUrl || `${returnBase}&step=4&paypal_return=1`;
  const resolvedCancel = cancelUrl || `${returnBase}&step=4&cancelled=1`;

  const customId = String(
    order?.order_id || metadata.order_id || metadata.payment_ref || metadata.verify_order_id || ''
  ).slice(0, 127);
  // Ne pas mélanger payment_source + application_context (INCOMPATIBLE_PARAMETER_VALUE).
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: customId || 'boxing-center',
        custom_id: customId || undefined,
        description: String(itemName).slice(0, 127),
        amount: {
          currency_code: 'EUR',
          value: eurosFromCents(amount),
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Boxing Center',
          locale: 'fr-FR',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: resolvedReturn,
          cancel_url: resolvedCancel,
          shipping_preference: 'NO_SHIPPING',
        },
      },
    },
  };

  // Stocke payment_plan dans custom_id/reference — metadata app côté notre order
  const created = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    body: payload,
  });

  return {
    id: created.id,
    status: created.status,
    approve_url: approveUrl(created),
    raw: created,
    payment_plan: paymentPlan,
  };
}

async function capturePaypalOrder(paypalOrderId) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    body: {},
  });
}

async function retrievePaypalOrder(paypalOrderId) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, {
    method: 'GET',
  });
}

function isPaypalOrderPaid(capturedOrOrder) {
  const status = String(capturedOrOrder?.status || '').toUpperCase();
  if (status === 'COMPLETED') return true;
  const units = capturedOrOrder?.purchase_units || [];
  for (const u of units) {
    const captures = u.payments?.captures || [];
    if (captures.some((c) => String(c.status || '').toUpperCase() === 'COMPLETED')) {
      return true;
    }
  }
  return false;
}

module.exports = {
  isPaypalEnabled,
  paypalMode,
  publicClientId,
  createPaypalOrder,
  capturePaypalOrder,
  retrievePaypalOrder,
  isPaypalOrderPaid,
  approveUrl,
  eurosFromCents,
};
