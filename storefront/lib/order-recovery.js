/**
 * Récupération commande lifecycle perdue (Vercel /tmp éphémère) via Stripe.
 */
const { loadOrder, saveOrder } = require('./order-lifecycle');
const { unpackOrderMetadata } = require('./orders');

function snapshotFromProduct(product, productId) {
  if (!product) {
    return { id: productId, name: productId, display_name: productId };
  }
  return {
    id: product.id,
    name: product.name,
    display_name: product.display_name || product.name,
    price_cents: product.price_cents,
    requires_iban: product.requires_iban,
    requires_payment: product.requires_payment,
    sale_type: product.sale_type,
    deciplus_id: product.deciplus_id || null,
  };
}

function rebuildLifecycleOrderFromSession(session, { accessToken, findProduct }) {
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
    product_snapshot: snapshotFromProduct(product, productId),
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

  saveOrder(order);
  return order;
}

async function loadOrderOrRecover(orderId, { token, sessionId, stripe, findProduct }) {
  const existing = loadOrder(orderId);
  if (existing) return existing;
  if (!stripe || !sessionId || !token) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if ((session.metadata?.lifecycle_order_id || session.metadata?.order_id) !== orderId) {
      return null;
    }
    return rebuildLifecycleOrderFromSession(session, { accessToken: token, findProduct });
  } catch {
    return null;
  }
}

module.exports = {
  rebuildLifecycleOrderFromSession,
  loadOrderOrRecover,
};
