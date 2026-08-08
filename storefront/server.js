#!/usr/bin/env node
/**
 * Boutique Boxing Center — Stripe → BOXPLUS, tunnel 8 étapes
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { logInfo, logError, logWarn } = require('../lib/logger');
const { getStoreUrl, getCheckoutBaseUrl, getBridgeUrl, PRODUCTION_STORE_URL } = require('../lib/app-urls');
const {
  buildOrderPayload,
  buildOrderFromLifecycle,
  validateCheckoutForm,
  validateShortForm,
  validateFullForm,
  validatePaymentForm,
  validateIbanForm,
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
  createCheckoutSessionParams,
  isStripeCheckoutPaid,
  stripeClientForGym,
} = require('./lib/stripe-checkout');
const {
  normalizeBillingPlan,
  normalizePaymentPlan,
  productSupportsInstallmentChoice,
  requiresIbanForPlan,
} = require('../lib/billing-plan');
const {
  createFourTimesPayment,
  retrievePayment,
  isPayplugPaymentPaid,
  isPayplugPaymentPending,
  isPayplugEnabled,
  hostedPaymentUrl,
} = require('./lib/payplug');
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
  addMaterielProduct,
  updateMerchProduct,
  updateMerchProductAsync,
  updateMaterielProduct,
  setFeaturedHome,
  setFeaturedHomeAsync,
  createManualOffer,
  loadMerchFresh,
  hydrateMerchOnce,
  saveMerchAsync,
  normalizeFeaturedIds,
  getOffreRentree,
  setOffreRentreeAsync,
  placesRestantes,
} = require('./lib/merch');
const {
  validateCartLines,
  validateCustomerForm,
  buildStripeLineItems,
  createMaterielOrder,
  createMaterielOrderAsync,
  markMaterielPaid,
  markMaterielPaidAsync,
  savePendingCheckout,
  loadPendingCheckout,
  removePendingCheckout,
  listAllMaterielOrdersAsync,
  loadOrderAsync: loadMaterielOrderAsync,
  saveOrderAsync: saveMaterielOrderRecordAsync,
} = require('./lib/materiel-cart');
const {
  sendMaterielConfirmationEmail,
  sendConfirmationEmail,
  sendGdprEraseRequest,
  sendUnpaidSubscriptionEmail,
  sendNewMemberAdminEmail,
} = require('./lib/mailer');
const {
  STEPS,
  createDraft,
  createDraftAsync,
  loadOrder,
  loadOrderAsync,
  verifyAccess,
  updateShortProfile,
  updateGymAsync,
  updateIbanAsync,
  markPaymentPaid,
  markPaymentFailed,
  updateFullProfile,
  recordSignature,
  markEmailSent,
  markSubscriptionPastDueAsync,
  findOrderBySubscriptionId,
  getUploadDir,
  listAllOrders,
  listAllOrdersAsync,
  deleteOrderAsync,
  toAdminSummary,
} = require('./lib/order-lifecycle');
const { generateContractPdf, streamContractPdf } = require('./lib/contract-pdf');
const { generateMaterielInvoicePdf } = require('./lib/invoice-pdf');
const { upsertClientFromInscription, upsertMaterielClient } = require('./lib/client-sync');

async function syncInscriptionClient(order) {
  const result = await upsertClientFromInscription(order);
  if (result.synced && result.client_id && order.gestion_client_id !== result.client_id) {
    order.gestion_client_id = result.client_id;
    const { saveOrderAsync } = require('./lib/order-lifecycle');
    await saveOrderAsync(order);
  }
  return result;
}

async function syncMaterielClient(order) {
  const result = await upsertMaterielClient(order);
  if (result.synced && result.client_id && order.gestion_client_id !== result.client_id) {
    order.gestion_client_id = result.client_id;
    await saveMaterielOrderRecordAsync(order);
  }
  return result;
}

const { rebuildLifecycleOrderFromSession, loadOrderOrRecover } = require('./lib/order-recovery');
const { verifyAdminLogin } = require('./lib/admin-auth');
const {
  getAdminSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
} = require('./lib/admin-session');

const PORT = Number(process.env.STORE_PORT || 3040);
const HOST = process.env.STORE_HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STORE_URL = getStoreUrl();
const SYNC_SECRET = process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

function makeUploader(subdir) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, getUploadDir(subdir));
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${req.params.id || 'upload'}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
  });
}

const upload = makeUploader('ribs');
const uploadPhoto = makeUploader('photos');

function stripeForGym(gym) {
  try {
    return stripeClientForGym(gym).stripe;
  } catch {
    return stripe;
  }
}

function stripeForOrder(order) {
  return stripeForGym(order?.customer_full?.gym || order?.payment?.gym);
}

/**
 * Le webhook Stripe peut arriver après le retour navigateur : avant de refuser
 * avec payment_required, on revérifie la session Stripe en direct et on marque
 * la commande payée si le paiement est bien encaissé.
 */
async function refreshPaymentFromStripe(order, sessionIdHint) {
  if (!order || order.payment?.status === 'paid') return order;
  const sessionId = sessionIdHint || order.payment?.stripe_session_id;
  if (!sessionId) return order;
  try {
    const client = stripeForOrder(order) || stripe;
    if (!client) return order;
    const session = await client.checkout.sessions.retrieve(sessionId);
    const lifecycleId = session.metadata?.lifecycle_order_id || session.metadata?.order_id;
    if (isStripeCheckoutPaid(session) && (!lifecycleId || lifecycleId === order.order_id)) {
      const updated = await markPaymentPaid(order.order_id, {
        method: 'stripe',
        stripe_session_id: session.id,
        stripe_subscription_id: session.subscription || order.payment?.stripe_subscription_id || null,
        iban: order.payment?.iban,
        billing_plan: session.metadata?.billing_plan || order.payment?.billing_plan,
      });
      logInfo('Paiement confirmé via revérification Stripe', { order_id: order.order_id });
      return updated || order;
    }
  } catch (err) {
    logWarn('Revérification Stripe échouée', { order_id: order.order_id, error: err.message });
  }
  return order;
}

function inscriptionRedirect(order, stepOverride) {
  const step = stepOverride || order.step || STEPS.PAYMENT;
  const sid = order.payment?.stripe_session_id
    ? `&session_id=${encodeURIComponent(order.payment.stripe_session_id)}`
    : '';
  return `/inscription?order=${order.order_id}&token=${order.access_token}&step=${step}${sid}`;
}

function isAuthorizedSync(req) {
  if (!SYNC_SECRET) return false;
  const header = req.headers['x-sync-secret'] || req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return token === SYNC_SECRET;
}

async function isAuthorizedAdmin(req) {
  const session = await getAdminSession(req);
  if (session) return true;
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
  if (!payload.photo_base64 && !payload.photo_path) {
    logWarn('Dispatch bot sans photo membre', { order_id: order.order_id });
  }
  const result = await dispatchOrder(payload);
  order.dispatched_at = new Date().toISOString();
  order.dispatch_result = { queued: result.queued, forwarded: result.forwarded };
  const { saveOrderAsync } = require('./lib/order-lifecycle');
  await saveOrderAsync(order);
  logInfo('Commande lifecycle → BOXPLUS', { order_id: order.order_id, queued: result.queued });
  return result;
}

async function sendMaterielEmailIfNeeded(order) {
  if (order.email_sent) return order;
  try {
    const emailResult = await sendMaterielConfirmationEmail(order);
    order.email_sent = emailResult.sent;
    await saveMaterielOrderRecordAsync(order);
  } catch (err) {
    logError('Email matériel échoué', { error: err.message, order_id: order.order_id });
  }
  return order;
}

async function fulfillMaterielCheckout(sessionId, stripeSession = null) {
  if (stripeSession && !isStripeCheckoutPaid(stripeSession)) {
    return { ok: false, error: 'payment_not_completed', payment_status: stripeSession.payment_status };
  }

  const pending = loadPendingCheckout(sessionId);
  const orderId = pending?.order_id || stripeSession?.metadata?.order_id;

  if (!orderId) {
    return { ok: false, error: 'pending_not_found' };
  }

  let order = await loadMaterielOrderAsync(orderId);

  if (!order && pending) {
    order = await createMaterielOrderAsync({
      order_id: pending.order_id,
      customer: pending.customer,
      items: pending.items,
      total_cents: pending.total_cents,
      pickup_gym: pending.pickup_gym,
    });
  }

  if (!order) {
    return { ok: false, error: 'order_not_found' };
  }

  if (order.payment?.status === 'paid') {
    await sendMaterielEmailIfNeeded(order);
    return { ok: true, order_id: order.order_id, materiel: true, already_processed: true };
  }

  order = await markMaterielPaidAsync(order.order_id, {
    method: 'stripe',
    stripe_session_id: sessionId,
  });

  if (!order) {
    return { ok: false, error: 'mark_paid_failed' };
  }

  removePendingCheckout(sessionId);
  await sendMaterielEmailIfNeeded(order);

  syncMaterielClient(order).catch((err) =>
    logError('Sync client matériel', { error: err.message, order_id: order.order_id })
  );

  logInfo('Paiement matériel confirmé', { order_id: order.order_id });
  return {
    ok: true,
    order_id: order.order_id,
    materiel: true,
    redirect: `/success.html?order=${order.order_id}&type=materiel`,
  };
}

