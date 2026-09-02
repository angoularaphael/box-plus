'use strict';

/**
 * Une inscription payée ne doit jamais rester sans vente Deciplus.
 * dispatched_at = « job envoyé », pas « contrat créé ».
 */
const { isAventureOrder } = require('../../lib/aventure-policy');
const { STEPS } = require('./order-lifecycle');

const REQUEUE_COOLDOWN_MS = Number(process.env.BOXPLUS_SALE_REQUEUE_MS || 10 * 60 * 1000);
const MAX_SALE_RETRIES = Number(process.env.BOXPLUS_SALE_REQUEUE_MAX || 12);
const LOOKBACK_MS = Number(process.env.BOXPLUS_SALE_REQUEUE_LOOKBACK_MS || 14 * 24 * 60 * 60 * 1000);
const PAID_UNSIGNED_GRACE_MS = Number(
  process.env.BOXPLUS_SALE_UNSIGNED_GRACE_MS || 15 * 60 * 1000
);

function productRequiresDeciplusSale(order = {}) {
  const snap = order.product_snapshot || {};
  if (snap.create_sale === false) return false;
  const saleType = String(snap.sale_type || order.sale_type || '').toLowerCase();
  if (saleType === 'none') return false;
  return true;
}

function deciplusSaleSettled(order = {}) {
  if (order.manual_migration || order.skip_bot) return true;
  if (order.deciplus_sale_id) return true;
  const st = String(order.bot_status || '').toLowerCase();
  return st === 'manual_ok' || st === 'manual_coach';
}

function isBoutiqueSaleOrder(order = {}) {
  const id = String(order.order_id || '');
  if (!id || /^(COACH|CHANGE|VERIFY|CANCEL)-/i.test(id)) return false;
  const action = String(order.action || '').toLowerCase();
  if (action && !['sale', 'balma_switch'].includes(action)) return false;
  return String(order.payment?.status || '').toLowerCase() === 'paid';
}

function identityReady(order = {}) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const cust = order.customer || {};
  const first = full.first_name || short.first_name || cust.first_name;
  const last = full.last_name || short.last_name || cust.last_name;
  const birth = full.birthdate || short.birthdate || cust.birthdate;
  const gym = full.gym || order.gym || cust.gym;
  return Boolean(first && last && birth && gym);
}

function aventureDossierReady(order = {}) {
  if (order.ready_for_dispatch || order.signature?.signed_at) return true;
  if (Number(order.step || 0) < STEPS.SIGNATURE) return false;
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const cust = order.customer || {};
  const first = full.first_name || short.first_name || cust.first_name;
  const last = full.last_name || short.last_name || cust.last_name;
  const birth = full.birthdate || short.birthdate || cust.birthdate;
  return Boolean(first && last && birth);
}

function paidUnsignedReady(order = {}, now = Date.now()) {
  if (order.signature?.signed_at || order.ready_for_dispatch) return false;
  if (!identityReady(order)) return false;
  const paid = Date.parse(order.payment?.paid_at || order.created_at || 0);
  if (!Number.isFinite(paid)) return false;
  return now - paid >= PAID_UNSIGNED_GRACE_MS;
}

function orderNeedsDeciplusSale(order = {}, now = Date.now()) {
  if (!isBoutiqueSaleOrder(order)) return false;
  if (deciplusSaleSettled(order)) return false;
  if (!productRequiresDeciplusSale(order)) return false;
  if (isAventureOrder(order)) return aventureDossierReady(order);
  return Boolean(
    order.signature?.signed_at || order.ready_for_dispatch || paidUnsignedReady(order, now)
  );
}

