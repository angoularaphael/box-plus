'use strict';

/**
 * Sessions Stripe Checkout — paiement unique ou abonnement 4 semaines.
 */

function buildLineItem(product) {
  return {
    price_data: {
      currency: 'eur',
      unit_amount: product.price_cents,
      product_data: {
        name: product.display_name || product.name,
        description: product.description || undefined,
      },
    },
    quantity: 1,
  };
}

function buildSubscriptionLineItem(product) {
  const item = buildLineItem(product);
  item.price_data.recurring = { interval: 'week', interval_count: 4 };
  return item;
}

function createCheckoutSessionParams({ product, order, payload, baseUrl, packOrderMetadata, billingPlan }) {
  const isSubscription = billingPlan === 'cb';
  const meta = {
    product_id: product.id,
    order_id: order.order_id,
    lifecycle_order_id: order.order_id,
    bc_token: order.access_token,
    billing_plan: billingPlan || 'rib',
    ...packOrderMetadata(payload),
  };

  const params = {
    payment_method_types: ['card'],
    customer_email: order.customer_short?.email || payload.customer?.email,
    metadata: meta,
    success_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=4&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=3&cancelled=1`,
  };

  if (isSubscription) {
    params.mode = 'subscription';
    params.line_items = [buildSubscriptionLineItem(product)];
    params.subscription_data = {
      metadata: {
        order_id: order.order_id,
        lifecycle_order_id: order.order_id,
        billing_plan: 'cb',
        product_id: product.id,
      },
    };
  } else {
    params.mode = 'payment';
    params.line_items = [buildLineItem(product)];
  }

  return params;
}

/** Stripe Checkout — paiement réellement encaissé (pas seulement session ouverte). */
function isStripeCheckoutPaid(session) {
  if (!session) return false;
  const status = String(session.payment_status || '').toLowerCase();
  if (status === 'paid' || status === 'no_payment_required') return true;
  return false;
}

module.exports = {
  createCheckoutSessionParams,
  isStripeCheckoutPaid,
};