async function fulfillStripeSession(sessionId, stripeSession = null, lifecycleMode = false) {
  if (stripeSession && !isStripeCheckoutPaid(stripeSession)) {
    return { ok: false, error: 'payment_not_completed', payment_status: stripeSession.payment_status };
  }

  const materielPending = loadPendingCheckout(sessionId);
  if (
    materielPending?.order_type === 'materiel' ||
    stripeSession?.metadata?.order_type === 'materiel'
  ) {
    return fulfillMaterielCheckout(sessionId, stripeSession);
  }

  let pending = loadPendingOrder(sessionId);
  if (!pending && stripeSession?.metadata) {
    pending = unpackOrderMetadata(stripeSession.metadata);
  }
  if (!pending) {
    return { ok: false, error: 'pending_not_found' };
  }

  const lifecycleOrderId =
    pending.lifecycle_order_id || stripeSession?.metadata?.lifecycle_order_id;

  if (lifecycleMode && lifecycleOrderId) {
    let order = await loadOrderAsync(lifecycleOrderId);
    if (!order && stripeSession?.metadata?.bc_token) {
      order = await rebuildLifecycleOrderFromSession(stripeSession, {
        accessToken: stripeSession.metadata.bc_token,
        findProduct,
      });
    }
    if (order) {
      if (order.payment?.status !== 'paid') {
        await markPaymentPaid(order.order_id, {
          method: 'stripe',
          stripe_session_id: sessionId,
          stripe_subscription_id: stripeSession?.subscription || null,
          billing_plan:
            stripeSession?.metadata?.billing_plan ||
            pending?.payment?.billing_plan ||
            pending?.billing_plan ||
            null,
          iban: pending.payment?.iban || pending.customer_full?.iban,
        });
        order = await loadOrderAsync(order.order_id);
      }
      removePendingOrder(sessionId);
      return {
        ok: true,
        order_id: order.order_id,
        lifecycle: true,
        redirect: inscriptionRedirect(order),
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
          if (!isStripeCheckoutPaid(session)) {
            logInfo('Stripe checkout terminé sans paiement encaissé', {
              session_id: session.id,
              payment_status: session.payment_status,
            });
          } else {
            const materielPending = loadPendingCheckout(session.id);
            if (
              materielPending?.order_type === 'materiel' ||
              session.metadata?.order_type === 'materiel'
            ) {
              await fulfillMaterielCheckout(session.id, session);
            } else {
              const pending =
                loadPendingOrder(session.id) || unpackOrderMetadata(session.metadata);
              const lifecycleMode = Boolean(
                pending?.lifecycle_order_id || session.metadata?.lifecycle_order_id
              );
              if (!pending && !lifecycleMode) {
                logError('Session Stripe sans commande pending', { session_id: session.id });
              } else {
                await fulfillStripeSession(session.id, session, lifecycleMode);
              }
            }
          }
        } else if (event.type === 'checkout.session.async_payment_failed') {
          const session = event.data.object;
          const orderId = session.metadata?.lifecycle_order_id || session.metadata?.order_id;
          if (orderId) {
            await markPaymentFailed(orderId, {
              stripe_session_id: session.id,
              failure_reason: 'async_payment_failed',
            });
            logWarn('Paiement Stripe échoué (async)', { order_id: orderId, session_id: session.id });
          }
        } else if (event.type === 'invoice.paid') {
          const invoice = event.data.object;
          if (invoice.subscription) {
            const order = await findOrderBySubscriptionId(invoice.subscription);
            if (order && order.payment?.status === 'past_due') {
              order.payment = {
                ...order.payment,
                status: 'paid',
                past_due_cleared_at: new Date().toISOString(),
              };
              order.access_blocked = false;
              const { saveOrderAsync } = require('./lib/order-lifecycle');
              await saveOrderAsync(order);
            }
            logInfo('Abonnement CB renouvelé (Stripe)', {
              subscription: invoice.subscription,
              amount_cents: invoice.amount_paid,
              order_id: order?.order_id,
              customer: invoice.customer_email || invoice.customer,
            });
          }
        } else if (event.type === 'invoice.payment_failed') {
          const invoice = event.data.object;
          const subId = invoice.subscription;
          if (subId) {
            let order = await findOrderBySubscriptionId(subId);
            if (!order && invoice.metadata?.lifecycle_order_id) {
              order = await loadOrderAsync(invoice.metadata.lifecycle_order_id);
            }
            if (order) {
              const alreadyNotified = Boolean(order.payment?.unpaid_notified_at);
              const failCount = Number(order.payment?.fail_count || 0) + 1;
              const blockAfter = Number(process.env.STRIPE_UNPAID_BLOCK_AFTER || 3);
              const block = failCount >= blockAfter;
              await markSubscriptionPastDueAsync(order.order_id, {
                stripe_subscription_id: subId,
                stripe_invoice_id: invoice.id,
                fail_count: failCount,
                access_blocked: block,
                failure_reason: 'invoice.payment_failed',
              });
              let portalUrl = null;
              try {
                if (stripe && invoice.customer) {
                  const portal = await stripe.billingPortal.sessions.create({
                    customer: invoice.customer,
                    return_url: `${STORE_URL}/mon-inscription?order=${order.order_id}&token=${order.access_token}`,
                  });
                  portalUrl = portal.url;
                }
              } catch (portalErr) {
                logWarn('Portal Stripe indisponible', { error: portalErr.message });
              }
              // Alerte client dès le 1er échec ; alerte admin renforcée dès 3 tentatives / blocage
              if (!alreadyNotified || block) {
                const mail = await sendUnpaidSubscriptionEmail(order, {
                  portalUrl,
                  failCount,
                  accessBlocked: block,
                  adminAlert: block,
                });
                if (mail.sent && !alreadyNotified) {
                  await markSubscriptionPastDueAsync(order.order_id, {
                    stripe_subscription_id: subId,
                    fail_count: failCount,
                    access_blocked: block,
                    unpaid_notified_at: new Date().toISOString(),
                  });
                }
              }
              logWarn('Impayé abonnement CB Stripe', {
                order_id: order.order_id,
                subscription: subId,
                fail_count: failCount,
                access_blocked: block,
              });
            } else {
              logWarn('invoice.payment_failed sans commande liée', {
                subscription: subId,
                invoice: invoice.id,
              });
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

  app.use(express.json({ limit: '2mb' }));

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const user = await verifyAdminLogin(email, password);
      if (!user) {
        return res.status(401).json({ ok: false, error: 'Email ou mot de passe incorrect' });
      }
      await setAdminSessionCookie(res, user);
      res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    const session = await getAdminSession(req);
    if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });
    res.json({ ok: true, user: session });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, vercel: Boolean(process.env.VERCEL) });
  });

  app.get('/api/products', async (req, res) => {
    try {
      await hydrateMerchOnce();
      const catalog = getStoreProducts();
      const tab = req.query.tab || null;
      const subsection = req.query.subsection || null;
      const featured = req.query.featured ? Number(req.query.featured) : null;

      if (featured) {
        const merch = loadMerch();
        return res.json({
          synced_at: catalog.synced_at,
          featured_home: merch.featured_home || [],
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

  app.get('/api/products/:id', async (req, res) => {
    try {
      await hydrateMerchOnce();
      const product = findProduct(req.params.id);
      if (!product) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, product });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /* ==================================================================
     LES PLACES DE L'OFFRE DE RENTRÉE — pilotées par le patron.

     Les quatre sites du club affichent « plus que N places ». Ce N est une
     DÉCISION COMMERCIALE, pas un calcul : c'est le patron qui ouvre un
     nombre de places à ce prix et qui dit où en est le compte. Il le règle
     dans l'onglet « Offres » du panneau ; les sites ne font que l'afficher.

     Le compte descend ensuite tout seul à chaque inscription payée en
     ligne — mais une place vendue au comptoir n'existe nulle part ailleurs,
     donc il peut réajuster quand il veut. C'est lui qui a le dernier mot,
     et lui seul voit le chiffre exact dans la boutique.

     La lecture est publique et anonyme : deux nombres et une date, aucune
     donnée personnelle. CORS ouvert parce que les quatre sites du club
     l'appellent depuis leurs propres domaines.
     ================================================================== */
  const IDS_OFFRE = ['offre-duo', 'offre-saison'];

  /** Inscriptions payées en ligne sur les offres concernées. */
  async function ventesOffreEnLigne() {
    const orders = await listAllOrdersAsync();
    /* L'identifiant de l'offre ne vit pas toujours au même endroit selon
       l'ancienneté de la commande : `product_snapshot.id` pour les récentes,
       `legacy_id` pour celles importées de PrestaShop, `product_id` à plat
       pour les plus anciennes. On regarde les trois — un compteur qui
       interroge le mauvais champ ne bouge jamais et personne ne le remarque. */
    return orders.filter((o) => {
      if (o.payment?.status !== 'paid') return false;
      const s = o.product_snapshot || {};
      return IDS_OFFRE.includes(s.id) || IDS_OFFRE.includes(s.legacy_id) || IDS_OFFRE.includes(o.product_id);
    }).length;
  }

  app.get('/api/offre-rentree/places', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=60');
    try {
      await loadMerchFresh();
      const ventes = await ventesOffreEnLigne();
      const o = placesRestantes(ventes);
      res.json({ ok: true, quota: o.quota, restantes: o.restantes, fin: o.fin || null });
    } catch (err) {
      /* En panne, on ne devine pas un nombre : on dit qu'on ne sait pas, et
         les sites n'affichent alors aucun compteur. */
      res.json({ ok: false, error: err.message });
    }
  });

  /** Le réglage, réservé au patron : il voit le compte exact et le pose. */
  app.get('/api/admin/offre-rentree', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      await loadMerchFresh();
      const ventes = await ventesOffreEnLigne();
      const brut = getOffreRentree();
      const vu = placesRestantes(ventes);
      res.json({ ok: true, reglage: brut, ventes_en_ligne: ventes, affiche: vu.restantes });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/admin/offre-rentree', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      await loadMerchFresh();
      const ventes = await ventesOffreEnLigne();
      const neuf = await setOffreRentreeAsync(req.body || {}, ventes);
      logInfo('Offre de rentrée réglée', { quota: neuf.quota, restantes: neuf.restantes, fin: neuf.fin });
      res.json({ ok: true, reglage: neuf, ventes_en_ligne: ventes, affiche: neuf.restantes });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
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
          const order = await createMaterielOrderAsync({
            customer,
            items,
            total_cents,
            pickup_gym: customer.pickup_gym,
          });
          await markMaterielPaidAsync(order.order_id, { method: 'demo' });
          await syncMaterielClient(order).catch(() => {});
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
      const order = await createMaterielOrderAsync({
        order_id: orderId,
        customer,
        items,
        total_cents,
        pickup_gym: customer.pickup_gym,
      });
      await syncMaterielClient(order).catch((err) =>
        logError('Sync client matériel (checkout)', { order_id: orderId, error: err.message })
      );

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'paypal'],
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
    if (!(await isAuthorizedAdmin(req)) && !isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const { syncMaterielFromPrestaShop } = require('./lib/sync-prestashop-materiel');
      const result = await syncMaterielFromPrestaShop();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/admin/materiel', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const catalog = loadMaterielCatalog();
      const products = getMaterielProducts({ activeOnly: false });
      res.json({ ok: true, synced_at: catalog.synced_at, categories: getMaterielCategories(), products });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/admin/materiel/:id', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const { id } = req.params;
      const patch = req.body || {};
      const updated = updateMaterielProduct(id, patch);
      const product = findMaterielProduct(id);
      res.json({ ok: true, id, updated, product });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Create new custom materiel product (with optional base64 image)
  app.post('/api/admin/materiel', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const fields = req.body || {};
      if (!fields.name) return res.status(400).json({ ok: false, error: 'name requis' });
      const product = addMaterielProduct(fields);
      res.json({ ok: true, product });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // Stats admin — ventes + funnel + visites
  app.get('/api/admin/stats', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const { summarizeVisits, summarizeFunnelFromOrders, summarizeFunnelEvents } = require('./lib/analytics');
      const { from, to } = req.query; // format: YYYY-MM

      function monthKey(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      function inRange(key) {
        if (!key) return false;
        if (from && key < from) return false;
        if (to && key > to) return false;
        return true;
      }

      // Materiel orders
      const materielOrders = (await listAllMaterielOrdersAsync()).filter(
        (o) => o.payment?.status === 'paid'
      );
      const materielByMonth = {};
      for (const o of materielOrders) {
        const k = monthKey(o.paid_at || o.created_at);
        if (!k || !inRange(k)) continue;
        if (!materielByMonth[k]) materielByMonth[k] = { month: k, orders: 0, revenue: 0 };
        materielByMonth[k].orders += 1;
        materielByMonth[k].revenue += o.total_cents || 0;
      }

      // Inscription orders
      const allOrders = await listAllOrdersAsync();
      const inscByMonth = {};
      for (const o of allOrders) {
        if (o.payment?.status !== 'paid') continue;
        const k = monthKey(o.payment?.paid_at || o.updated_at || o.created_at);
        if (!k || !inRange(k)) continue;
        if (!inscByMonth[k]) inscByMonth[k] = { month: k, orders: 0, revenue: 0 };
        inscByMonth[k].orders += 1;
        inscByMonth[k].revenue += o.product_snapshot?.price_cents || 0;
      }

      const months = [...new Set([...Object.keys(materielByMonth), ...Object.keys(inscByMonth)])].sort();

      const rows = months.map((m) => ({
        month: m,
        materiel_orders: materielByMonth[m]?.orders || 0,
        materiel_revenue: materielByMonth[m]?.revenue || 0,
        inscription_orders: inscByMonth[m]?.orders || 0,
        inscription_revenue: inscByMonth[m]?.revenue || 0,
      }));

      const totals = rows.reduce(
        (acc, r) => ({
          materiel_orders: acc.materiel_orders + r.materiel_orders,
          materiel_revenue: acc.materiel_revenue + r.materiel_revenue,
          inscription_orders: acc.inscription_orders + r.inscription_orders,
          inscription_revenue: acc.inscription_revenue + r.inscription_revenue,
        }),
        { materiel_orders: 0, materiel_revenue: 0, inscription_orders: 0, inscription_revenue: 0 }
      );

      const unpaid = allOrders
        .filter((o) => o.payment?.status === 'past_due' || o.access_blocked)
        .map(toAdminSummary);

      res.json({
        ok: true,
        rows,
        totals,
        visits: summarizeVisits(30),
        funnel: summarizeFunnelFromOrders(allOrders),
        funnel_events: summarizeFunnelEvents(30),
        unpaid,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/analytics/event', (req, res) => {
    try {
      const { trackPageview, trackEvent } = require('./lib/analytics');
      const { type, name, path: pagePath, props, referrer } = req.body || {};
      if (type === 'pageview') {
        trackPageview({
          path: pagePath || req.headers.referer || '/',
          referrer,
          ua: req.headers['user-agent'],
        });
      } else {
        trackEvent({ name: name || 'event', props, path: pagePath });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Public invoice download for materiel orders (token-gated by order_id)
  app.get('/api/facture/materiel/:orderId', async (req, res) => {
    try {
      const order = await loadMaterielOrderAsync(req.params.orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });
      if (order.payment?.status !== 'paid') {
        return res.status(403).json({ ok: false, error: 'Facture disponible uniquement après paiement' });
      }
      const result = await generateMaterielInvoicePdf(order);
      if (!result?.filepath) {
        return res.status(500).json({ ok: false, error: 'Génération PDF échouée' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="facture-${order.order_id}.pdf"`
      );
      require('fs').createReadStream(result.filepath).pipe(res);
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

  app.get('/api/admin/merch', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    await loadMerchFresh();
    const products = getEnrichedProducts({ activeOnly: false });
    const merch = loadMerch();
    res.json({ featured_home: normalizeFeaturedIds(merch.featured_home || []), products });
  });

  app.post('/api/admin/merch/create', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      await loadMerchFresh();
      const result = createManualOffer(req.body || {});
      const saved = await saveMerchAsync(loadMerch());
      const product = getEnrichedProducts({ activeOnly: false }).find((p) => p.id === result.id);
      res.json({ ok: true, ...result, product: product || null, warning: saved.warning || null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/admin/merch', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      await loadMerchFresh();
      const { product_id, patch } = req.body;
      if (!product_id) return res.status(400).json({ ok: false, error: 'product_id requis' });
      const saved = await updateMerchProductAsync(product_id, patch || {});
      const product = getEnrichedProducts({ activeOnly: false }).find((p) => p.id === product_id);
      res.json({
        ok: true,
        product_id,
        patch,
        product: product || null,
        warning: saved.warning || null,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/merch/featured', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      await loadMerchFresh();
      const ids = (req.body.ids || []).slice(0, 3);
      if (ids.length > 3) return res.status(400).json({ ok: false, error: 'max 3 offres featured' });
      const saved = await setFeaturedHomeAsync(ids);
      res.json({
        ok: true,
        featured_home: saved.data.featured_home,
        remote_saved: saved.remote_saved,
        warning: saved.warning || null,
      });
    } catch (err) {
      logError('Erreur featured admin', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/admin/orders', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const raw = await listAllOrdersAsync();
    for (const order of raw) {
      if (order.signature?.signed_at && !order.gestion_client_id) {
        await syncInscriptionClient(order);
      }
    }
    const orders = raw.map(toAdminSummary);
    res.json({ ok: true, orders, count: orders.length });
  });

  app.get('/api/admin/coachings', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const raw = await listAllOrdersAsync();
    const orders = raw
      .filter((o) => o.action === 'coaching_booking' || String(o.order_id || '').startsWith('COACH-'))
      .map(toAdminSummary)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    res.json({ ok: true, orders, count: orders.length });
  });

  app.get('/api/admin/orders/:id', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const order = await loadOrderAsync(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    const { access_token, ...safe } = order;
    res.json({ ok: true, order: safe });
  });

  app.get('/api/admin/orders/:id/contract.pdf', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const order = await loadOrderAsync(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    streamContractPdf(order, res);
  });

  app.delete('/api/admin/orders/:id', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const order = await loadOrderAsync(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      await deleteOrderAsync(req.params.id);
      logInfo('Inscription supprimée (admin)', { order_id: req.params.id });
      res.json({ ok: true, deleted: req.params.id });
    } catch (err) {
      logError('Suppression inscription admin', { order_id: req.params.id, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /** Relance bot + email pour une inscription déjà signée (ex. échec IBAN / Brevo). */
  app.post('/api/admin/orders/:id/redispatch', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      let order = await loadOrderAsync(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!order.signature?.signed_at) {
        return res.status(400).json({ ok: false, error: 'not_signed' });
      }

      let dispatch = null;
      let dispatchError = null;
      try {
        dispatch = await dispatchLifecycleOrder(order);
        order = (await loadOrderAsync(order.order_id)) || order;
      } catch (err) {
        dispatchError = err.message;
      }

      let email = { sent: Boolean(order.email_sent_at || order.email_sent) };
      if (req.body?.resend_email !== false && !email.sent) {
        const pdfPath = order.documents?.contract_pdf;
        const pdfName = order.documents?.contract_filename || 'contrat.pdf';
        const attachments =
          pdfPath && fs.existsSync(pdfPath) ? [{ filepath: pdfPath, filename: pdfName }] : [];
        email = await sendConfirmationEmail(order, attachments);
        if (email.sent) await markEmailSent(order.order_id);
      }

      logInfo('Redispatch admin', {
        order_id: order.order_id,
        queued: dispatch?.queued,
        email_sent: email.sent,
        dispatch_error: dispatchError || undefined,
      });
      res.json({
        ok: !dispatchError,
        order_id: order.order_id,
        queued: dispatch?.queued,
        forwarded: dispatch?.forwarded,
        email_sent: email.sent,
        email_warning: email.sent ? undefined : email.error || email.reason,
        dispatch_error: dispatchError || undefined,
      });
    } catch (err) {
      logError('Redispatch admin échoué', { order_id: req.params.id, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/orders/draft', async (req, res) => {
    try {
      const { product_id, gym, ...rest } = req.body;
      const product = findProduct(product_id);
      if (!product) return res.status(404).json({ ok: false, error: 'Produit introuvable' });

      const hasShort = rest.first_name && rest.last_name && rest.email && rest.phone;
      let customer_short = null;
      if (hasShort) {
        const errors = validateShortForm(rest, { requireBirthdate: false });
        if (errors.length) return res.status(400).json({ ok: false, errors });
        customer_short = {
          first_name: rest.first_name,
          last_name: rest.last_name,
          email: rest.email,
          phone: rest.phone,
          birthdate: rest.birthdate || null,
        };
      }

      const order = await createDraftAsync({
        product_id,
        product,
        customer_short,
        gym: gym || undefined,
      });
      if (customer_short) {
        await syncInscriptionClient(order).catch((err) =>
          logError('Sync client inscription (draft)', { order_id: order.order_id, error: err.message })
        );
      }
      res.json({
        ok: true,
        order_id: order.order_id,
        access_token: order.access_token,
        step: order.step,
      });
    } catch (err) {
      logError('Erreur création brouillon', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/orders/:id/gym', async (req, res) => {
    try {
      const token = req.body.token || req.query.token;
      const order = await loadOrderOrRecover(req.params.id, {
        token,
        sessionId: req.body.session_id || req.query.session_id,
        stripe: stripeForGym(req.body.gym),
        findProduct,
      });
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      const gym = String(req.body.gym || '').trim();
      if (!gym) return res.status(400).json({ ok: false, errors: ['Salle principale requise'] });
      const updated = await updateGymAsync(order.order_id, gym);
      res.json({ ok: true, step: updated.step, gym });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/orders/:id/identity', async (req, res) => {
    try {
      const token = req.body.token || req.query.token;
      const order = await loadOrderOrRecover(req.params.id, {
        token,
        sessionId: req.body.session_id || req.query.session_id,
        stripe,
        findProduct,
      });
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      const short = {
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        email: req.body.email,
        phone: req.body.phone,
        // Conserver une date déjà saisie au dossier si non renvoyée ici
        birthdate: req.body.birthdate || order.customer_short?.birthdate || null,
      };
      const errors = validateShortForm(short, { requireBirthdate: false });
      if (errors.length) return res.status(400).json({ ok: false, errors });
      if (!order.customer_full?.gym && !req.body.gym) {
        return res.status(400).json({ ok: false, errors: ['Choisissez d\'abord votre salle'] });
      }
      if (req.body.gym) await updateGymAsync(order.order_id, req.body.gym);
      const updated = await updateShortProfile(order.order_id, short);
      await syncInscriptionClient(updated).catch((err) =>
        logError('Sync client inscription (identity)', { order_id: order.order_id, error: err.message })
      );
      res.json({ ok: true, step: updated.step });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/orders/:id/iban', async (req, res) => {
    try {
      const token = req.body.token || req.query.token;
      const order = await loadOrderOrRecover(req.params.id, {
        token,
        sessionId: req.body.session_id || req.query.session_id,
        stripe,
        findProduct,
      });
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      let orderRef = order;
      if (order.payment?.status !== 'paid' && order.product_snapshot?.requires_payment !== false) {
        orderRef = await refreshPaymentFromStripe(order, req.body.session_id || req.query.session_id);
      }
      if (orderRef.payment?.status !== 'paid' && orderRef.product_snapshot?.requires_payment !== false) {
        return res.status(402).json({
          ok: false,
          error: 'payment_required',
          message: 'Finalisez d\'abord le paiement par carte.',
        });
      }
      const product = findProduct(order.product_id) || order.product_snapshot;
      const billingPlan =
        order.payment?.billing_plan || normalizeBillingPlan(req.body.billing_plan, product);
      const errors = validateIbanForm({ iban: req.body.iban, billing_plan: billingPlan }, product);
      if (errors.length) return res.status(400).json({ ok: false, errors });
      const updated = await updateIbanAsync(order.order_id, req.body.iban);
      res.json({ ok: true, step: updated.step });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/orders/:id/photo', uploadPhoto.single('photo'), async (req, res) => {
    try {
      const token = req.body.token || req.query.token;
      const order = await loadOrderOrRecover(req.params.id, {
        token,
        stripe,
        findProduct,
      });
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      if (!req.file) return res.status(400).json({ ok: false, error: 'photo_required' });

      // Fichier + base64 (pour envoi bot / Vercel multi-instances)
      let photo_base64 = null;
      try {
        const buf = fs.readFileSync(req.file.path);
        if (buf.length > 1.8 * 1024 * 1024) {
          return res.status(400).json({
            ok: false,
            error: 'photo_too_large',
            message: 'Photo trop lourde (max ~1,5 Mo). Compressez ou choisissez une autre image.',
          });
        }
        const mime = req.file.mimetype || 'image/jpeg';
        photo_base64 = `data:${mime};base64,${buf.toString('base64')}`;
      } catch (readErr) {
        logWarn('Lecture photo pour base64', { error: readErr.message });
      }

      order.documents = {
        ...(order.documents || {}),
        photo: req.file.path,
        photo_filename: req.file.filename,
        photo_base64,
      };
      const { saveOrderAsync } = require('./lib/order-lifecycle');
      await saveOrderAsync(order);
      res.json({ ok: true, photo: true, path: req.file.filename, stored: Boolean(photo_base64) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/orders/:id', async (req, res) => {
    const order = await loadOrderOrRecover(req.params.id, {
      token: req.query.token,
      sessionId: req.query.session_id,
      stripe,
      findProduct,
    });
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, req.query.token)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const { access_token, ...rest } = order;
    // Ne pas renvoyer les gros base64 au navigateur (flag seul)
    const safe = { ...rest };
    if (safe.documents?.photo_base64) {
      safe.documents = {
        ...safe.documents,
        photo_base64: true,
        has_photo: true,
      };
    }
    if (safe.signature?.image_base64) {
      safe.signature = { ...safe.signature, image_base64: true };
    }
    res.json({ ok: true, order: safe });
  });

  app.get('/api/orders/:id/status', async (req, res) => {
    const order = await loadOrderOrRecover(req.params.id, {
      token: req.query.token,
      sessionId: req.query.session_id,
      stripe,
      findProduct,
    });
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

  app.patch('/api/orders/:id/profile', async (req, res) => {
    try {
      const order = await loadOrderOrRecover(req.params.id, {
        token: req.body.token || req.query.token,
        sessionId: req.body.session_id || req.query.session_id,
        stripe,
        findProduct,
      });
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, req.body.token || req.query.token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      const product = findProduct(order.product_id) || order.product_snapshot;
      const full = { ...req.body };
      if (!full.billing_plan && order.payment?.billing_plan) {
        full.billing_plan = order.payment.billing_plan;
      }
      // Préserver l'IBAN déjà enregistré (ou renvoyé par le front) — ne jamais
      // l'écraser avec une chaîne vide du FormData.
      const existingIban = order.payment?.iban || order.customer_full?.iban || null;
      if (!String(full.iban || '').trim()) full.iban = existingIban || undefined;
      if (!full.gym) full.gym = order.customer_full?.gym;

      if (product?.requires_payment !== false && order.payment?.status !== 'paid') {
        const refreshed = await refreshPaymentFromStripe(order, req.body.session_id || req.query.session_id);
        if (refreshed?.payment?.status === 'paid') {
          // Ne pas perdre l'IBAN lors d'une revérif Stripe
          order.payment = {
            ...refreshed.payment,
            iban: refreshed.payment?.iban || full.iban || existingIban || null,
          };
        } else {
          return res.status(402).json({
            ok: false,
            error: 'payment_required',
            message:
              'Le paiement n\'a pas été confirmé — vous n\'avez pas été débité. Revenez à l\'étape paiement.',
          });
        }
      }

      const plan = full.billing_plan || order.payment?.billing_plan;
      const ibanReady = Boolean(String(full.iban || '').trim() || order.payment?.iban);
      if (requiresIbanForPlan(product, plan) && !ibanReady) {
        return res.status(400).json({
          ok: false,
          error: 'iban_required',
          message: 'Indiquez d\'abord votre IBAN pour le prélèvement.',
        });
      }

      // Date de naissance saisie au dossier → customer_short
      if (!full.birthdate) full.birthdate = order.customer_short?.birthdate || null;
      const errors = validateFullForm(full, product);
      if (errors.length) return res.status(400).json({ ok: false, errors });

      if (!order.documents?.photo && !order.documents?.photo_base64) {
        return res.status(400).json({
          ok: false,
          error: 'photo_required',
          message: 'Ajoutez une photo pour votre badge / fiche membre.',
        });
      }

      if (order.documents?.photo) full.photo_path = order.documents.photo;
      if (order.documents?.photo_base64) full.photo_base64 = order.documents.photo_base64;

      if (full.birthdate) {
        await updateShortProfile(order.order_id, {
          ...(order.customer_short || {}),
          birthdate: full.birthdate,
        });
      }
      await updateFullProfile(order.order_id, full);
      res.json({ ok: true, step: STEPS.SIGNATURE });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/orders/:id/sign', async (req, res) => {
    try {
      const order = await loadOrderOrRecover(req.params.id, {
        token: req.body.token,
        sessionId: req.body.session_id,
        stripe,
        findProduct,
      });
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!verifyAccess(order, req.body.token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      if (order.step >= STEPS.CONFIRMED || order.signature?.signed_at) {
        let dispatchError = null;
        if (!order.dispatched_at && !order.dispatch_result?.queued) {
          try {
            await dispatchLifecycleOrder(order);
            order = (await loadOrderAsync(order.order_id)) || order;
          } catch (dispatchErr) {
            dispatchError = dispatchErr.message;
            logError('Redispatch lifecycle (already signed)', {
              order_id: order.order_id,
              error: dispatchErr.message,
            });
          }
        }

        let emailWarning;
        if (!order.email_sent_at && !order.email_sent) {
          const pdfPath = order.documents?.contract_pdf;
          const pdfName = order.documents?.contract_filename || 'contrat.pdf';
          const attachments =
            pdfPath && fs.existsSync(pdfPath) ? [{ filepath: pdfPath, filename: pdfName }] : [];
          const emailResult = await sendConfirmationEmail(order, attachments);
          if (emailResult.sent) {
            await markEmailSent(order.order_id);
            order.email_sent_at = new Date().toISOString();
          } else {
            emailWarning =
              emailResult.error ||
              (emailResult.reason === 'smtp_not_configured'
                ? 'Email non configuré'
                : 'Email non envoyé');
          }
        }

        await syncInscriptionClient(order);
        return res.json({
          ok: true,
          step: STEPS.CONFIRMED,
          already_signed: true,
          order_id: order.order_id,
          email_sent: Boolean(order.email_sent_at || order.email_sent),
          email_warning: emailWarning,
          client_synced: Boolean(order.gestion_client_id),
          dispatch_error: dispatchError || undefined,
          status_url: `/mon-inscription?order=${order.order_id}&token=${order.access_token}`,
        });
      }

      const product = findProduct(order.product_id) || order.product_snapshot;
      if (product?.requires_payment !== false && order.payment?.status !== 'paid') {
        const refreshed = await refreshPaymentFromStripe(order, req.body.session_id);
        if (refreshed?.payment?.status === 'paid') {
          order.payment = refreshed.payment;
        } else {
          return res.status(402).json({
            ok: false,
            error: 'payment_required',
            message:
              'Le paiement n\'a pas été confirmé — vous n\'avez pas été débité. Revenez à l\'étape paiement.',
          });
        }
      }

      const { consent_cgv, consent_reglement, consent_medical, signature_image } = req.body;
      if (!consent_cgv || !consent_reglement || !consent_medical) {
        return res.status(400).json({ ok: false, error: 'Consentements requis (CGV, règlement, médical)' });
      }
      if (!signature_image || !String(signature_image).startsWith('data:image')) {
        return res.status(400).json({ ok: false, error: 'Signature manuscrite requise' });
      }

      let image_path = null;
      let image_base64 = null;
      try {
        const b64 = String(signature_image).split(',')[1];
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 200) {
          return res.status(400).json({ ok: false, error: 'Signature trop courte — signez dans le cadre' });
        }
        const fname = `${order.order_id}-${Date.now()}.png`;
        image_path = path.join(getUploadDir('signatures'), fname);
        fs.writeFileSync(image_path, buf);
        // Conservé dans la commande (PDF / multi-instances Vercel)
        image_base64 = `data:image/png;base64,${b64}`;
      } catch (sigErr) {
        return res.status(400).json({ ok: false, error: 'Impossible d\'enregistrer la signature' });
      }

      const signed = await recordSignature(order.order_id, {
        consent_cgv: Boolean(consent_cgv),
        consent_reglement: Boolean(consent_reglement),
        consent_medical: Boolean(consent_medical),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        image_path,
        image_base64,
        method: 'canvas',
      });

      const { filepath, filename } = await generateContractPdf(signed);
      signed.documents = { ...(signed.documents || {}), contract_pdf: filepath, contract_filename: filename };
      const { saveOrderAsync } = require('./lib/order-lifecycle');
      await saveOrderAsync(signed);

      let dispatchError = null;
      try {
        await dispatchLifecycleOrder(signed);
      } catch (dispatchErr) {
        dispatchError = dispatchErr.message;
        logError('Dispatch lifecycle après signature', {
          order_id: signed.order_id,
          error: dispatchErr.message,
        });
      }

      const emailResult = await sendConfirmationEmail(signed, [
        { filepath, filename },
      ]);
      if (emailResult.sent) await markEmailSent(signed.order_id);

      const clientResult = await syncInscriptionClient(signed);

      res.json({
        ok: true,
        step: STEPS.CONFIRMED,
        order_id: signed.order_id,
        email_sent: emailResult.sent,
        client_synced: Boolean(clientResult.synced),
        client_id: clientResult.client_id || signed.gestion_client_id || undefined,
        email_warning: emailResult.sent
          ? undefined
          : emailResult.error ||
            (emailResult.reason === 'smtp_not_configured'
              ? 'Email non configuré'
              : 'Email non envoyé'),
        dispatch_error: dispatchError || undefined,
        status_url: `/mon-inscription?order=${signed.order_id}&token=${signed.access_token}`,
      });
    } catch (err) {
      logError('Erreur signature', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/orders/:id/contract.pdf', async (req, res) => {
    const order = await loadOrderOrRecover(req.params.id, {
      token: req.query.token,
      sessionId: req.query.session_id,
      stripe,
      findProduct,
    });
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, req.query.token)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    streamContractPdf(order, res);
  });

  app.post('/api/orders/:id/pay', async (req, res) => {
    try {
      const token = req.body.token;
      let order = await loadOrderOrRecover(req.params.id, {
        token,
        sessionId: req.body.session_id,
        stripe,
        findProduct,
        rehydrateBody: req.body,
      });
      if (!order) {
        return res.status(404).json({
          ok: false,
          error: 'not_found',
          message:
            'Dossier introuvable. Revenez à l\'étape identité et recommencez, ou contactez le club si le problème persiste.',
        });
      }
      if (!verifyAccess(order, token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      if (req.body.gym) {
        order = await updateGymAsync(order.order_id, req.body.gym);
      }

      const orderStripe = stripeForOrder(order) || stripe;
      const product = findProduct(order.product_id) || order.product_snapshot;

      if (order.payment?.status === 'paid') {
        return res.json({
          ok: true,
          mode: 'already_paid',
          redirect: inscriptionRedirect(order),
        });
      }

      if (orderStripe && req.body.session_id) {
        try {
          const session = await orderStripe.checkout.sessions.retrieve(req.body.session_id);
          const lifecycleId =
            session.metadata?.lifecycle_order_id || session.metadata?.order_id;
          if (
            session.payment_status === 'paid' &&
            lifecycleId === order.order_id
          ) {
            order = await markPaymentPaid(order.order_id, {
              method: 'stripe',
              stripe_session_id: session.id,
              iban: order.payment?.iban,
              billing_plan: session.metadata?.billing_plan || order.payment?.billing_plan,
            });
            return res.json({
              ok: true,
              mode: 'already_paid',
              redirect: inscriptionRedirect(order),
            });
          }
        } catch {
          /* session invalide — continuer vers nouveau paiement */
        }
      }

      const paymentErrors = validatePaymentForm(req.body, product);
      if (paymentErrors.length) return res.status(400).json({ ok: false, errors: paymentErrors });

      const orderForSync = {
        ...order,
        customer_full: {
          ...(order.customer_full || {}),
          gym: req.body.gym || order.customer_full?.gym,
        },
      };
      await syncInscriptionClient(orderForSync).catch((err) =>
        logError('Sync client inscription (pay)', { order_id: order.order_id, error: err.message })
      );

      const short = order.customer_short;
      const rawBilling = String(req.body.billing_plan || '').trim().toLowerCase();
      const billingPlan = normalizeBillingPlan(rawBilling, product);
      const paymentPlan = normalizePaymentPlan(req.body.payment_plan, product);
      const preferredCheckout =
        rawBilling === 'paypal' ? 'paypal' : billingPlan === 'paypal' ? 'paypal' : 'card';
      // Badge toujours ~72h / IBAN — plus de choix client
      const badgeTiming = 'deferred';
      const badgeMethod = 'iban';
      const form = {
        ...short,
        ...req.body,
        order_id: order.order_id,
        billing_plan: billingPlan,
        payment_plan: paymentPlan,
        badge_timing: badgeTiming,
        badge_method: badgeMethod,
      };

      order.payment = {
        ...(order.payment || {}),
        billing_plan: billingPlan || (preferredCheckout === 'paypal' ? 'paypal' : billingPlan),
        payment_plan: paymentPlan,
        preferred_checkout: preferredCheckout,
        iban: order.payment?.iban || null,
        badge_timing: badgeTiming,
        badge_method: badgeMethod,
      };
      order.badge_timing = badgeTiming;
      order.badge_method = badgeMethod;
      const { saveOrderAsync } = require('./lib/order-lifecycle');
      await saveOrderAsync(order);

      if (!product.requires_payment) {
        order = await markPaymentPaid(order.order_id, {
          method: 'free',
          status: 'paid',
          billing_plan: billingPlan,
          payment_plan: paymentPlan,
        });
        return res.json({
          ok: true,
          mode: 'free',
          redirect: inscriptionRedirect(order),
        });
      }

      const gym = order.customer_full?.gym || req.body.gym || 'minimes';
      const baseUrl = getCheckoutBaseUrl(req);

      // Offre 259 € — 4× : PayPlug (Oney) ou PayPal (Stripe). Deciplus reste comptant.
      if (paymentPlan === '4x') {
        const fourMethod = String(req.body.pay_method || '').toLowerCase();
        const usePaypalFor4x =
          fourMethod === 'paypal' || preferredCheckout === 'paypal' || rawBilling === 'paypal';

        if (!usePaypalFor4x) {
          if (!isPayplugEnabled()) {
            return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
          }
          const customerOverrides = {
            address: req.body.address || order.customer_full?.address,
            postal_code: req.body.postal_code || order.customer_full?.postal_code,
            city: req.body.city || order.customer_full?.city,
            gender: req.body.gender || order.customer_full?.gender || 'M',
            phone: req.body.phone || short?.phone,
          };
          try {
            const payment = await createFourTimesPayment({
              order: {
                ...order,
                customer_full: {
                  ...(order.customer_full || {}),
                  gym,
                  ...customerOverrides,
                },
              },
              product,
              baseUrl,
              customerOverrides,
            });
            order.payment = {
              ...order.payment,
              method: 'payplug',
              payment_plan: '4x',
              preferred_checkout: 'payplug',
              payplug_payment_id: payment.id,
              status: 'pending',
            };
            if (customerOverrides.address) {
              order.customer_full = {
                ...(order.customer_full || {}),
                gym,
                address: customerOverrides.address,
                postal_code: customerOverrides.postal_code,
                city: customerOverrides.city,
                gender: customerOverrides.gender,
              };
            }
            await saveOrderAsync(order);
            const url = hostedPaymentUrl(payment);
            if (!url) {
              return res.status(502).json({ ok: false, error: 'payplug_url_missing' });
            }
            return res.json({
              ok: true,
              mode: 'payplug_4x',
              url,
              payment_id: payment.id,
            });
          } catch (err) {
            if (err.code === 'payplug_customer_incomplete') {
              return res.status(400).json({
                ok: false,
                error: err.message,
                missing: err.missing || [],
              });
            }
            throw err;
          }
        }
        // 4× + PayPal → Stripe Checkout (PayPal), Deciplus comptant
        order.payment = {
          ...order.payment,
          payment_plan: '4x',
          preferred_checkout: 'paypal',
          billing_plan: 'paypal',
        };
        await saveOrderAsync(order);
      }

      if (!orderStripe) {
        if (String(process.env.STORE_DEMO_ENABLED || 'false') === 'true') {
          order = await markPaymentPaid(order.order_id, {
            method: 'demo',
            billing_plan: billingPlan,
            payment_plan: paymentPlan || 'once',
          });
          return res.json({
            ok: true,
            mode: 'demo',
            redirect: inscriptionRedirect(order),
          });
        }
        return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
      }

      const payload = buildOrderPayload(
        {
          ...form,
          gym,
          gender: req.body.gender || 'M',
          payment_plan: paymentPlan || (productSupportsInstallmentChoice(product) ? 'once' : null),
          payment_method: 'stripe',
        },
        product
      );
      payload.lifecycle_order_id = order.order_id;

      const sessionParams = createCheckoutSessionParams({
        product,
        order,
        payload,
        baseUrl,
        packOrderMetadata,
        billingPlan,
        badgeTiming,
        badgeMethod,
      });
      if (sessionParams.metadata) {
        sessionParams.metadata.payment_plan =
          paymentPlan || (productSupportsInstallmentChoice(product) ? 'once' : '');
      }
      const session = await orderStripe.checkout.sessions.create(sessionParams);

      savePendingOrder(session.id, payload);
      res.json({
        ok: true,
        mode: billingPlan === 'cb' ? 'stripe_subscription' : 'stripe',
        url: session.url,
        session_id: session.id,
      });
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

  app.get('/api/membership/options', (_req, res) => {
    try {
      const {
        listComptantTargets,
        listCurrentPlans,
      } = require('./lib/membership');
      res.json({
        ok: true,
        current_plans: listCurrentPlans(),
        comptant_targets: listComptantTargets(),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/membership/manager-contact', (req, res) => {
    const { getManagerContact } = require('./lib/membership');
    const contact = getManagerContact(req.query.gym);
    if (!contact) return res.status(404).json({ ok: false, error: 'Salle inconnue' });
    res.json({ ok: true, contact });
  });

  app.get('/api/coachings/options', (_req, res) => {
    try {
      const { bookingOptions } = require('./lib/coaching-booking');
      res.json({ ok: true, ...bookingOptions() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/coachings/book', async (req, res) => {
    try {
      const { bookCoaching } = require('./lib/coaching-booking');
      const result = await bookCoaching(req.body || {});
      if (!result.ok) {
        return res.status(400).json({ ok: false, errors: result.errors || ['Demande invalide'] });
      }
      res.json(result);
    } catch (err) {
      logError('Erreur réservation coaching', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/cancel', async (req, res) => {
    try {
      const body = req.body || {};
      if (
        !body.first_name ||
        !body.last_name ||
        !body.birthdate ||
        !body.phone
      ) {
        return res.status(400).json({
          ok: false,
          error: 'Merci de renseigner le nom, le prénom, le téléphone et la date de naissance.',
        });
      }
      const { enqueueCancelRequest } = require('./lib/membership');
      const result = await enqueueCancelRequest(body);
      res.json({ ok: true, ...result });
    } catch (err) {
      logError('Erreur résiliation', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/counsel', async (req, res) => {
    try {
      const body = req.body || {};
      const { guideRetention } = require('./lib/counselor-ai');
      const result = await guideRetention({
        reasonId: body.reason_id || body.reason || 'other',
        reasonLabel: body.reason_label || '',
        freeText: body.free_text || body.message || '',
      });
      res.json({ ok: true, reply: result.reply, source: result.source });
    } catch (err) {
      logError('Erreur counsel IA', { error: err.message });
      res.status(500).json({
        ok: false,
        error: err.message,
        reply:
          'Merci pour ces précisions. Avant de décider, un échange avec votre manager de salle peut souvent aider. Que souhaitez-vous faire ?',
      });
    }
  });

  app.post('/api/membership/verify', async (req, res) => {
    try {
      const body = req.body || {};
      // Changement d’abo : nom + prénom + naissance (email pour retrouver la fiche)
      if (!body.first_name || !body.last_name || !body.birthdate) {
        return res.status(400).json({
          ok: false,
          error: 'Merci de renseigner le nom, le prénom et la date de naissance.',
        });
      }
      if (!body.email && !body.phone) {
        return res.status(400).json({
          ok: false,
          error: 'Merci de renseigner un email ou un téléphone pour retrouver votre fiche.',
        });
      }
      const { enqueueVerifyIdentity } = require('./lib/membership');
      const result = await enqueueVerifyIdentity({ ...body, verify_mode: body.verify_mode || 'change' });
      res.json({ ok: true, ...result });
    } catch (err) {
      logError('Erreur verify identité', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/change/checkout', async (req, res) => {
    try {
      const body = req.body || {};
      const product = findProduct(body.target_product_id);
      if (!product) return res.status(404).json({ ok: false, error: 'Offre introuvable' });
      if (!stripe) return res.status(503).json({ ok: false, error: 'stripe_not_configured' });
      // Infos bloquantes : nom, prénom, date de naissance
      if (!body.first_name || !body.last_name || !body.birthdate) {
        return res.status(400).json({
          ok: false,
          error:
            'Merci de renseigner le nom, le prénom et la date de naissance (doivent correspondre à la fiche adhérent).',
        });
      }
      if (!body.email && !body.phone) {
        return res.status(400).json({
          ok: false,
          error: 'Merci de renseigner un email ou un téléphone.',
        });
      }
      const baseUrl = getCheckoutBaseUrl(req);
      const meta = {
        order_type: 'membership_change',
        target_product_id: product.id,
        first_name: body.first_name || '',
        last_name: body.last_name || '',
        birthdate: body.birthdate || '',
        email: body.email || '',
        phone: body.phone || '',
        gym: body.gym || 'minimes',
        current_plan: body.current_plan || '',
        verify_order_id: body.verify_order_id || '',
      };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'paypal'],
        customer_email: body.email || undefined,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: product.price_cents,
              product_data: {
                name: product.display_name || product.name,
                description: 'Changement prélèvement → comptant',
              },
            },
            quantity: 1,
          },
        ],
        metadata: meta,
        success_url: `${baseUrl}/gerer-abonnement?change=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/gerer-abonnement?change=cancelled`,
      });
      res.json({ ok: true, url: session.url, session_id: session.id });
    } catch (err) {
      logError('Erreur change checkout', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/change/confirm', async (req, res) => {
    try {
      const sessionId = req.body?.session_id;
      if (!sessionId || !stripe) {
        return res.status(400).json({ ok: false, error: 'session_id requis' });
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!isStripeCheckoutPaid(session)) {
        return res.status(402).json({ ok: false, error: 'paiement non confirmé' });
      }
      const meta = session.metadata || {};
      const { enqueueChangeAfterPayment, getCancelStatus } = require('./lib/membership');
      let deciplusMemberId = null;
      if (meta.verify_order_id) {
        try {
          const { loadOrder } = require('./lib/order-persistence');
          const verified = await loadOrder(meta.verify_order_id);
          if (verified?.cancel_status === 'verified' && verified.deciplus_member_id) {
            deciplusMemberId = verified.deciplus_member_id;
          } else {
            const st = await getCancelStatus(meta.verify_order_id);
            if (st?.status === 'verified' && verified?.deciplus_member_id) {
              deciplusMemberId = verified.deciplus_member_id;
            }
          }
        } catch {
          /* re-vérif côté bot si besoin */
        }
      }
      const result = await enqueueChangeAfterPayment({
        identity: {
          first_name: meta.first_name,
          last_name: meta.last_name,
          birthdate: meta.birthdate,
          email: meta.email || session.customer_details?.email,
          phone: meta.phone,
          gym: meta.gym || 'minimes',
        },
        targetProductId: meta.target_product_id,
        stripeSessionId: sessionId,
        deciplusMemberId,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      logError('Erreur change confirm', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/internal/new-member-alert', async (req, res) => {
    if (!isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const mail = await sendNewMemberAdminEmail(req.body || {});
      res.json({ ok: true, mail });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Fin de job changement d’abo (prélèvement → comptant) — e-mail client
  app.post('/api/internal/change-complete', async (req, res) => {
    if (!isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const body = req.body || {};
      const { sendChangeConfirmationEmail } = require('./lib/membership');
      const mail = await sendChangeConfirmationEmail(
        {
          email: body.email,
          first_name: body.first_name,
          last_name: body.last_name,
        },
        { name: body.product_name, change_product_name: body.product_name }
      );
      res.json({ ok: true, mail });
    } catch (err) {
      logError('Erreur change-complete', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/internal/cancel-mismatch', async (req, res) => {
    if (!isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const { sendCancelMismatchEmail, updateCancelStatus } = require('./lib/membership');
      const body = req.body || {};
      const mail = await sendCancelMismatchEmail(body, body.mismatch_fields || []);
      if (body.order_id) {
        await updateCancelStatus(body.order_id, {
          status: 'mismatch',
          mismatch_fields: body.mismatch_fields || [],
          reason: body.reason || 'identity_mismatch',
        }).catch(() => {});
      }
      res.json({ ok: true, mail });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Statut résiliation poussé par le bot (mismatch / done / error)
  app.post('/api/internal/cancel-status', async (req, res) => {
    if (!isAuthorizedSync(req)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const body = req.body || {};
      if (!body.order_id) return res.status(400).json({ ok: false, error: 'order_id requis' });
      const { updateCancelStatus, sendCancelMismatchEmail, getCancelStatus } = require('./lib/membership');
      const record = await updateCancelStatus(body.order_id, {
        status: body.status || 'pending',
        mismatch_fields: body.mismatch_fields || [],
        reason: body.reason || null,
        cancelled_count: body.cancelled_count,
        deciplus_member_id: body.deciplus_member_id || null,
      });
      if (body.status === 'mismatch') {
        const identity = body.customer || record.customer || {};
        // Ne jamais faire échouer le statut à cause de l'email
        try {
          await sendCancelMismatchEmail(identity, body.mismatch_fields || []);
        } catch (mailErr) {
          logWarn('Email mismatch résiliation ignoré', { error: mailErr.message });
        }
      }
      res.json({
        ok: true,
        status: (await getCancelStatus(body.order_id))?.status || body.status,
        mismatch_fields: body.mismatch_fields || [],
      });
    } catch (err) {
      logError('Erreur cancel-status interne', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Suivi front (spinner résiliation / verify) — pas de données sensibles renvoyées
  app.get('/api/membership/cancel-status', async (req, res) => {
    try {
      const orderId = String(req.query.order || '').trim();
      if (!orderId || !/^(CANCEL|VERIFY)-/.test(orderId)) {
        return res.status(400).json({ ok: false, error: 'order invalide' });
      }
      const { getCancelStatus } = require('./lib/membership');
      const status = await getCancelStatus(orderId);
      if (!status) return res.json({ ok: true, status: 'pending', mismatch_fields: [] });
      res.json({
        ok: true,
        status: status.status,
        mismatch_fields: status.mismatch_fields || [],
      });
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
        payment_method_types: ['card', 'paypal'],
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

      let session = null;
      let stripeClient = stripe;
      if (!stripeClient) return res.status(503).json({ ok: false, error: 'stripe_not_configured' });

      try {
        session = await stripeClient.checkout.sessions.retrieve(sessionId);
      } catch (primaryErr) {
        if (process.env.STRIPE_SECRET_KEY_PORTET && process.env.STRIPE_SECRET_KEY_PORTET !== STRIPE_SECRET) {
          try {
            stripeClient = stripeClientForGym('portet').stripe;
            session = await stripeClient.checkout.sessions.retrieve(sessionId);
          } catch {
            throw primaryErr;
          }
        } else {
          throw primaryErr;
        }
      }

      if (!isStripeCheckoutPaid(session)) {
        return res.status(402).json({ ok: false, error: 'payment_not_completed' });
      }

      const materielPending = loadPendingCheckout(sessionId);
      if (
        materielPending?.order_type === 'materiel' ||
        session.metadata?.order_type === 'materiel'
      ) {
        const out = await fulfillMaterielCheckout(sessionId, session);
        if (!out.ok) {
          return res.status(out.error === 'payment_not_completed' ? 402 : 500).json(out);
        }
        return res.json({ ok: true, ...out });
      }

      const pending = loadPendingOrder(sessionId) || unpackOrderMetadata(session.metadata);
      const lifecycleMode = Boolean(
        pending?.lifecycle_order_id || session.metadata?.lifecycle_order_id
      );
      const out = await fulfillStripeSession(sessionId, session, lifecycleMode);
      if (!out.ok && out.error === 'pending_not_found') {
        const lifecycleId = session.metadata?.lifecycle_order_id || session.metadata?.order_id;
        if (lifecycleId) {
          const existing = await loadOrderAsync(lifecycleId);
          if (existing?.payment?.status === 'paid') {
            return res.json({
              ok: true,
              already_processed: true,
              order_id: existing.order_id,
              lifecycle: true,
              redirect: inscriptionRedirect(existing),
            });
          }
        }
        return res.status(404).json({ ok: false, error: 'order_not_found' });
      }
      if (!out.ok) return res.status(out.error === 'payment_not_completed' ? 402 : 500).json(out);
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  async function markPayplugOrderPaid(order, payment) {
    const paid = await markPaymentPaid(order.order_id, {
      method: 'payplug',
      payment_plan: '4x',
      payplug_payment_id: payment.id,
      status: 'paid',
    });
    return paid;
  }

  app.post('/api/webhooks/payplug', async (req, res) => {
    try {
      const body = req.body || {};
      const paymentId = body.id || body.resource_id || body.object?.id;
      if (!paymentId) return res.status(400).json({ ok: false, error: 'payment_id manquant' });
      if (!isPayplugEnabled()) return res.status(503).json({ ok: false, error: 'payplug_not_configured' });

      const payment = await retrievePayment(paymentId);
      const orderId =
        payment.metadata?.lifecycle_order_id ||
        payment.metadata?.order_id ||
        null;
      if (!orderId) {
        logWarn('PayPlug webhook sans order_id', { payment_id: paymentId });
        return res.json({ ok: true, ignored: true });
      }
      const order = await loadOrderAsync(orderId);
      if (!order) {
        logWarn('PayPlug webhook — commande introuvable', { order_id: orderId, payment_id: paymentId });
        return res.json({ ok: true, ignored: true });
      }
      if (order.payment?.status === 'paid') {
        return res.json({ ok: true, already_paid: true });
      }
      if (isPayplugPaymentPaid(payment)) {
        await markPayplugOrderPaid(order, payment);
        logInfo('PayPlug 4× confirmé', { order_id: orderId, payment_id: paymentId });
      } else if (payment.failure) {
        await markPaymentFailed(order.order_id, {
          method: 'payplug',
          payment_plan: '4x',
          payplug_payment_id: payment.id,
          failure: payment.failure,
        }).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err) {
      logError('Erreur webhook PayPlug', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/confirm-payplug', async (req, res) => {
    try {
      const { order_id: orderId, token, payment_id: paymentId } = req.body || {};
      if (!orderId || !token) {
        return res.status(400).json({ ok: false, error: 'order_id et token requis' });
      }
      let order = await loadOrderAsync(orderId);
      if (!order || !verifyAccess(order, token)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      if (order.payment?.status === 'paid') {
        return res.json({
          ok: true,
          already_paid: true,
          redirect: inscriptionRedirect(order),
        });
      }
      if (!isPayplugEnabled()) {
        return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
      }
      const id = paymentId || order.payment?.payplug_payment_id;
      if (!id) return res.status(400).json({ ok: false, error: 'payment_id manquant' });
      const payment = await retrievePayment(id);
      if (isPayplugPaymentPaid(payment)) {
        order = await markPayplugOrderPaid(order, payment);
        return res.json({
          ok: true,
          paid: true,
          redirect: inscriptionRedirect(order),
        });
      }
      if (payment.failure) {
        return res.status(402).json({
          ok: false,
          error: 'payment_failed',
          message: payment.failure?.message || 'Paiement 4× refusé',
        });
      }
      return res.json({
        ok: true,
        pending: isPayplugPaymentPending(payment) || true,
        message:
          'Votre demande de paiement en 4× est en cours de validation. Merci de patienter quelques instants.',
      });
    } catch (err) {
      logError('Erreur confirm PayPlug', { error: err.message });
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

  // SEO/GEO layer: robots.txt, sitemap.xml, llms.txt, canonical + JSON-LD
  // injection, slug product URLs. Registered first so its routes win.
  require('./lib/seo').registerSeo(app, PUBLIC_DIR);

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
    '/cgv': 'cgv.html',
    '/reglement-interieur': 'reglement-interieur.html',
    '/attestation-medicale': 'attestation-medicale.html',
    '/mon-inscription': 'mon-inscription.html',
    '/gerer-abonnement': 'gerer-abonnement.html',
    '/checkout.html': 'checkout.html',
    '/admin': 'admin/index.html',
    '/admin/': 'admin/index.html',
    '/admin/login': 'admin/login.html',
    '/admin/contrats': 'admin/index.html',
    '/contrat': 'contrat.html',
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