function lastDispatchAt(order = {}) {
  let max = 0;
  for (const value of [order.sale_reconcile_at, order.bot_processed_at, order.dispatched_at]) {
    const t = Date.parse(value || '');
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

function recentlyAttemptedDispatch(order = {}, now = Date.now()) {
  const at = lastDispatchAt(order);
  if (!at) return false;
  return now - at < REQUEUE_COOLDOWN_MS;
}

function withinLookback(order = {}, now = Date.now()) {
  const paid = Date.parse(order.payment?.paid_at || order.created_at || 0);
  if (!Number.isFinite(paid)) return true;
  return now - paid <= LOOKBACK_MS;
}

function saleRetryExhausted(order = {}) {
  return Number(order.sale_reconcile_attempts || 0) >= MAX_SALE_RETRIES;
}

function shouldRedispatchMissingSale(order = {}, now = Date.now()) {
  if (!orderNeedsDeciplusSale(order)) return false;
  if (!withinLookback(order, now)) return false;
  if (saleRetryExhausted(order)) return false;
  if (recentlyAttemptedDispatch(order, now)) return false;
  return true;
}

async function reconcileMissingDeciplusSales({
  listOrders,
  loadOrder,
  saveOrder,
  dispatchOrder,
  sendAlert,
  now = Date.now(),
} = {}) {
  const listed = (await listOrders()) || [];
  const candidates = listed.filter((o) => orderNeedsDeciplusSale(o) && withinLookback(o, now));
  const redispatched = [];
  const skipped = [];
  const exhausted = [];

  for (const slim of candidates) {
    const order = (typeof loadOrder === 'function' ? await loadOrder(slim.order_id) : slim) || slim;
    if (deciplusSaleSettled(order) || !orderNeedsDeciplusSale(order)) {
      skipped.push({ order_id: order.order_id, reason: 'settled_or_not_ready' });
      continue;
    }
    if (saleRetryExhausted(order)) {
      exhausted.push({
        order_id: order.order_id,
        attempts: Number(order.sale_reconcile_attempts || 0),
        bot_error: order.bot_error || null,
      });
      continue;
    }
    if (recentlyAttemptedDispatch(order, now)) {
      skipped.push({ order_id: order.order_id, reason: 'cooldown' });
      continue;
    }

    const attempts = Number(order.sale_reconcile_attempts || 0) + 1;
    try {
      const dispatch = await dispatchOrder(order, { force_requeue: true });
      order.sale_reconcile_at = new Date(now).toISOString();
      order.sale_reconcile_attempts = attempts;
      if (typeof saveOrder === 'function') await saveOrder(order);
      const row = {
        order_id: order.order_id,
        ok: true,
        queued: dispatch?.queued,
        forwarded: dispatch?.forwarded,
        reason: dispatch?.reason || null,
        attempts,
      };
      redispatched.push(row);
      if (attempts >= MAX_SALE_RETRIES && typeof sendAlert === 'function') {
        await sendAlert(`Vente Deciplus toujours absente après ${attempts} relances — ${order.order_id}`, {
          order_id: order.order_id,
          bot_status: order.bot_status || null,
          bot_error: order.bot_error || null,
        });
      }
    } catch (err) {
      order.sale_reconcile_at = new Date(now).toISOString();
      order.sale_reconcile_attempts = attempts;
      order.bot_error = String(err.message || err).slice(0, 500);
      if (typeof saveOrder === 'function') await saveOrder(order);
      redispatched.push({ order_id: order.order_id, ok: false, error: err.message, attempts });
    }
  }

  return {
    ok: true,
    checked: listed.length,
    missing: candidates.length,
    redispatched,
    skipped,
    exhausted,
  };
}

module.exports = {
  REQUEUE_COOLDOWN_MS,
  MAX_SALE_RETRIES,
  LOOKBACK_MS,
  PAID_UNSIGNED_GRACE_MS,
  productRequiresDeciplusSale,
  deciplusSaleSettled,
  isBoutiqueSaleOrder,
  identityReady,
  aventureDossierReady,
  paidUnsignedReady,
  orderNeedsDeciplusSale,
  recentlyAttemptedDispatch,
  shouldRedispatchMissingSale,
  reconcileMissingDeciplusSales,
};
