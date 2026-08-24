/**
 * Récupération commande lifecycle perdue (Vercel /tmp éphémère) via Stripe, Supabase ou client.
 */
const { loadOrderAsync, saveOrderAsync, productSnapshot } = require('./order-lifecycle');
const { unpackOrderMetadata } = require('./orders');

/** Normalise le body identité / paiement pour recréer un dossier perdu. */
function checkoutRehydrateBody(body) {
  if (!body || typeof body !== 'object') return body;
  const nested = body.customer_short || {};
  const email = String(nested.email || body.email || '').trim();
  const customer_short = email
    ? {
        first_name: nested.first_name || body.first_name,
        last_name: nested.last_name || body.last_name,
        email,
        phone: nested.phone || body.phone || '',
        birthdate: nested.birthdate || body.birthdate || null,
      }
    : nested.email || nested.first_name
      ? nested
      : undefined;
  return {
    ...body,
    product_id: body.product_id || body.product_snapshot?.id,
    customer_short,
  };
}

function rehydrateOrderFromClient(orderId, body, findProduct) {
  const { sanitizeOrderId } = require('./security');
  const safeId = sanitizeOrderId(orderId);
  const normalized = checkoutRehydrateBody(body) || {};
  const { token, product_id, customer_short, product_snapshot } = normalized;
  if (!safeId || !token || !product_id || !customer_short?.email) return null;

  const product = findProduct ? findProduct(product_id) : null;
  const gym = String(normalized.gym || '').trim();
  return {
    order_id: safeId,
    access_token: token,
    step: 4,
    product_id,
    product_snapshot: product ? productSnapshot(product) : product_snapshot || { id: product_id },
    customer_short,
    customer_full: gym ? { gym } : null,
    payment: { status: 'pending', iban: normalized.iban || undefined },
    signature: null,
    documents: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ready_for_dispatch: false,
    rehydrated_from_client: true,
  };
}

function rebuildLifecycleOrderFromSession(session, { accessToken, findProduct }) {
  return rebuildLifecycleOrderFromSessionAsync(session, { accessToken, findProduct });
}

async function rebuildLifecycleOrderFromSessionAsync(session, { accessToken, findProduct }) {
  const orderId = session.metadata?.lifecycle_order_id || session.metadata?.order_id;
  if (!orderId) return null;
  if (session.payment_status !== 'paid') return null;

  const metaToken = session.metadata?.bc_token;
  const resolvedToken = accessToken || metaToken;
  if (!resolvedToken) return null;
  if (metaToken && accessToken && metaToken !== accessToken) return null;

  const pending = unpackOrderMetadata(session.metadata);
  if (!pending) return null;

  const customer = pending.customer || {};
  const productId = session.metadata.product_id || pending.product_id;
  const product = findProduct ? findProduct(productId) : null;

  const order = {
    order_id: orderId,
    access_token: resolvedToken,
    step: 4,
    product_id: productId,
    product_snapshot: product ? productSnapshot(product) : { id: productId, name: productId, display_name: productId },
    customer_short: {
      first_name: pending.first_name || customer.first_name,
      last_name: pending.last_name || customer.last_name,
      email: pending.email || customer.email,
      phone: pending.phone || customer.phone,
      birthdate: pending.birthdate || customer.birthdate,
    },
    customer_full: null,
    payment: {
      status: 'paid',
      method: 'stripe',
      stripe_session_id: session.id,
      iban: pending.payment?.iban || pending.iban,
      paid_at: new Date().toISOString(),
    },
    signature: null,
    documents: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ready_for_dispatch: false,
    recovered_from_stripe: true,
  };

  await saveOrderAsync(order);
  return order;
}

async function loadOrderOrRecover(orderId, { token, sessionId, stripe, findProduct, rehydrateBody }) {
  const existing = await loadOrderAsync(orderId);
  if (existing) return existing;

  const body = checkoutRehydrateBody(rehydrateBody);
  if (body?.token && token && body.token === token) {
    const rebuilt = rehydrateOrderFromClient(orderId, body, findProduct);
    if (rebuilt) {
      await saveOrderAsync(rebuilt);
      return rebuilt;
    }
  }

  if (!stripe || !sessionId || !token) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if ((session.metadata?.lifecycle_order_id || session.metadata?.order_id) !== orderId) {
      return null;
    }
    return rebuildLifecycleOrderFromSessionAsync(session, { accessToken: token, findProduct });
  } catch {
    return null;
  }
}

module.exports = {
  rebuildLifecycleOrderFromSession,
  rebuildLifecycleOrderFromSessionAsync,
  rehydrateOrderFromClient,
  checkoutRehydrateBody,
  loadOrderOrRecover,
};
