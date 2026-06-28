#!/usr/bin/env node
/**
 * Sync PrestaShop → file BOXPLUS (100 % Node.js, sans module PHP).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createPrestaShopClientFromEnv } = require('../lib/prestashop-client');
const { mapPrestaShopOrder } = require('../lib/prestashop-map');
const {
  getCheckoutForCart,
  removeCheckoutForCart,
} = require('../lib/prestashop-checkout-store');
const { enqueue, isProcessed } = require('../lib/queue');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { logInfo, logWarn, logError } = require('../lib/logger');
const { ROOT, ensureDir } = require('../lib/utils');

const STATE_FILE = path.join(ROOT, 'data', 'prestashop', 'sync-state.json');
const SYNC_MS = Number(process.env.PRESTASHOP_SYNC_MS || 60000);

function paidStateIds() {
  const raw = process.env.PRESTASHOP_PAID_STATE_IDS || '2';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function loadState() {
  ensureDir(path.dirname(STATE_FILE));
  if (!fs.existsSync(STATE_FILE)) {
    return { last_order_id: 0, last_sync_at: null };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { last_order_id: 0, last_sync_at: null };
  }
}

function saveState(state) {
  ensureDir(path.dirname(STATE_FILE));
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function enrichOrder(client, order) {
  const [customer, address, cartMessages, orderMessages] = await Promise.all([
    client.getCustomer(order.id_customer),
    client.getAddress(order.id_address_delivery || order.id_address_invoice),
    client.getMessagesByCart(order.id_cart),
    client.getMessagesByOrder(order.id),
  ]);

  const checkoutExtra = getCheckoutForCart(order.id_cart);

  return mapPrestaShopOrder(order, {
    customer,
    address,
    messages: [...cartMessages, ...orderMessages],
    checkoutExtra,
  });
}

async function syncPrestaShopOnce({ client = null } = {}) {
  const ps = client || createPrestaShopClientFromEnv();
  if (!ps) {
    return { ok: false, skipped: true, reason: 'PRESTASHOP_URL ou PRESTASHOP_API_KEY manquant' };
  }

  const state = loadState();
  const states = paidStateIds();
  const orders = await ps.getOrdersSince(state.last_order_id, { paidStateIds: states, limit: 50 });

  let queued = 0;
  let skipped = 0;
  let maxId = state.last_order_id;

  for (const order of orders) {
    const orderId = Number(order.id);
    if (orderId > maxId) maxId = orderId;

    const jobId = `PS-${order.id}`;
    if (isProcessed(jobId)) {
      skipped += 1;
      continue;
    }

    try {
      const rawPayload = await enrichOrder(ps, order);
      const normalized = normalizeOrder(rawPayload);
      const errors = validateOrder(normalized);
      if (errors.length) {
        logWarn('Commande PrestaShop ignorée (validation)', {
          order_id: jobId,
          errors,
        });
        skipped += 1;
        continue;
      }

      const result = enqueue(normalized);
      if (result.queued) {
        queued += 1;
        logInfo('Commande PrestaShop en file', {
          order_id: jobId,
          gym: normalized.gym,
          product: normalized.product_name,
        });
        if (order.id_cart) removeCheckoutForCart(order.id_cart);
      } else {
        skipped += 1;
      }
    } catch (err) {
      logError('Erreur sync commande PrestaShop', { order_id: jobId, error: err.message });
    }
  }

  saveState({
    last_order_id: maxId,
    last_sync_at: new Date().toISOString(),
    last_result: { queued, skipped, scanned: orders.length },
  });

  return { ok: true, queued, skipped, scanned: orders.length, last_order_id: maxId };
}

function startPrestaShopSyncLoop() {
  if (String(process.env.PRESTASHOP_SYNC_ENABLED || 'true').toLowerCase() === 'false') {
    return null;
  }

  const client = createPrestaShopClientFromEnv();
  if (!client) {
    logWarn('Sync PrestaShop désactivée — PRESTASHOP_URL / PRESTASHOP_API_KEY non configurés');
    return null;
  }

  logInfo('Sync PrestaShop démarrée', {
    url: client.baseUrl,
    interval_ms: SYNC_MS,
    paid_states: paidStateIds(),
  });

  const tick = () => {
    syncPrestaShopOnce({ client }).catch((err) => {
      logError('Sync PrestaShop en échec', { error: err.message });
    });
  };

  tick();
  const timer = setInterval(tick, SYNC_MS);
  if (timer.unref) timer.unref();
  return timer;
}

if (require.main === module) {
  syncPrestaShopOnce()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  syncPrestaShopOnce,
  startPrestaShopSyncLoop,
  paidStateIds,
};
