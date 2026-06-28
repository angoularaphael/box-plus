#!/usr/bin/env node
/**
 * Boutique Boxing Center — Stripe → BOXPLUS, catalogue sync Deciplus
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { logInfo, logError } = require('../lib/logger');
const { getStoreUrl, getBridgeUrl, PRODUCTION_STORE_URL } = require('../lib/app-urls');
const {
  buildOrderPayload,
  validateCheckoutForm,
  dispatchOrder,
  packOrderMetadata,
  unpackOrderMetadata,
  savePendingOrder,
  loadPendingOrder,
  removePendingOrder,
} = require('./lib/orders');
const { getStoreProducts, ingestCatalogPayload } = require('./lib/deciplus-sync');

const PORT = Number(process.env.STORE_PORT || 3040);
const HOST = process.env.STORE_HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STORE_URL = getStoreUrl();
const SYNC_SECRET = process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';

function isAuthorizedSync(req) {
  if (!SYNC_SECRET) return false;
  const header = req.headers['x-sync-secret'] || req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return token === SYNC_SECRET;
}

let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

function findProduct(productId) {
  const catalog = getStoreProducts();
  const products = catalog.products || [];
  const id = String(productId || '').trim();
  if (!id) return null;

  let match = products.find((p) => p.id === id);
  if (match) return match;

  match = products.find((p) => p.legacy_id === id);
  if (match) return match;

  try {
    const { loadJson } = require('../lib/utils');
    const { normalizeText } = require('../bot/catalog');
    const staticProducts = loadJson('storefront/products.json');
    const staticRef = staticProducts.find((p) => p.id === id);
    if (staticRef) {
      const key = normalizeText(staticRef.name);
      match = products.find((p) => normalizeText(p.name) === key);
      if (match) return match;
      match = products.find((p) => normalizeText(p.name).includes(key.slice(0, 12)));
      if (match) return match;
    }
  } catch {
    /* ignore */
  }

  return null;
}

async function fulfillStripeSession(sessionId, stripeSession = null) {
  let pending = loadPendingOrder(sessionId);
  if (!pending && stripeSession?.metadata) {
    pending = unpackOrderMetadata(stripeSession.metadata);
  }
  if (!pending) {
    return { ok: false, error: 'pending_not_found' };
  }
  const payload = {
    ...pending,
    order_id: pending.order_id || `STORE-${sessionId.slice(-8)}`,
    payment_method: 'stripe',
    stripe_session_id: sessionId,
  };
  const result = await dispatchOrder(payload);
  removePendingOrder(sessionId);
  logInfo('Paiement Stripe → BOXPLUS', { order_id: payload.order_id, queued: result.queued, forwarded: result.forwarded });
  return { ok: true, order_id: payload.order_id, queued: result.queued, result };
}

