'use strict';

/**
 * Sessions Stripe Checkout — carte + PayPal (compte club lié au Dashboard Stripe).
 */

const Stripe = require('stripe');
const { requiresIbanForPlan, isComptantStyleProduct } = require('../../lib/billing-plan');

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

function createCheckoutSessionParams({
  product,
  order,
  payload,
  baseUrl,
  packOrderMetadata,
  billingPlan,
}) {
  const gym = order.customer_full?.gym || payload?.gym || '';
  const plan = billingPlan || order.payment?.billing_plan || null;
  const needsIban = requiresIbanForPlan(product, plan);
  const successStep = needsIban ? 5 : 6;

  const customerEmail =
    order.customer_short?.email ||
    payload?.customer?.email ||
    payload?.email ||
    null;

  const meta = {
    product_id: product.id,
    order_id: order.order_id,
    lifecycle_order_id: order.order_id,
    bc_token: order.access_token,
    billing_plan: plan || (isComptantStyleProduct(product) ? 'comptant' : 'rib'),
    gym: gym || '',
    stripe_account: gym === 'portet' ? 'portet' : 'boxing_center',
    badge_timing: 'deferred',
    badge_method: 'iban',
    ...packOrderMetadata(payload),
  };

  const params = {
    // PayPal doit être activé dans le Dashboard Stripe (compte Business du club).
    payment_method_types: ['card', 'paypal'],
    metadata: meta,
    success_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=${successStep}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=4&cancelled=1`,
    mode: 'payment',
    line_items: [buildLineItem(product)],
  };

  if (customerEmail) {
    params.customer_email = customerEmail;
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
