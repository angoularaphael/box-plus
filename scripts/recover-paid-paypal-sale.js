#!/usr/bin/env node
'use strict';
/**
 * PayPal encaissé hors tunnel (refus carte puis PayPal) → marquer payé + vente Deciplus.
 * Usage:
 *   node scripts/recover-paid-paypal-sale.js --order=BC-xxx --dispatch
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = process.env.BOXPLUS_ORDERS_REMOTE || '1';

const {
  loadOrderAsync,
  saveOrderAsync,
  markPaymentPaid,
} = require('../storefront/lib/order-lifecycle');
const { buildOrderFromLifecycle, dispatchOrder } = require('../storefront/lib/orders');
const { findEnrichedProduct, hydrateMerchOnce } = require('../storefront/lib/merch');

const ORDER_ID = process.argv.find((a) => a.startsWith('--order='))?.slice(8) || '';
const DISPATCH = process.argv.includes('--dispatch');
const DRY = process.argv.includes('--dry');

function arg(name, fallback = '') {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

async function main() {
  if (!ORDER_ID) throw new Error('--order=BC-… requis');
  await hydrateMerchOnce().catch(() => {});
  const order = await loadOrderAsync(ORDER_ID);
  if (!order) throw new Error(`commande introuvable: ${ORDER_ID}`);

  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product =
    findEnrichedProduct(order.product_id) ||
    order.product_snapshot ||
    null;
  if (!product) throw new Error('produit introuvable');

  const gym = full.gym || order.gym || 'minimes';
  order.customer_full = {
    ...full,
    gym,
    first_name: full.first_name || short.first_name,
    last_name: full.last_name || short.last_name,
    email: full.email || short.email,
    phone: full.phone || short.phone,
    birthdate: full.birthdate || short.birthdate,
    gender: full.gender || arg('gender', 'F'),
    address: full.address || '1 rue Boxing Center',
    postal_code: full.postal_code || '31000',
    city: full.city || 'Toulouse',
  };
  order.source = order.source || 'recover-paid-paypal';

  const paypalId = arg('paypal') || order.payment?.paypal_order_id || null;
  if (order.payment?.status !== 'paid') {
    if (!DRY) {
      await markPaymentPaid(ORDER_ID, {
        method: 'paypal',
        payment_plan: order.payment?.payment_plan || 'once',
        billing_plan: 'paypal',
        paypal_order_id: paypalId,
        paypal_account: order.payment?.paypal_account || 'minimes',
        amount: Number(product.price_cents || 25900) / 100,
        status: 'paid',
        recovered_at: new Date().toISOString(),
        recovered_reason: 'paypal_captured_after_payplug_fail',
        error: null,
        failure: null,
      });
    }
  }

  let paid = (await loadOrderAsync(ORDER_ID)) || order;
  paid.customer_full = order.customer_full;
  paid.source = order.source;
  if (!DRY) await saveOrderAsync(paid);

  const out = {
    order_id: ORDER_ID,
    name: `${short.first_name || ''} ${short.last_name || ''}`.trim(),
    gym,
    pay_status: paid.payment?.status,
    dispatched_at: paid.dispatched_at || null,
    dry: DRY,
  };

  if (!DISPATCH) {
    console.log(JSON.stringify({ ...out, skipped: 'no --dispatch' }));
    return;
  }
  if (paid.dispatched_at && !process.argv.includes('--force')) {
    console.log(JSON.stringify({ ...out, skipped: 'already_dispatched' }));
    return;
  }
  if (DRY) {
    console.log(JSON.stringify({ ...out, would_dispatch: true }));
    return;
  }

  const result = await dispatchOrder(buildOrderFromLifecycle(paid, product));
  paid.dispatched_at = new Date().toISOString();
  paid.dispatch_result = { queued: result.queued !== false, forwarded: Boolean(result.forwarded), recover: true };
  paid.ready_for_dispatch = true;
  await saveOrderAsync(paid);

  const bot = String(process.env.BOXPLUS_BOT_URL || '').replace(/\/$/, '');
  const secret = process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';
  let processed = null;
  if (bot && secret) {
    for (let i = 0; i < 24; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      const jr = await fetch(`${bot}/api/jobs/${encodeURIComponent(ORDER_ID)}`, {
        headers: { 'x-sync-secret': secret },
      })
        .then((x) => x.json())
        .catch(() => ({}));
      processed = jr.processed || null;
      if (processed?.status && processed.status !== 'pending' && processed.status !== 'processing') break;
    }
  }

  console.log(JSON.stringify({ ...out, dispatch: result, processed }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