function createApp() {
  const app = express();

  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      if (!stripe) {
        return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
      }

      let event;
      try {
        if (STRIPE_WEBHOOK_SECRET) {
          const sig = req.headers['stripe-signature'];
          event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
        } else {
          event = JSON.parse(req.body.toString());
        }
      } catch (err) {
        logError('Stripe webhook invalide', { error: err.message });
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      try {
        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const pending = loadPendingOrder(session.id);
          if (!pending) {
            logError('Session Stripe sans commande pending', { session_id: session.id });
          } else {
            await fulfillStripeSession(session.id, session);
          }
        }
        res.json({ received: true });
      } catch (err) {
        logError('Erreur traitement webhook Stripe', { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
      }
    }
  );

  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/products', (_req, res) => {
    const catalog = getStoreProducts();
    res.json({
      synced_at: catalog.synced_at,
      source: catalog.source || (catalog.synced_at ? 'deciplus' : 'static'),
      products: catalog.products,
    });
  });

  app.get('/api/config', (_req, res) => {
    const catalog = getStoreProducts();
    res.json({
      stripe_enabled: Boolean(stripe),
      demo_mode: !stripe,
      demo_checkout_enabled: String(process.env.STORE_DEMO_ENABLED || 'false') === 'true',
      store_url: STORE_URL,
      production_url: PRODUCTION_STORE_URL,
      boxplus_bridge: getBridgeUrl(),
      deciplus_synced_at: catalog.synced_at,
      product_count: catalog.products?.length || 0,
      sync_auto: String(process.env.STORE_SYNC_ENABLED || 'true') !== 'false',
    });
  });

  app.get('/api/cron/sync-catalog', async (req, res) => {
    if (!isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const { runCatalogSyncIfNeeded } = require('./lib/auto-sync');
    const result = await runCatalogSyncIfNeeded({ force: true });
    res.json({ ok: result.ok !== false, ...result });
  });

  app.post('/api/admin/ingest-catalog', (req, res) => {
    if (!isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const payload = ingestCatalogPayload(req.body);
      res.json({ ok: true, count: payload.count, synced_at: payload.synced_at });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/create-session', async (req, res) => {
    try {
      const { product_id: productId, ...form } = req.body;
      const product = findProduct(productId);
      if (!product) return res.status(404).json({ ok: false, error: 'Produit introuvable' });

      const formErrors = validateCheckoutForm(form, product);
      if (formErrors.length) return res.status(400).json({ ok: false, errors: formErrors });

      const orderId = `STORE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const payload = buildOrderPayload({ ...form, order_id: orderId }, product);

      if (!product.requires_payment) {
        const result = await dispatchOrder(payload);
        return res.json({
          ok: true,
          mode: 'free',
          order_id: orderId,
          queued: result.queued,
          redirect: `/success.html?order=${encodeURIComponent(orderId)}&product=${encodeURIComponent(product.id)}`,
        });
      }

      if (!stripe) {
        return res.status(503).json({
          ok: false,
          error: 'stripe_not_configured',
          hint: 'Ajoutez STRIPE_SECRET_KEY dans .env ou utilisez /api/checkout/demo',
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: product.price_cents,
              product_data: {
                name: product.name,
                description: product.description,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: form.email,
        metadata: {
          product_id: product.id,
          order_id: orderId,
          gym: form.gym,
          deciplus_id: String(product.deciplus_id || ''),
          ...packOrderMetadata(payload),
        },
        success_url: `${STORE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&order=${encodeURIComponent(orderId)}&product=${encodeURIComponent(product.id)}`,
        cancel_url: `${STORE_URL}/checkout.html?product=${product.id}&cancelled=1`,
      });

      savePendingOrder(session.id, payload);

      res.json({ ok: true, mode: 'stripe', url: session.url, session_id: session.id });
    } catch (err) {
      logError('Erreur create-session', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/confirm-session', async (req, res) => {
    try {
      const { session_id: sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ ok: false, error: 'session_id requis' });
      if (!stripe) return res.status(503).json({ ok: false, error: 'stripe_not_configured' });

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== 'paid') {
        return res.status(402).json({ ok: false, error: 'payment_not_completed', status: session.payment_status });
      }

      const out = await fulfillStripeSession(sessionId, session);
      if (!out.ok && out.error === 'pending_not_found') {
        return res.json({ ok: true, already_processed: true, order_id: req.body.order_id || null });
      }
      if (!out.ok) return res.status(500).json(out);

      res.json({ ok: true, order_id: out.order_id, queued: out.queued });
    } catch (err) {
      logError('Erreur confirm-session', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/demo', async (req, res) => {
    try {
      const { product_id: productId, ...form } = req.body;
      const product = findProduct(productId);
      if (!product) return res.status(404).json({ ok: false, error: 'Produit introuvable' });

      const formErrors = validateCheckoutForm(form, product);
      if (formErrors.length) return res.status(400).json({ ok: false, errors: formErrors });

      const orderId = `DEMO-${Date.now()}`;
      const payload = buildOrderPayload(
        { ...form, order_id: orderId, payment_method: 'demo' },
        product
      );
      const result = await dispatchOrder(payload);

      logInfo('Commande démo → BOXPLUS', { order_id: orderId, queued: result.queued });
      res.json({
        ok: true,
        mode: 'demo',
        order_id: orderId,
        queued: result.queued,
        redirect: `/success.html?order=${encodeURIComponent(orderId)}&demo=1&product=${encodeURIComponent(product.id)}`,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/checkout.html', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'checkout.html'));
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return app;
}

function main() {
  const app = createApp();
  if (process.env.VERCEL !== '1') {
    const { startAutoSync } = require('./lib/auto-sync');
    startAutoSync();
  }
  app.listen(PORT, HOST, () => {
    const catalog = getStoreProducts();
    logInfo(`Boutique Boxing Center → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (public: ${STORE_URL})`);
    logInfo(stripe ? 'Stripe: activé' : 'Stripe: mode démo');
    logInfo('Catalogue', {
      source: catalog.synced_at ? 'deciplus-live' : 'static-fallback',
      count: catalog.products?.length,
      synced_at: catalog.synced_at,
    });
  });
}

if (require.main === module) {
  main();
}

module.exports = { createApp, findProduct };
