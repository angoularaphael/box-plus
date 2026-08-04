'use strict';

/**
 * Sessions Stripe Checkout — paiement unique ou abonnement 4 semaines.
 * Portet : clé dédiée (STRIPE_SECRET_KEY_PORTET) — même compte possible pour l'instant.
 */

const Stripe = require('stripe');

function stripeClientForGym(gym) {
  const key =
    String(gym || '').toLowerCase() === 'portet'
      ? process.env.STRIPE_SECRET_KEY_PORTET || process.env.STRIPE_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY manquante');
  return {
    stripe: new Stripe(key),
    account: String(gym || '').toLowerCase() === 'portet' ? 'portet' : 'boxing_center',
  };
}

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

function createCheckoutSessionParams({
  product,
  order,
  payload,
  baseUrl,
  packOrderMetadata,
  billingPlan,
  badgeTiming,
  badgeMethod,
}) {
  const isSubscription = billingPlan === 'cb';
  const gym = order.customer_full?.gym || payload?.gym || '';
  const includeBadgeOnStripe = false; // Badge toujours ~72h IBAN — jamais sur Stripe

  const meta = {
    product_id: product.id,
    order_id: order.order_id,
    lifecycle_order_id: order.order_id,
    bc_token: order.access_token,
    billing_plan: billingPlan || 'rib',
    gym: gym || '',
    stripe_account: gym === 'portet' ? 'portet' : 'boxing_center',
    badge_timing: 'deferred',
    badge_method: 'iban',
    ...packOrderMetadata(payload),
  };

  const badgeLine = {
    price_data: {
      currency: 'eur',
      unit_amount: 3499,
      product_data: {
        name: "Badge d'accès Boxing Center",
        description: 'Paiement immédiat du badge',
      },
    },
    quantity: 1,
  };

  const params = {
    payment_method_types: ['card'],
    customer_email: order.customer_short?.email || payload.customer?.email,
    metadata: meta,
    success_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=5&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=4&cancelled=1`,
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
        gym: gym || '',
      },
    };
    if (includeBadgeOnStripe) {
      params.subscription_data.add_invoice_items = [badgeLine];
    }
  } else {
    params.mode = 'payment';
    params.line_items = [buildLineItem(product)];
    if (includeBadgeOnStripe) {
      params.line_items.push(badgeLine);
    }
  }

  return params;
}

function isStripeCheckoutPaid(session) {
  if (!session) return false;
  const status = String(session.payment_status || '').toLowerCase();
  if (status === 'paid' || status === 'no_payment_required') return true;
  return false;
}

module.exports = {
  createCheckoutSessionParams,
  isStripeCheckoutPaid,
  stripeClientForGym,
};
