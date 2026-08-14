'use strict';

/**
 * PayPal natif (hors Stripe) — Orders API v2 + capture.
 * Deux comptes possibles :
 *   - Minimes / autres salles → PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET
 *   - Portet                 → PAYPAL_PORTET_CLIENT_ID + PAYPAL_PORTET_CLIENT_SECRET
 *     (si les clés Portet manquent, repli sur le compte Minimes)
 * Pay Later / 4× FR : proposé par PayPal si le compte + client sont éligibles
 * (enable-funding=paylater côté SDK ; ici flux redirect approve).
 * Mode studio (cookie) : overlay env.test / PAYPAL_TEST_* → sandbox.
 */

const { paymentVar } = require('./test-env');

function paypalAccountForGym(gym) {
  return String(gym || '').trim().toLowerCase() === 'portet' ? 'portet' : 'minimes';
}

/** LOGIN = compte PayPal ; BILLING = saisie carte (invité), email prérempli. */
function resolvePaypalLandingPage({ paymentPlan, guestCard } = {}) {
  if (paymentPlan === '4x') return 'NO_PREFERENCE';
  if (guestCard) return 'BILLING';
  return 'LOGIN';
}

function resolvePaypalAccount({ gym, account } = {}) {
  if (account === 'portet' || account === 'minimes') return account;
  return paypalAccountForGym(gym);
}

function credentialsForAccount(account) {
  if (account === 'portet') {
    return {
      account: 'portet',
      clientId: paymentVar('PAYPAL_PORTET_CLIENT_ID') || paymentVar('PAYPAL_CLIENT_ID') || '',
      secret: paymentVar('PAYPAL_PORTET_CLIENT_SECRET') || paymentVar('PAYPAL_CLIENT_SECRET') || '',
    };
  }
  return {
    account: 'minimes',
    clientId: paymentVar('PAYPAL_CLIENT_ID') || '',
    secret: paymentVar('PAYPAL_CLIENT_SECRET') || '',
  };
}

function isPaypalEnabled(gym) {
  const creds = credentialsForAccount(paypalAccountForGym(gym));
  return Boolean(creds.clientId && creds.secret);
}

function looksLikePaypalClientId(id) {
  return String(id || '').trim().length >= 60;
}

function formatPaypalError(err, { gym } = {}) {
  const raw = String(err?.message || err?.body?.error_description || err?.body?.error || '');
  const portet = String(gym || '').trim().toLowerCase() === 'portet';
  if (/client authentication failed|invalid_client/i.test(raw) || /CLIENT_ID.*invalide/i.test(raw)) {
    return portet
      ? 'PayPal Portet est mal configuré (identifiants). Payez par carte, ou réessayez plus tard.'
      : 'PayPal est mal configuré (identifiants). Réessayez, ou payez par carte.';
  }
  return raw || 'Erreur PayPal';
}

function paypalMode() {
  const mode = String(paymentVar('PAYPAL_MODE') || '').toLowerCase();
  if (mode === 'sandbox' || mode === 'test') return 'sandbox';
  if (mode === 'live' || mode === 'production') return 'live';
  if (String(paymentVar('PAYPAL_CLIENT_ID') || '').startsWith('A') && process.env.PAYPAL_LIVE === '1') {
    return 'live';
  }
  return !mode ? 'sandbox' : 'live';
}

function apiBase() {
  return paypalMode() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function publicClientId(gym) {
  return credentialsForAccount(paypalAccountForGym(gym)).clientId;
}

const tokenCache = {};

async function getAccessToken(account = 'minimes') {
  const acc = account === 'portet' ? 'portet' : 'minimes';
  const cacheKey = `${acc}:${paypalMode()}`;
  const cached = tokenCache[cacheKey];
  if (cached?.value && Date.now() < cached.exp - 30_000) {
    return cached.value;
  }
  const { clientId, secret } = credentialsForAccount(acc);
  if (!clientId || !secret) {
    throw new Error(
      acc === 'portet'
        ? 'PAYPAL_PORTET_CLIENT_ID / PAYPAL_PORTET_CLIENT_SECRET manquants'
        : 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET manquants'
    );
  }
  if (!looksLikePaypalClientId(clientId)) {
    const err = new Error(
      acc === 'portet'
        ? 'PAYPAL_PORTET_CLIENT_ID invalide (trop court — coller le Client ID Live complet)'
        : 'PAYPAL_CLIENT_ID invalide (trop court — coller le Client ID Live complet)'
    );
    err.code = 'paypal_client_id_invalid';
    throw err;
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
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
  tokenCache[cacheKey] = {
    value: body.access_token,
    exp: Date.now() + Number(body.expires_in || 300) * 1000,
  };
  return tokenCache[cacheKey].value;
}

async function paypalRequest(path, { method = 'GET', body = null, gym, account } = {}) {
  const acc = resolvePaypalAccount({ gym, account });
  const token = await getAccessToken(acc);
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
  gym = null,
  guestCard = false,
  payerEmail = null,
}) {
  const amount = Number(amountCents || product?.price_cents || 0);
  if (!amount) throw new Error('Montant PayPal invalide');

  const resolvedGym =
    gym ||
    order?.customer_full?.gym ||
    metadata.gym ||
    '';
  const account = paypalAccountForGym(resolvedGym);

  const itemName = description || product?.display_name || product?.name || 'Boxing Center';
  const returnBase = order?.access_token
    ? `${baseUrl}/inscription?order=${encodeURIComponent(order.order_id)}&token=${encodeURIComponent(order.access_token)}&bc_token=${encodeURIComponent(order.access_token)}`
    : `${baseUrl}/`;
  const resolvedReturn = returnUrl || `${returnBase}&step=4&paypal_return=1`;
  const resolvedCancel = cancelUrl || `${returnBase}&step=4&cancelled=1`;

  const customId = String(
    order?.order_id || metadata.order_id || metadata.payment_ref || metadata.verify_order_id || ''
  ).slice(0, 127);
  const email = String(
    payerEmail ||
      order?.customer_short?.email ||
      order?.customer_full?.email ||
      metadata.email ||
      ''
  )
    .trim()
    .toLowerCase();
  const landingPage = resolvePaypalLandingPage({ paymentPlan, guestCard });
  const paypalSource = {
    experience_context: {
      brand_name: account === 'portet' ? 'Boxing Center Portet' : 'Boxing Center',
      locale: 'fr-FR',
      landing_page: landingPage,
      user_action: 'PAY_NOW',
      return_url: resolvedReturn,
      cancel_url: resolvedCancel,
      shipping_preference: 'NO_SHIPPING',
    },
  };
  if (email && email.includes('@')) paypalSource.email_address = email.slice(0, 254);

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
      paypal: paypalSource,
    },
  };

  // Stocke payment_plan dans custom_id/reference — metadata app côté notre order
  const created = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    body: payload,
    account,
  });

  return {
    id: created.id,
    status: created.status,
    approve_url: approveUrl(created),
    raw: created,
    payment_plan: paymentPlan,
    paypal_account: account,
  };
}

async function capturePaypalOrder(paypalOrderId, opts = {}) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    body: {},
    gym: opts.gym,
    account: opts.account,
  });
}

async function retrievePaypalOrder(paypalOrderId, opts = {}) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, {
    method: 'GET',
    gym: opts.gym,
    account: opts.account,
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
  paypalAccountForGym,
  resolvePaypalAccount,
  resolvePaypalLandingPage,
  credentialsForAccount,
  createPaypalOrder,
  capturePaypalOrder,
  retrievePaypalOrder,
  isPaypalOrderPaid,
  formatPaypalError,
  looksLikePaypalClientId,
};
