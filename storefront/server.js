#!/usr/bin/env node
/**
 * Boutique Boxing Center — Stripe → BOXPLUS, tunnel 6 étapes
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { logInfo, logError } = require('../lib/logger');
const { getStoreUrl, getCheckoutBaseUrl, getBridgeUrl, PRODUCTION_STORE_URL } = require('../lib/app-urls');
const {
  buildOrderPayload,
  buildOrderFromLifecycle,
  validateCheckoutForm,
  validateShortForm,
  validateFullForm,
  validatePaymentForm,
  dispatchOrder,
  packOrderMetadata,
  unpackOrderMetadata,
  savePendingOrder,
  loadPendingOrder,
  removePendingOrder,
} = require('./lib/orders');
const { getStoreProducts, ingestCatalogPayload } = require('./lib/deciplus-sync');
const { BADGE_FEE_NOTICE } = require('./lib/storefront-copy');
const {
  getEnrichedProducts,
  getFeaturedProducts,
  getMaterielProducts,
  getMaterielCategories,
  findEnrichedProduct,
  findMaterielProduct,
  loadMerch,
  saveMerch,
  loadMaterielCatalog,
  saveMaterielCatalog,
  updateMerchProduct,
  setFeaturedHome,
} = require('./lib/merch');
const {
  validateCartLines,
  validateCustomerForm,
  buildStripeLineItems,
  createMaterielOrder,
  markMaterielPaid,
  savePendingCheckout,
  loadPendingCheckout,
  removePendingCheckout,
  loadOrder: loadMaterielOrder,
  saveOrder: saveMaterielOrderRecord,
} = require('./lib/materiel-cart');
const { sendMaterielConfirmationEmail } = require('./lib/mailer');
const {
  createDraft,
  loadOrder,
  verifyAccess,
  updateShortProfile,
  markPaymentPaid,
  updateFullProfile,
  recordSignature,
  markEmailSent,
  getUploadDir,
} = require('./lib/order-lifecycle');
const { generateContractPdf, streamContractPdf } = require('./lib/contract-pdf');
const { sendConfirmationEmail, sendGdprEraseRequest } = require('./lib/mailer');

const PORT = Number(process.env.STORE_PORT || 3040);
const HOST = process.env.STORE_HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STORE_URL = getStoreUrl();
const SYNC_SECRET = process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const type = file.fieldname === 'rib_file' ? 'ribs' : 'photos';
      cb(null, getUploadDir(type));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${req.params.id || 'upload'}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function isAuthorizedSync(req) {
  if (!SYNC_SECRET) return false;
  const header = req.headers['x-sync-secret'] || req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return token === SYNC_SECRET;
}

function isAuthorizedAdmin(req) {
  if (!ADMIN_SECRET) return false;
  const header = req.headers['x-admin-secret'] || req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return token === ADMIN_SECRET;
}

let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

function findProduct(productId) {
  return findEnrichedProduct(productId) || null;
}

async function dispatchLifecycleOrder(order) {
  const product = findProduct(order.product_id) || order.product_snapshot;
  const payload = buildOrderFromLifecycle(order, product);
  const result = await dispatchOrder(payload);
  order.dispatched_at = new Date().toISOString();
  order.dispatch_result = { queued: result.queued, forwarded: result.forwarded };
  const { saveOrder } = require('./lib/order-lifecycle');
  saveOrder(order);
  logInfo('Commande lifecycle → BOXPLUS', { order_id: order.order_id, queued: result.queued });
  return result;
}

async function fulfillMaterielCheckout(sessionId, stripeSession = null) {
  const pending = loadPendingCheckout(sessionId);
  if (!pending) {
    if (stripeSession?.metadata?.order_type === 'materiel') {
      const order = loadMaterielOrder(stripeSession.metadata.order_id);
      if (order?.payment?.status === 'paid') {
        return { ok: true, order_id: order.order_id, materiel: true, already_processed: true };
      }
    }
    return { ok: false, error: 'pending_not_found' };
  }

  let order = loadMaterielOrder(pending.order_id);
  if (!order) {
    order = createMaterielOrder({
      order_id: pending.order_id,
      customer: pending.customer,
      items: pending.items,
      total_cents: pending.total_cents,
      pickup_gym: pending.pickup_gym,
    });
  }

  order = markMaterielPaid(order.order_id, {
    method: 'stripe',
    stripe_session_id: sessionId,
  });

  removePendingCheckout(sessionId);

  try {
    const emailResult = await sendMaterielConfirmationEmail(order);
    order.email_sent = emailResult.sent;
    saveMaterielOrderRecord(order);
  } catch (err) {
    logError('Email matériel échoué', { error: err.message, order_id: order.order_id });
  }

  logInfo('Paiement matériel confirmé', { order_id: order.order_id });
  return {
    ok: true,
    order_id: order.order_id,
    materiel: true,
    redirect: `/success.html?order=${order.order_id}&type=materiel`,
  };
}

async function fulfillStripeSession(sessionId, stripeSession = null, lifecycleMode = false) {
  const materielPending = loadPendingCheckout(sessionId);
  if (materielPending?.order_type === 'materiel') {
    return fulfillMaterielCheckout(sessionId, stripeSession);
  }

  let pending = loadPendingOrder(sessionId);
  if (!pending && stripeSession?.metadata) {
    pending = unpackOrderMetadata(stripeSession.metadata);
  }
  if (!pending) {
    return { ok: false, error: 'pending_not_found' };
  }

  if (lifecycleMode && pending.lifecycle_order_id) {
    const order = loadOrder(pending.lifecycle_order_id);
    if (order) {
      markPaymentPaid(order.order_id, {
        method: 'stripe',
        stripe_session_id: sessionId,
        iban: pending.payment?.iban || pending.customer_full?.iban,
      });
      removePendingOrder(sessionId);
      return {
        ok: true,
        order_id: order.order_id,
        lifecycle: true,
        redirect: `/inscription?order=${order.order_id}&token=${order.access_token}&step=4`,
      };
    }
  }

  const payload = {
    ...pending,
    order_id: pending.order_id || `STORE-${sessionId.slice(-8)}`,
    payment_method: 'stripe',
    stripe_session_id: sessionId,
  };
  const result = await dispatchOrder(payload);
  removePendingOrder(sessionId);
  logInfo('Paiement Stripe → BOXPLUS', { order_id: payload.order_id, queued: result.queued });
  return { ok: true, order_id: payload.order_id, queued: result.queued, result };
}

function createApp() {
  const app = express();

  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      if (!stripe) return res.status(503).json({ ok: false, error: 'stripe_not_configured' });

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
          const materielPending = loadPendingCheckout(session.id);
          if (materielPending?.order_type === 'materiel') {
            await fulfillMaterielCheckout(session.id, session);
          } else {
            const pending = loadPendingOrder(session.id);
            if (!pending) {
              logError('Session Stripe sans commande pending', { session_id: session.id });
            } else {
              await fulfillStripeSession(session.id, session, Boolean(pending.lifecycle_order_id));
            }
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

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, vercel: Boolean(process.env.VERCEL) });
  });

  app.get('/api/products', (req, res) => {
    try {
      const catalog = getStoreProducts();
      const tab = req.query.tab || null;
      const subsection = req.query.subsection || null;
      const featured = req.query.featured ? Number(req.query.featured) : null;

      if (featured) {
        return res.json({
          synced_at: catalog.synced_at,
          products: getFeaturedProducts(featured),
        });
      }

      const products = getEnrichedProducts({ tab, subsection, activeOnly: req.query.all !== '1' });
      res.json({
        synced_at: catalog.synced_at,
        source: catalog.source || (catalog.synced_at ? 'deciplus' : 'static'),
        products,
      });
    } catch (err) {
      logError('Erreur /api/products', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/materiel', (req, res) => {
    try {
      const catalog = loadMaterielCatalog();
      const products = getMaterielProducts({
        category: req.query.category || null,
        activeOnly: req.query.all !== '1',
        q: req.query.q || null,
      });
      res.json({
        synced_at: catalog.synced_at,
        source: catalog.source,
        categories: getMaterielCategories(),
        products,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/materiel/:id', (req, res) => {
    try {
      const product = findMaterielProduct(req.params.id);
      if (!product) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ product });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/cart/checkout', async (req, res) => {
    try {
      const { lines, customer } = req.body;
      const { errors: cartErrors, items, total_cents } = validateCartLines(lines);
      if (cartErrors.length) return res.status(400).json({ ok: false, errors: cartErrors });

      const formErrors = validateCustomerForm(customer || {});
      if (formErrors.length) return res.status(400).json({ ok: false, errors: formErrors });

      const orderId = `MAT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

      if (!stripe) {
        if (String(process.env.STORE_DEMO_ENABLED || 'false') === 'true') {
          const order = createMaterielOrder({
            customer,
            items,
            total_cents,
            pickup_gym: customer.pickup_gym,
          });
          markMaterielPaid(order.order_id, { method: 'demo' });
          await sendMaterielConfirmationEmail(order).catch(() => {});
          return res.json({
            ok: true,
            mode: 'demo',
            order_id: order.order_id,
            redirect: `/success.html?order=${order.order_id}&type=materiel&demo=1`,
          });
        }
        return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
      }

      const baseUrl = getCheckoutBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: buildStripeLineItems(items),
        customer_email: customer.email,
        metadata: {
          order_type: 'materiel',
          order_id: orderId,
        },
        success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&order=${orderId}&type=materiel`,
        cancel_url: `${baseUrl}/panier?cancelled=1`,
      });

      savePendingCheckout(session.id, {
        order_type: 'materiel',
        order_id: orderId,
        customer,
        pickup_gym: customer.pickup_gym,
        items,
        total_cents,
      });

      res.json({ ok: true, mode: 'stripe', url: session.url, session_id: session.id, order_id: orderId });
    } catch (err) {
      logError('Erreur checkout matériel', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/ingest-materiel-catalog', (req, res) => {
    if (!isAuthorizedSync(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const payload = req.body;
      if (!payload?.products?.length) {
        return res.status(400).json({ ok: false, error: 'products requis' });
      }
      const catalog = {
        ...loadMaterielCatalog(),
        ...payload,
        synced_at: new Date().toISOString(),
      };
      saveMaterielCatalog(catalog);
      res.json({ ok: true, count: catalog.products.length, synced_at: catalog.synced_at });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/sync-materiel', async (req, res) => {
    if (!isAuthorizedAdmin(req) && !isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const { syncMaterielFromPrestaShop } = require('./scripts/sync-prestashop-materiel');
      const result = await syncMaterielFromPrestaShop();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/config', (_req, res) => {
    try {
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
        badge_fee_notice: BADGE_FEE_NOTICE,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/cron/sync-catalog', async (req, res) => {
    if (!isAuthorizedSync(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { runCatalogSyncIfNeeded } = require('./lib/auto-sync');
    const result = await runCatalogSyncIfNeeded({ force: true });
    res.json({ ok: result.ok !== false, ...result });
  });

  app.post('/api/admin/ingest-catalog', (req, res) => {
    if (!isAuthorizedSync(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const payload = ingestCatalogPayload(req.body);
      res.json({ ok: true, count: payload.count, synced_at: payload.synced_at });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/admin/merch', (req, res) => {
    if (!isAuthorizedAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const products = getEnrichedProducts({ activeOnly: false });
    const merch = loadMerch();
    res.json({ featured_home: merch.featured_home, products });
  });

  app.put('/api/admin/merch', (req, res) => {
    if (!isAuthorizedAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const { product_id, patch } = req.body;
      if (!product_id) return res.status(400).json({ ok: false, error: 'product_id requis' });
      updateMerchProduct(product_id, patch);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/merch/featured', (req, res) => {
    if (!isAuthorizedAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const ids = req.body.ids || [];
    if (ids.length > 3) return res.status(400).json({ ok: false, error: 'max 3 offres featured' });
    setFeaturedHome(ids);
    res.json({ ok: true, featured_home: ids });
  });

  app.post('/api/orders/draft', (req, res) => {
    try {
      const { product_id, ...customer_short } = req.body;
      const product = findProduct(product_id);
      if (!product) return res.status(404).json({ ok: false, error: 'Produit introuvable' });

      const errors = validateShortForm(customer_short);
      if (errors.length) return res.status(400).json({ ok: false, errors });

      const order = createDraft({ product_id, product, customer_short });
      res.json({
        ok: true,
        order_id: order.order_id,
        access_token: order.access_token,
        step: order.step,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = loadOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, req.query.token)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const { access_token, ...safe } = order;
    res.json({ ok: true, order: safe });
  });

  app.get('/api/orders/:id/status', (req, res) => {
    const order = loadOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, req.query.token)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    res.json({
      ok: true,
      order_id: order.order_id,
      step: order.step,
      payment_status: order.payment?.status,
      product: order.product_snapshot?.display_name || order.product_snapshot?.name,
      dispatched: Boolean(order.dispatched_at),
      email_sent: Boolean(order.email_sent_at),
    });
  });

  app.patch('/api/orders/:id/profile', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'rib_file', maxCount: 1 }]), (req, res) => {
    try {
      const order = loadOrder(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, req.body.token || req.query.token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      const product = findProduct(order.product_id) || order.product_snapshot;
      const full = { ...req.body };
      if (req.files?.photo?.[0]) full.photo_path = req.files.photo[0].path;
      if (req.files?.rib_file?.[0]) full.rib_path = req.files.rib_file[0].path;
      if (!full.iban && order.payment?.iban) full.iban = order.payment.iban;

      const errors = validateFullForm(full, product);
      if (errors.length) return res.status(400).json({ ok: false, errors });

      updateFullProfile(order.order_id, full);
      res.json({ ok: true, step: 5 });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/orders/:id/sign', async (req, res) => {
    try {
      const order = loadOrder(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, req.body.token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      const { consent_cgv, consent_reglement } = req.body;
      if (!consent_cgv || !consent_reglement) {
        return res.status(400).json({ ok: false, error: 'Consentements requis' });
      }

      const signed = recordSignature(order.order_id, {
        consent_cgv: Boolean(consent_cgv),
        consent_reglement: Boolean(consent_reglement),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      });

      const { filepath, filename } = await generateContractPdf(signed);
      signed.documents = { contract_pdf: filepath, contract_filename: filename };
      const { saveOrder } = require('./lib/order-lifecycle');
      saveOrder(signed);

      await dispatchLifecycleOrder(signed);

      const emailResult = await sendConfirmationEmail(signed, [
        { filepath, filename },
      ]);
      if (emailResult.sent) markEmailSent(signed.order_id);

      res.json({
        ok: true,
        step: 6,
        order_id: signed.order_id,
        email_sent: emailResult.sent,
        status_url: `/mon-inscription?order=${signed.order_id}&token=${signed.access_token}`,
      });
    } catch (err) {
      logError('Erreur signature', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/orders/:id/contract.pdf', (req, res) => {
    const order = loadOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, req.query.token)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    streamContractPdf(order, res);
  });

  app.post('/api/orders/:id/pay', async (req, res) => {
    try {
      const order = loadOrder(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, req.body.token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      const product = findProduct(order.product_id) || order.product_snapshot;
      const paymentErrors = validatePaymentForm(req.body, product);
      if (paymentErrors.length) return res.status(400).json({ ok: false, errors: paymentErrors });

      const short = order.customer_short;
      const form = { ...short, ...req.body, order_id: order.order_id };

      if (!product.requires_payment) {
        markPaymentPaid(order.order_id, { method: 'free', status: 'paid' });
        return res.json({
          ok: true,
          mode: 'free',
          redirect: `/inscription?order=${order.order_id}&token=${order.access_token}&step=4`,
        });
      }

      if (!stripe) {
        if (String(process.env.STORE_DEMO_ENABLED || 'false') === 'true') {
          markPaymentPaid(order.order_id, { method: 'demo', iban: req.body.iban });
          return res.json({
            ok: true,
            mode: 'demo',
            redirect: `/inscription?order=${order.order_id}&token=${order.access_token}&step=4`,
          });
        }
        return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
      }

      const payload = buildOrderPayload(
        { ...form, gym: req.body.gym || 'minimes', gender: req.body.gender || 'M', iban: req.body.iban },
        product
      );
      payload.lifecycle_order_id = order.order_id;
      if (req.body.iban) payload.payment = { ...payload.payment, iban: req.body.iban };

      const baseUrl = getCheckoutBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: product.price_cents,
              product_data: { name: product.display_name || product.name },
            },
            quantity: 1,
          },
        ],
        customer_email: short.email,
        metadata: {
          product_id: product.id,
          order_id: order.order_id,
          lifecycle_order_id: order.order_id,
          ...packOrderMetadata(payload),
        },
        success_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=4&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/inscription?order=${order.order_id}&token=${order.access_token}&step=3&cancelled=1`,
      });

      savePendingOrder(session.id, payload);
      res.json({ ok: true, mode: 'stripe', url: session.url, session_id: session.id });
    } catch (err) {
      logError('Erreur pay order', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/gdpr/erase-request', async (req, res) => {
    try {
      const { email, message } = req.body;
      if (!email) return res.status(400).json({ ok: false, error: 'email requis' });
      await sendGdprEraseRequest({ email, message });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
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
        return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
      }

      const baseUrl = getCheckoutBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: product.price_cents,
              product_data: { name: product.name, description: product.description },
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
        success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&order=${encodeURIComponent(orderId)}&product=${encodeURIComponent(product.id)}`,
        cancel_url: `${baseUrl}/checkout.html?product=${product.id}&cancelled=1`,
      });

      savePendingOrder(session.id, payload);
      res.json({ ok: true, mode: 'stripe', url: session.url, session_id: session.id });
    } catch (err) {
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
        return res.status(402).json({ ok: false, error: 'payment_not_completed' });
      }

      const materielPending = loadPendingCheckout(sessionId);
      if (materielPending?.order_type === 'materiel') {
        const out = await fulfillMaterielCheckout(sessionId, session);
        if (!out.ok && out.error === 'pending_not_found') {
          return res.json({ ok: true, already_processed: true, materiel: true });
        }
        if (!out.ok) return res.status(500).json(out);
        return res.json({ ok: true, ...out });
      }

      const pending = loadPendingOrder(sessionId);
      const out = await fulfillStripeSession(sessionId, session, Boolean(pending?.lifecycle_order_id));
      if (!out.ok && out.error === 'pending_not_found') {
        return res.json({ ok: true, already_processed: true });
      }
      if (!out.ok) return res.status(500).json(out);
      res.json({ ok: true, ...out });
    } catch (err) {
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
      const payload = buildOrderPayload({ ...form, order_id: orderId, payment_method: 'demo' }, product);
      const result = await dispatchOrder(payload);
      res.json({
        ok: true,
        mode: 'demo',
        order_id: orderId,
        queued: result.queued,
        redirect: `/success.html?order=${encodeURIComponent(orderId)}&demo=1`,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  const pageRoutes = {
    '/abonnements': 'abonnements.html',
    '/seance-essai': 'seance-essai.html',
    '/coachings': 'coachings.html',
    '/materiel': 'materiel.html',
    '/materiel/produit': 'materiel-produit.html',
    '/panier': 'panier.html',
    '/inscription': 'inscription.html',
    '/faq': 'faq.html',
    '/politique-confidentialite': 'legal/confidentialite.html',
    '/mon-inscription': 'mon-inscription.html',
    '/checkout.html': 'checkout.html',
    '/admin': 'admin/index.html',
  };

  for (const [route, file] of Object.entries(pageRoutes)) {
    app.get(route, (_req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, file));
    });
  }

  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(express.static(PUBLIC_DIR));

  app.use((err, _req, res, _next) => {
    logError('Erreur Express', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
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
    logInfo(`Boutique Boxing Center → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    logInfo(stripe ? 'Stripe: activé' : 'Stripe: mode démo');
    logInfo('Catalogue', { count: catalog.products?.length, synced_at: catalog.synced_at });
  });
}

if (require.main === module) {
  main();
}

module.exports = { createApp, findProduct };
