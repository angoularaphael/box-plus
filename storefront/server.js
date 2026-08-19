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
const { getStoreUrl, getCheckoutBaseUrl, PRODUCTION_STORE_URL } = require('../lib/app-urls');
const {
  validateBalmaSwitchPayload,
  buildBalmaSwitchOrder,
  inscriptionUrl,
  listBalmaPrelevementOffers,
  isBalmaRetourSource,
  balmaBadgePaymentFields,
} = require('../lib/balma');
const { forwardJobToBot } = require('../lib/bot-forward');
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
  adultOfferAgeError,
  productNeedsAutoBadge,
} = require('../lib/billing-plan');
const {
  createFourTimesPayment,
  createHostedPayment,
  retrievePayment,
  listPayments,
  isPayplugPaymentPaid,
  isPayplugPaymentPending,
  isPayplugEnabled,
  isOney4xEnabled,
  ONEY_4X_UNAVAILABLE_MESSAGE,
  hostedPaymentUrl,
  formatPayplugError,
} = require('./lib/payplug');
const {
  isPaypalEnabled,
  publicClientId: paypalPublicClientId,
  paypalAccountForGym,
  createPaypalOrder,
  capturePaypalOrder,
  retrievePaypalOrder,
  isPaypalOrderPaid,
  paypalMode,
  formatPaypalError,
} = require('./lib/paypal');
const {
  getDevSession,
  setDevSessionCookie,
  clearDevSessionCookie,
  codesMatch,
  unlockLocked,
  recordUnlockFail,
  clearUnlockFails,
} = require('./lib/dev-session');
const { runPaymentContext, testPaymentsInfo } = require('./lib/test-env');
const { corsMiddleware } = require('./lib/cors');
const {
  registerEcheancierPayRoutes,
  fulfillEcheancierIfPaid,
} = require('./lib/echeancier-pay');
const {
  isProductionRuntime,
  isDemoCheckoutAllowed,
  secretsEqual,
  sanitizeOrderId,
  sanitizePaymentId,
  requestAccessToken,
  redactOrderForClient,
  loginLocked,
  recordLoginFail,
  clearLoginFails,
  applySecurityHeaders,
  photoExtForMime,
  looksLikeAllowedImage,
  publicServerError,
} = require('./lib/security');
const {
  expectedChargeCents,
  paidMatchesExpected,
  payplugMatches,
  rememberPreviousPayplugId,
  payplugIdCandidates,
  paypalMatches,
  verifyPayplugSignature,
} = require('./lib/payment-bind');
const {
  getPaymentDisplay,
  setPaymentDisplay,
  resolvePaymentDisplay,
} = require('./lib/payment-display');
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
  attachReferralFriendAsync,
  loadOrder,
  loadOrderAsync,
  saveOrderAsync,
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
const {
  generateInscriptionInvoicePdf,
  generateMaterielInvoicePdf,
  streamInscriptionInvoicePdf,
} = require('./lib/invoice-pdf');
const { upsertClientFromInscription, upsertMaterielClient, upsertLeadClient } = require('./lib/client-sync');
const { insertTunnelLead, tunnelFromProductId } = require('./lib/tunnel-lead');
const {
  sanitizeFriend,
  isOffre29Order,
  notifyReferralFriend,
} = require('./lib/referral-notify');
const {
  getWhatsAppStatus,
  startWhatsAppBot,
  stopWhatsAppBot,
  logoutWhatsAppBot,
} = require('./lib/whatsapp-bot');
const {
  getMaintenance,
  setMaintenance,
  isMaintenanceBypass,
  maintenancePageHtml,
} = require('./lib/site-maintenance');

function streamOrderFacturePdf(order, res) {
  try {
    streamInscriptionInvoicePdf(order, res);
  } catch (err) {
    logError('PDF facture', { order_id: order?.order_id, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'pdf_failed' });
    }
  }
}

async function syncInscriptionClient(order) {
  const result = await upsertClientFromInscription(order);
  if (!result.synced) {
    logError('Sync portet_clients (gestion-manager) non faite', {
      order_id: order?.order_id,
      reason: result.reason || null,
      error: result.error || null,
    });
  }
  if (result.synced && result.client_id && order.gestion_client_id !== result.client_id) {
    order.gestion_client_id = result.client_id;
    const { saveOrderAsync } = require('./lib/order-lifecycle');
    await saveOrderAsync(order);
  }
  return result;
}

async function maybeRecordTunnelLeadFromOrder(order) {
  const tunnel = tunnelFromProductId(order?.product_id || order?.product_snapshot?.id);
  if (!tunnel || tunnel === 'seance_essai') return null;
  const short = order.customer_short || {};
  if (!short.first_name || !short.phone) return null;
  if (order.tunnel_lead_id) return { ok: true, lead_id: order.tunnel_lead_id, skipped: true };
  const lead = await insertTunnelLead({
    tunnel,
    prenom: short.first_name,
    nom: short.last_name,
    telephone: short.phone,
    email: short.email,
    salle: order.customer_full?.gym || null,
    product_id: order.product_id,
    order_id: order.order_id,
    source: 'boxplus-inscription',
  });
  if (lead.ok && lead.lead_id) {
    order.tunnel_lead_id = lead.lead_id;
    const { saveOrderAsync } = require('./lib/order-lifecycle');
    await saveOrderAsync(order).catch(() => {});
  }
  return lead;
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
        const ext = photoExtForMime(file.mimetype) || '.jpg';
        const id = sanitizeOrderId(req.params.id) || 'upload';
        cb(null, `${id}-${Date.now()}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (photoExtForMime(file.mimetype)) return cb(null, true);
      cb(new Error('invalid_image_type'));
    },
    limits: { fileSize: 3.5 * 1024 * 1024 },
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
  const tok = encodeURIComponent(order.access_token || '');
  const stripeReturn = order.payment?.method === 'stripe' && order.payment?.stripe_session_id;
  const sid = stripeReturn
    ? `&session_id=${encodeURIComponent(order.payment.stripe_session_id)}`
    : '';
  return `/inscription?order=${order.order_id}&token=${tok}&bc_token=${tok}&step=${step}${sid}`;
}

function isAuthorizedSync(req) {
  if (!SYNC_SECRET) return false;
  const header = req.headers['x-sync-secret'] || req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return secretsEqual(token, SYNC_SECRET);
}

function isAuthorizedCron(req) {
  if (isAuthorizedSync(req)) return true;
  const cron = String(process.env.CRON_SECRET || '').trim();
  if (!cron) return false;
  const header = req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return secretsEqual(token, cron);
}

async function isAuthorizedAdmin(req) {
  const session = await getAdminSession(req);
  if (session) return true;
  if (!ADMIN_SECRET) return false;
  const header = req.headers['x-admin-secret'] || req.headers['authorization'] || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return secretsEqual(token, ADMIN_SECRET);
}

let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

function findProduct(productId) {
  return findEnrichedProduct(productId) || null;
}

async function maybeNotifyOffre29Friend(order, friendInput) {
  if (!isOffre29Order(order)) return { skipped: true };
  const friend = sanitizeFriend(friendInput || order.referral_friend);
  if (!friend) return { skipped: true };
  const referrer = order.customer_short || {};
  if (!referrer.first_name || !referrer.last_name) return { skipped: true };
  await upsertLeadClient({
    prenom: friend.prenom,
    nom: friend.nom,
    telephone: friend.telephone,
    email: friend.email,
    salle: order.customer_full?.gym || null,
    offre: 'Parrainage — Offre 29 € (ami)',
    logLabel: 'ami-parrainage',
  }).catch((err) => logWarn('Sync ami portet_clients', { order_id: order.order_id, error: err.message }));
  if (order.referral_notify?.whatsapp?.sent) return { skipped: true, already: true };
  try {
    const result = await notifyReferralFriend({
      order,
      friend,
      referrer,
      skipEmail: Boolean(order.referral_notify?.email?.sent),
    });
    order.referral_friend = friend;
    order.referral_notify = {
      email: result.email?.sent || order.referral_notify?.email?.sent ? { sent: true } : result.email,
      whatsapp: result.whatsapp,
    };
    if (order.referral_notify.whatsapp?.sent) {
      order.referral_notified_at = new Date().toISOString();
    }
    await saveOrderAsync(order);
    return result;
  } catch (err) {
    logWarn('Notif ami offre 29', { order_id: order.order_id, error: err.message });
    return { skipped: false, error: err.message };
  }
}

async function dispatchLifecycleOrder(order) {
  const { hydrateOrderMedia, applyDeciplusPhoto } = require('./lib/cloudinary');
  const hydrated = await hydrateOrderMedia(order);
  const product = findProduct(order.product_id) || order.product_snapshot;
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  if (payload.photo_path && /(?:^|[\\/])tmp[\\/]/i.test(String(payload.photo_path))) {
    payload.photo_path = null;
  }
  if (!payload.photo_base64 && !payload.photo_path && !payload.photo_url) {
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

/** Photo seule — ne recrée pas la vente (job_id = {order_id}#photo). */
async function dispatchMemberPhoto(order) {
  const { hydrateOrderMedia, applyDeciplusPhoto } = require('./lib/cloudinary');
  const hydrated = await hydrateOrderMedia(order);
  const product = findProduct(order.product_id) || order.product_snapshot || {
    id: 'photo',
    name: 'Photo membre',
    price_cents: 0,
    requires_payment: false,
    sale_type: 'none',
  };
  const payload = applyDeciplusPhoto(buildOrderFromLifecycle(hydrated, product), hydrated);
  payload.action = 'member_photo';
  if (order.deciplus_member_id) payload.deciplus_member_id = order.deciplus_member_id;
  if (payload.photo_path && /(?:^|[\\/])tmp[\\/]/i.test(String(payload.photo_path))) {
    payload.photo_path = null;
  }
  if (!payload.photo_base64 && !payload.photo_url && !payload.photo_path) {
    throw new Error('photo_manquante');
  }
  const result = await dispatchOrder(payload);
  logInfo('Photo membre → bot ventes', {
    order_id: order.order_id,
    forwarded: result.forwarded,
    queued: result.queued,
  });
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
    access_token: order.access_token,
    materiel: true,
    redirect: `/success.html?order=${order.order_id}&type=materiel${
      order.access_token ? `&token=${encodeURIComponent(order.access_token)}` : ''
    }`,
  };
}

async function fulfillMaterielPayplug(paymentId) {
  if (!paymentId) return { ok: false, error: 'payment_id manquant' };
  if (!isPayplugEnabled()) return { ok: false, error: 'payplug_not_configured' };

  const payment = await retrievePayment(paymentId);
  const meta = payment.metadata || {};
  const pending = loadPendingCheckout(paymentId);
  const orderId = meta.order_id || pending?.order_id;
  if (!orderId) return { ok: false, error: 'order_not_found' };

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
  if (!order) return { ok: false, error: 'order_not_found' };

  const bound = payplugMatches({
    payment,
    orderId: order.order_id,
    expectedCents: order.total_cents,
    storedPaymentId: order.payment?.payplug_payment_id,
  });
  if (!bound.ok) return { ok: false, error: bound.error };

  if (order.payment?.status === 'paid') {
    await sendMaterielEmailIfNeeded(order);
    return { ok: true, order_id: order.order_id, materiel: true, already_processed: true };
  }

  if (!isPayplugPaymentPaid(payment)) {
    if (payment.failure) {
      return {
        ok: false,
        error: 'payment_failed',
        message: payment.failure?.message || 'Paiement refusé',
      };
    }
    return {
      ok: false,
      error: 'payment_pending',
      pending: true,
      message: 'Votre paiement est en cours de validation.',
    };
  }

  order = await markMaterielPaidAsync(order.order_id, {
    method: 'payplug',
    payplug_payment_id: payment.id,
  });
  if (!order) return { ok: false, error: 'mark_paid_failed' };

  removePendingCheckout(paymentId);
  await sendMaterielEmailIfNeeded(order);
  syncMaterielClient(order).catch((err) =>
    logError('Sync client matériel', { error: err.message, order_id: order.order_id })
  );
  logInfo('Paiement matériel PayPlug confirmé', { order_id: order.order_id, payment_id: paymentId });
  return {
    ok: true,
    order_id: order.order_id,
    access_token: order.access_token,
    materiel: true,
    redirect: `/success.html?order=${order.order_id}&type=materiel${
      order.access_token ? `&token=${encodeURIComponent(order.access_token)}` : ''
    }`,
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
  app.disable('x-powered-by');
  app.use(applySecurityHeaders);

  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      if (!stripe) return res.status(503).json({ ok: false, error: 'stripe_not_configured' });

      let event;
      try {
        if (!STRIPE_WEBHOOK_SECRET) {
          if (isProductionRuntime()) {
            return res.status(503).json({ ok: false, error: 'webhook_not_configured' });
          }
          event = JSON.parse(req.body.toString());
        } else {
          const sig = req.headers['stripe-signature'];
          event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
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

  /* Le site vitrine WordPress consomme le chat Chloe et les places restantes :
     sans en-tête CORS le navigateur bloquait la réponse (préflight en 404). */
  app.use('/api', corsMiddleware());

  app.get(['/aventure', '/aventure.html'], (_req, res) => {
    res.redirect(301, 'https://aventure.boxingcenter.fr/');
  });

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        if (req.originalUrl === '/api/webhooks/payplug' || req.path === '/api/webhooks/payplug') {
          req.rawBody = buf;
        }
      },
    })
  );

  app.use((req, _res, next) => {
    runPaymentContext({ test: Boolean(getDevSession(req)) }, () => next());
  });

  app.use(async (req, res, next) => {
    if (isMaintenanceBypass(req)) return next();
    try {
      const state = await getMaintenance();
      if (!state.enabled) return next();
      if (req.path.startsWith('/api/')) {
        return res.status(503).json({
          ok: false,
          error: 'maintenance',
          message: state.message,
        });
      }
      res.status(503).setHeader('Retry-After', '1800').type('html').send(maintenancePageHtml(state));
    } catch (err) {
      logWarn('Maintenance middleware', { error: err.message });
      next();
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      if (loginLocked(req)) {
        return res.status(429).json({ ok: false, error: 'Trop d’essais. Réessayez plus tard.' });
      }
      const { email, password } = req.body || {};
      const user = await verifyAdminLogin(email, password);
      if (!user) {
        recordLoginFail(req);
        return res.status(401).json({ ok: false, error: 'Email ou mot de passe incorrect' });
      }
      clearLoginFails(req);
      await setAdminSessionCookie(res, user);
      res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
    } catch (err) {
      logError('Login admin', { error: err.message });
      const status = err.message === 'session_secret_missing' ? 503 : 500;
      res.status(status).json({
        ok: false,
        error: status === 503 ? 'session_secret_missing' : publicServerError(),
      });
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

  app.post('/api/studio/unlock', (req, res) => {
    if (getDevSession(req)) {
      return res.json({ ok: true, reply: 'C’est bon, j’ouvre l’espace.', url: '/dev' });
    }
    if (unlockLocked(req)) {
      return res.status(429).json({
        ok: false,
        reply: 'Trop d’essais. Réessaie plus tard.',
      });
    }
    if (!codesMatch(req.body?.code || req.body?.pin || '')) {
      recordUnlockFail(req);
      return res.status(403).json({
        ok: false,
        reply: 'Ce n’est pas le bon. Réessaie.',
      });
    }
    clearUnlockFails(req);
    setDevSessionCookie(res);
    res.json({ ok: true, reply: 'C’est bon, j’ouvre l’espace.', url: '/dev' });
  });

  app.post('/api/studio/leave', (req, res) => {
    clearDevSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/studio/payments', async (req, res) => {
    if (!getDevSession(req)) return res.status(404).json({ ok: false, error: 'not_found' });
    try {
      const prod = await getPaymentDisplay();
      res.json({ ok: true, prod, sandbox: testPaymentsInfo() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/studio/payments', async (req, res) => {
    if (!getDevSession(req)) return res.status(404).json({ ok: false, error: 'not_found' });
    try {
      const prod = await setPaymentDisplay(req.body || {});
      logInfo('Affichage paiements mis à jour', prod);
      res.json({ ok: true, prod });
    } catch (err) {
      res.status(err.code === 'need_one' ? 400 : 500).json({
        ok: false,
        error: err.message,
      });
    }
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
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    try {
      await hydrateMerchOnce();
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

  app.get('/api/admin/maintenance', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const state = await getMaintenance();
    res.json({ ok: true, ...state });
  });

  app.put('/api/admin/maintenance', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const session = await getAdminSession(req);
      const state = await setMaintenance({
        enabled: req.body?.enabled,
        message: req.body?.message,
        user: session?.email || session?.name || null,
      });
      logInfo('Maintenance boutique basculée', { enabled: state.enabled, by: state.updated_by });
      res.json({ ok: true, ...state });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/admin/whatsapp', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const includeQr = String(req.query.qr || '') === '1';
    const status = await getWhatsAppStatus({ includeQr });
    res.json({ ok: true, ...status });
  });

  app.post('/api/admin/whatsapp', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const action = String(req.query.action || req.body?.action || '').toLowerCase();
    try {
      if (action === 'start') {
        const result = await startWhatsAppBot(req.body || {});
        return res.json({ ok: true, action, ...result });
      }
      if (action === 'stop') {
        const result = await stopWhatsAppBot();
        return res.json({ ok: true, action, ...result });
      }
      if (action === 'logout') {
        const result = await logoutWhatsAppBot();
        return res.json({ ok: true, action, ...result });
      }
      return res.status(400).json({ ok: false, error: 'action inconnue' });
    } catch (err) {
      if (action === 'start' || action === 'stop') {
        return res.json({ ok: true, action, pending: true, message: err.message });
      }
      res.status(502).json({ ok: false, error: err.message });
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

      if (!isPayplugEnabled()) {
        if (isDemoCheckoutAllowed()) {
          const order = await createMaterielOrderAsync({
            customer,
            items,
            total_cents,
            pickup_gym: customer.pickup_gym,
          });
          await markMaterielPaidAsync(order.order_id, { method: 'demo' });
          await syncMaterielClient(order).catch(() => {});
          await sendMaterielConfirmationEmail(order).catch(() => {});
          const tokenQ = order.access_token
            ? `&token=${encodeURIComponent(order.access_token)}`
            : '';
          return res.json({
            ok: true,
            mode: 'demo',
            order_id: order.order_id,
            access_token: order.access_token,
            redirect: `/success.html?order=${order.order_id}&type=materiel&demo=1${tokenQ}`,
          });
        }
        return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
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

      const payment = await createHostedPayment({
        order: {
          order_id: orderId,
          customer_full: customer,
          customer_short: customer,
        },
        amountCents: total_cents,
        description: `Matériel Boxing Center (${items.length} article${items.length > 1 ? 's' : ''})`,
        baseUrl,
        metadata: {
          order_type: 'materiel',
          order_id: orderId,
          payment_plan: 'once',
        },
        customerOverrides: customer,
        returnUrl: `${baseUrl}/success.html?order=${encodeURIComponent(orderId)}&type=materiel&payplug_return=1&token=${encodeURIComponent(order.access_token || '')}`,
        cancelUrl: `${baseUrl}/panier?cancelled=1`,
      });
      const url = hostedPaymentUrl(payment);
      if (!url) return res.status(502).json({ ok: false, error: 'payplug_url_missing' });

      savePendingCheckout(payment.id, {
        order_type: 'materiel',
        order_id: orderId,
        customer,
        pickup_gym: customer.pickup_gym,
        items,
        total_cents,
        payplug_payment_id: payment.id,
      });

      res.json({
        ok: true,
        mode: 'payplug',
        url,
        payment_id: payment.id,
        order_id: orderId,
      });
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
        seance_offerte: await require('./lib/seance-offerte-visits').summarizeSeanceOfferteVisits(14),
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
      const orderId = sanitizeOrderId(req.params.orderId);
      if (!orderId) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const order = await loadMaterielOrderAsync(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Commande introuvable' });
      if (order.payment?.status !== 'paid') {
        return res.status(403).json({ ok: false, error: 'Facture disponible uniquement après paiement' });
      }
      const token = String(req.query.token || '');
      const adminOk = await isAuthorizedAdmin(req);
      if (!adminOk) {
        if (!order.access_token || !secretsEqual(token, order.access_token)) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }
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
        demo_checkout_enabled: isDemoCheckoutAllowed(),
        store_url: STORE_URL,
        production_url: PRODUCTION_STORE_URL,
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
    if (!isAuthorizedCron(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { runCatalogSyncIfNeeded } = require('./lib/auto-sync');
    const result = await runCatalogSyncIfNeeded({ force: true });
    let nudges = { count: 0 };
    try {
      const { dispatchDueNudges } = require('./lib/inscription-nudge');
      nudges = await dispatchDueNudges();
    } catch (err) {
      logWarn('Relances inscription (cron catalogue)', { error: err.message });
    }
    let payplug = { skipped: true };
    try {
      if (isPayplugEnabled()) {
        payplug = await reconcilePayplugPayments({ listRecent: true, scanPending: false });
      }
    } catch (err) {
      logWarn('PayPlug réconciliation (cron catalogue)', { error: err.message });
      payplug = { ok: false, error: err.message };
    }
    res.json({
      ok: result.ok !== false,
      ...result,
      nudges: { count: nudges.count || 0 },
      payplug: { marked: payplug.marked || 0, checked: payplug.checked || 0 },
    });
  });

  app.get('/api/cron/inscription-nudges', async (req, res) => {
    if (!isAuthorizedCron(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const { dispatchDueNudges } = require('./lib/inscription-nudge');
      const result = await dispatchDueNudges();
      res.json(result);
    } catch (err) {
      logError('Cron relances inscription', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/internal/inscription-nudges', async (req, res) => {
    if (!isAuthorizedSync(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { listDueNudges } = require('./lib/inscription-nudge');
    const orders = await listDueNudges();
    res.json({ ok: true, orders });
  });

  app.post('/api/internal/inscription-nudges/:id/sent', async (req, res) => {
    if (!isAuthorizedSync(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { markNudgeSent } = require('./lib/inscription-nudge');
    const order = await markNudgeSent(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, order_id: order.order_id });
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
    let kept = raw;
    try {
      const { pruneAbandonedInscriptions } = require('./lib/order-prune');
      const pruned = await pruneAbandonedInscriptions(raw);
      kept = pruned.kept;
    } catch (err) {
      logWarn('Prune inscriptions admin', { error: err.message });
    }
    for (const order of kept) {
      if (order.signature?.signed_at && !order.gestion_client_id) {
        await syncInscriptionClient(order);
      }
    }
    const orders = kept.map(toAdminSummary);
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

  app.get('/api/admin/orders/:id/resume-link', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const order = await loadOrderAsync(String(req.params.id || '').trim());
    if (!order) {
      return res.status(404).json({ ok: false, error: 'not_found', message: 'Référence introuvable' });
    }
    const { describeResume, canPayOrder, productNeedsPayment } = require('./lib/inscription-nudge');
    if (order.action || !order.access_token) {
      return res.status(400).json({
        ok: false,
        error: order.action ? 'not_inscription' : 'no_token',
        message: order.action
          ? 'Cette référence n’est pas une inscription boutique'
          : 'Pas de jeton de reprise pour cette référence',
      });
    }
    const kind = String(req.query.kind || '').toLowerCase() === 'pay' ? 'pay' : 'resume';
    if (kind === 'pay' && !canPayOrder(order)) {
      const st = String(order.payment?.status || '');
      const message =
        st === 'paid' || st === 'free'
          ? 'Cette inscription est déjà payée'
          : st === 'past_due'
            ? 'Impayé d’abonnement — utilisez le suivi CB, pas le tunnel d’inscription'
            : !productNeedsPayment(order)
              ? 'Cette offre ne nécessite pas de paiement'
              : 'Impossible de générer un lien de paiement';
      return res.status(400).json({ ok: false, error: 'cannot_pay', message });
    }
    const info = describeResume(order, { kind });
    res.json({
      ok: true,
      ...info,
      message:
        kind === 'pay'
          ? 'Lien de paiement — étape Paiement'
          : info.completed
            ? 'Inscription déjà terminée — lien vers la confirmation'
            : `Lien de reprise — étape ${info.step_label}`,
    });
  });

  app.post('/api/admin/orders/:id/send-resume-email', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const order = await loadOrderAsync(String(req.params.id || '').trim());
    if (!order) {
      return res.status(404).json({ ok: false, error: 'not_found', message: 'Référence introuvable' });
    }
    const { describeResume, canPayOrder, sendResumeEmail } = require('./lib/inscription-nudge');
    if (order.action || !order.access_token) {
      return res.status(400).json({
        ok: false,
        error: 'not_inscription',
        message: 'Cette référence n’est pas une inscription boutique',
      });
    }
    const kind = String(req.body?.kind || req.query.kind || '').toLowerCase() === 'pay' ? 'pay' : 'resume';
    if (kind === 'pay' && !canPayOrder(order)) {
      return res.status(400).json({ ok: false, error: 'cannot_pay', message: 'Impossible d’envoyer un lien de paiement' });
    }
    try {
      const mailed = await sendResumeEmail(order, { kind });
      if (!mailed.sent) {
        return res.status(502).json({
          ok: false,
          error: mailed.error || mailed.reason || 'email_not_sent',
          message:
            mailed.error === 'no_email'
              ? 'Pas d’e-mail sur ce dossier'
              : 'Envoi e-mail impossible (Brevo)',
        });
      }
      const info = describeResume(order, { kind });
      logInfo('Lien de reprise envoyé par e-mail', {
        order_id: order.order_id,
        kind,
        via: mailed.via,
      });
      res.json({
        ok: true,
        sent: true,
        to: mailed.to,
        kind,
        message: `E-mail envoyé à ${mailed.to}`,
        ...info,
      });
    } catch (err) {
      logError('Envoi lien de reprise', { order_id: order.order_id, error: err.message });
      res.status(500).json({ ok: false, error: err.message, message: 'Envoi e-mail échoué' });
    }
  });

  app.post('/api/admin/orders/send-resume-email-batch', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const ids = [
      ...new Set(
        (Array.isArray(req.body?.order_ids) ? req.body.order_ids : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      ),
    ];
    if (!ids.length) {
      return res.status(400).json({ ok: false, error: 'empty', message: 'Aucune personne sélectionnée' });
    }
    if (ids.length > 40) {
      return res.status(400).json({
        ok: false,
        error: 'too_many',
        message: '40 destinataires maximum par diffusion',
      });
    }
    const { sendResumeEmail, canPayOrder } = require('./lib/inscription-nudge');
    const results = [];
    for (const id of ids) {
      const order = await loadOrderAsync(id);
      if (!order || order.action || !order.access_token) {
        results.push({ order_id: id, ok: false, error: 'not_inscription' });
        continue;
      }
      try {
        const kind = canPayOrder(order) ? 'pay' : 'resume';
        const mailed = await sendResumeEmail(order, { kind });
        results.push({
          order_id: id,
          ok: Boolean(mailed.sent),
          to: mailed.to || null,
          error: mailed.error || mailed.reason || null,
        });
      } catch (err) {
        results.push({ order_id: id, ok: false, error: err.message });
      }
    }
    const sent = results.filter((r) => r.ok).length;
    logInfo('Diffusion mails de reprise', { sent, total: ids.length });
    res.json({
      ok: sent > 0,
      sent,
      total: ids.length,
      results,
      message: `${sent} e-mail(s) envoyé(s) sur ${ids.length}`,
    });
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
    streamOrderFacturePdf(order, res);
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
        const pdfPath = order.documents?.invoice_pdf || order.documents?.contract_pdf;
        const pdfName =
          order.documents?.invoice_filename || order.documents?.contract_filename || 'facture.pdf';
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

  /** Photo seule vers Deciplus — ne recrée pas l’abonnement. */
  app.post('/api/admin/orders/:id/redispatch-photo', async (req, res) => {
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const order = await loadOrderAsync(req.params.id);
      if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
      const dispatch = await dispatchMemberPhoto(order);
      res.json({
        ok: true,
        order_id: order.order_id,
        action: 'member_photo',
        queued: dispatch?.queued,
        forwarded: dispatch?.forwarded,
      });
    } catch (err) {
      logError('Redispatch photo admin', { order_id: req.params.id, error: err.message });
      const status = err.message === 'photo_manquante' ? 400 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/tunnel-lead', async (req, res) => {
    try {
      const result = await insertTunnelLead(req.body || {});
      if (!result.ok) {
        const msg = result.error || 'lead_failed';
        const status =
          result.error === 'supabase_not_configured' || /tunnel_leads absente/i.test(msg)
            ? 503
            : 400;
        return res.status(status).json({ ok: false, error: msg });
      }
      res.json({ ok: true, lead_id: result.lead_id, portet_synced: Boolean(result.portet_synced) });
    } catch (err) {
      logError('API tunnel-lead', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/balma-switch', async (req, res) => {
    try {
      const parsed = validateBalmaSwitchPayload(req.body || {});
      if (parsed.errors.length) {
        return res.status(400).json({ ok: false, errors: parsed.errors, error: parsed.errors[0] });
      }
      const order = buildBalmaSwitchOrder(parsed);
      let forwarded = { forwarded: false };
      try {
        forwarded = await forwardJobToBot(order);
      } catch (err) {
        logError('balma_switch forward', { error: err.message, order_id: order.order_id });
      }
      const redirect = inscriptionUrl({
        productId: parsed.offer,
        firstName: parsed.first_name,
        lastName: parsed.last_name,
        birthdate: parsed.birthdate,
        boutiqueBase: getStoreUrl(),
      });
      res.json({
        ok: true,
        order_id: order.order_id,
        queued: Boolean(forwarded.forwarded),
        redirect,
      });
    } catch (err) {
      logError('API balma-switch', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/balma-offers', async (_req, res) => {
    try {
      await hydrateMerchOnce();
      res.json({ ok: true, offers: listBalmaPrelevementOffers() });
    } catch (err) {
      logError('API balma-offers', { error: err.message });
      res.status(500).json({ ok: false, error: err.message, offers: [] });
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
        const errors = validateShortForm(rest, { requireBirthdate: true, product });
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
        gym: gym || (isBalmaRetourSource(rest.source) ? 'minimes' : undefined),
        referral_friend: sanitizeFriend(rest.referral_friend || rest.friend) || undefined,
        source: rest.source || undefined,
      });
      if (customer_short) {
        await syncInscriptionClient(order).catch((err) =>
          logError('Sync client inscription (draft)', { order_id: order.order_id, error: err.message })
        );
        await maybeRecordTunnelLeadFromOrder(order).catch((err) =>
          logError('Lead tunnel (draft)', { order_id: order.order_id, error: err.message })
        );
        await maybeNotifyOffre29Friend(order, rest.referral_friend || rest.friend).catch((err) =>
          logWarn('Notif ami offre 29 (draft)', { order_id: order.order_id, error: err.message })
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
      const product = findProduct(order.product_id) || order.product_snapshot;
      const short = {
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        email: req.body.email,
        phone: req.body.phone,
        birthdate: req.body.birthdate || order.customer_short?.birthdate || null,
      };
      const errors = validateShortForm(short, { requireBirthdate: true, product });
      if (errors.length) return res.status(400).json({ ok: false, errors });
      if (!order.customer_full?.gym && !req.body.gym) {
        return res.status(400).json({ ok: false, errors: ['Choisissez d\'abord votre salle'] });
      }
      if (req.body.gym) await updateGymAsync(order.order_id, req.body.gym);
      const friend = sanitizeFriend(req.body.referral_friend || req.body.friend);
      if (friend) await attachReferralFriendAsync(order.order_id, friend);
      const updated = await updateShortProfile(order.order_id, short);
      await syncInscriptionClient(updated).catch((err) =>
        logError('Sync client inscription (identity)', { order_id: order.order_id, error: err.message })
      );
      await maybeNotifyOffre29Friend(updated, friend).catch((err) =>
        logWarn('Notif ami offre 29 (identity)', { order_id: order.order_id, error: err.message })
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

  app.post('/api/orders/:id/photo', (req, res, next) => {
    uploadPhoto.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_image_type',
          message: 'Envoyez une photo JPEG, PNG ou WebP (max 3,5 Mo).',
        });
      }
      next();
    });
  }, async (req, res) => {
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

      const { isCloudinaryConfigured, uploadImageBuffer } = require('./lib/cloudinary');
      let buf;
      try {
        buf = fs.readFileSync(req.file.path);
      } catch (readErr) {
        return res.status(400).json({ ok: false, error: 'photo_unreadable', message: readErr.message });
      }
      if (!looksLikeAllowedImage(buf, req.file.mimetype)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
        return res.status(400).json({
          ok: false,
          error: 'invalid_image_type',
          message: 'Envoyez une photo JPEG, PNG ou WebP.',
        });
      }
      if (buf.length > 1.8 * 1024 * 1024) {
        return res.status(400).json({
          ok: false,
          error: 'photo_too_large',
          message: 'Photo trop lourde (max ~1,5 Mo). Compressez ou choisissez une autre image.',
        });
      }

      const documents = {
        ...(order.documents || {}),
        photo: req.file.path,
        photo_filename: req.file.filename,
      };

      if (isCloudinaryConfigured()) {
        try {
          const uploaded = await uploadImageBuffer({
            buffer: buf,
            mime: req.file.mimetype || 'image/jpeg',
            filename: req.file.filename || 'photo.jpg',
            publicId: `boxplus/photos/${order.order_id}`,
          });
          documents.photo_url = uploaded.url || uploaded.secure_url;
          documents.photo_public_id = uploaded.public_id;
        } catch (cloudErr) {
          logError('Upload photo Cloudinary', { order_id: order.order_id, error: cloudErr.message });
          return res.status(502).json({
            ok: false,
            error: 'cloudinary_failed',
            message: 'Impossible d’enregistrer la photo. Réessayez dans un instant.',
          });
        }
      } else if (process.env.VERCEL) {
        return res.status(503).json({
          ok: false,
          error: 'cloudinary_not_configured',
          message: 'Stockage photo indisponible. Ajoutez CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET sur Vercel.',
        });
      }

      order.documents = documents;
      const { saveOrderAsync } = require('./lib/order-lifecycle');
      await saveOrderAsync(order);
      res.json({
        ok: true,
        photo: true,
        path: req.file.filename,
        stored: Boolean(documents.photo_url || documents.photo),
        cloudinary: Boolean(documents.photo_url),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/orders/:id', async (req, res) => {
    const token = requestAccessToken(req);
    const order = await loadOrderOrRecover(req.params.id, {
      token,
      sessionId: req.query.session_id,
      stripe,
      findProduct,
    });
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, token)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const safe = redactOrderForClient(order);
    res.json({ ok: true, order: safe });
  });

  app.get('/api/orders/:id/status', async (req, res) => {
    const token = requestAccessToken(req);
    const order = await loadOrderOrRecover(req.params.id, {
      token,
      sessionId: req.query.session_id,
      stripe,
      findProduct,
    });
    if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!verifyAccess(order, token)) {
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

  app.post('/api/orders/:id/nudge', async (req, res) => {
    const token = requestAccessToken(req);
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
    try {
      const { dispatchOneNudge } = require('./lib/inscription-nudge');
      const result = await dispatchOneNudge(order.order_id, { force: true });
      res.json(result);
    } catch (err) {
      logError('Relance inscription (client)', { order_id: order.order_id, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
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

      if (!order.documents?.photo && !order.documents?.photo_base64 && !order.documents?.photo_url) {
        return res.status(400).json({
          ok: false,
          error: 'photo_required',
          message: 'Ajoutez une photo pour votre badge / fiche membre.',
        });
      }

      if (order.documents?.photo) full.photo_path = order.documents.photo;
      if (order.documents?.photo_base64) full.photo_base64 = order.documents.photo_base64;
      if (order.documents?.photo_url) full.photo_url = order.documents.photo_url;

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
      let order = await loadOrderOrRecover(req.params.id, {
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
      const ageErr = adultOfferAgeError(
        order.customer_short?.birthdate || order.customer_full?.birthdate,
        product
      );
      if (ageErr) {
        return res.status(400).json({ ok: false, error: ageErr, code: 'adult_offer_age' });
      }
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
      let image_url = null;
      let image_public_id = null;
      try {
        const b64 = String(signature_image).split(',')[1];
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 200) {
          return res.status(400).json({ ok: false, error: 'Signature trop courte — signez dans le cadre' });
        }
        const fname = `${order.order_id}-${Date.now()}.png`;
        image_path = path.join(getUploadDir('signatures'), fname);
        fs.writeFileSync(image_path, buf);
        const { isCloudinaryConfigured, uploadImageBuffer } = require('./lib/cloudinary');
        if (isCloudinaryConfigured()) {
          const uploaded = await uploadImageBuffer({
            buffer: buf,
            mime: 'image/png',
            filename: fname,
            publicId: `boxplus/signatures/${order.order_id}`,
          });
          image_url = uploaded.url || uploaded.secure_url;
          image_public_id = uploaded.public_id;
        } else if (process.env.VERCEL) {
          return res.status(503).json({
            ok: false,
            error: 'cloudinary_not_configured',
            message: 'Stockage signature indisponible. Ajoutez les clés Cloudinary sur Vercel.',
          });
        }
      } catch (sigErr) {
        return res.status(400).json({ ok: false, error: 'Impossible d\'enregistrer la signature' });
      }

      const signed = await recordSignature(order.order_id, {
        consent_cgv: Boolean(consent_cgv),
        consent_reglement: Boolean(consent_reglement),
        consent_medical: Boolean(consent_medical),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        image_path,
        image_url,
        image_public_id,
        method: 'canvas',
      });

      const { filepath, filename } = await generateInscriptionInvoicePdf(signed);
      signed.documents = {
        ...(signed.documents || {}),
        invoice_pdf: filepath,
        invoice_filename: filename,
        contract_pdf: filepath,
        contract_filename: filename,
      };
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

      const emailResult = await sendConfirmationEmail(signed);
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
    streamOrderFacturePdf(order, res);
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

      const product = findProduct(order.product_id) || order.product_snapshot;
      const ageErr = adultOfferAgeError(
        order.customer_short?.birthdate || order.customer_full?.birthdate,
        product
      );
      if (ageErr) {
        return res.status(400).json({ ok: false, error: ageErr, code: 'adult_offer_age' });
      }

      if (order.payment?.status === 'paid') {
        return res.json({
          ok: true,
          mode: 'already_paid',
          redirect: inscriptionRedirect(order),
        });
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
      await maybeNotifyOffre29Friend(order).catch((err) =>
        logWarn('Notif ami offre 29 (pay)', { order_id: order.order_id, error: err.message })
      );

      const short = order.customer_short;
      const rawBilling = String(req.body.billing_plan || '').trim().toLowerCase();
      const billingPlan = normalizeBillingPlan(rawBilling, product);
      const paymentPlan = normalizePaymentPlan(req.body.payment_plan, product);
      const payMethod = String(req.body.pay_method || '').toLowerCase();
      const gym = order.customer_full?.gym || req.body.gym || 'minimes';
      const gymNorm = String(gym).trim().toLowerCase();
      const display = await resolvePaymentDisplay(req, gymNorm, {
        payplugReady: isPayplugEnabled(),
        paypalReady: isPaypalEnabled(gymNorm),
      });
      let preferredCheckout =
        payMethod === 'paypal' || rawBilling === 'paypal' || billingPlan === 'paypal'
          ? 'paypal'
          : 'card';
      if (display.portetViaPaypal) preferredCheckout = 'paypal';
      if (preferredCheckout === 'paypal' && !display.show_paypal) {
        return res.status(503).json({ ok: false, error: 'paypal_not_configured' });
      }
      if (preferredCheckout !== 'paypal' && !display.show_payplug) {
        return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
      }
      const badgeOn = productNeedsAutoBadge(product);
      const giftBadge = balmaBadgePaymentFields(order, product);
      const badgeTiming = giftBadge ? giftBadge.badge_timing : badgeOn ? 'deferred' : null;
      const badgeMethod = giftBadge ? giftBadge.badge_method : badgeOn ? 'iban' : null;

      order.payment = {
        ...(order.payment || {}),
        billing_plan: billingPlan || (preferredCheckout === 'paypal' ? 'paypal' : billingPlan),
        payment_plan: paymentPlan,
        preferred_checkout: preferredCheckout,
        iban: order.payment?.iban || null,
        badge_timing: badgeTiming,
        badge_method: badgeMethod,
      };
      if (badgeOn || giftBadge) {
        order.badge_timing = badgeTiming;
        order.badge_method = badgeMethod;
        if (giftBadge) order.source = order.source || 'balma_retour';
      } else {
        delete order.badge_timing;
        delete order.badge_method;
      }
      const { saveOrderAsync } = require('./lib/order-lifecycle');
      await saveOrderAsync(order);

      const isFreeProduct =
        product.requires_payment === false || Number(product.price_cents || 0) <= 0;
      if (isFreeProduct) {
        order = await markPaymentPaid(order.order_id, {
          method: 'free',
          status: 'paid',
          billing_plan: billingPlan || null,
          payment_plan: paymentPlan || null,
        });
        return res.json({
          ok: true,
          mode: 'free',
          redirect: inscriptionRedirect(order, STEPS.DOSSIER),
        });
      }

      const baseUrl = getCheckoutBaseUrl(req);
      const planLabel = paymentPlan || (productSupportsInstallmentChoice(product) ? 'once' : 'once');
      if (planLabel === '4x' && preferredCheckout !== 'paypal' && !isOney4xEnabled()) {
        return res.status(503).json({
          ok: false,
          error: ONEY_4X_UNAVAILABLE_MESSAGE,
          code: 'oney_4x_unavailable',
        });
      }

      if (isDemoCheckoutAllowed() && !isPayplugEnabled() && !isPaypalEnabled(gym)) {
        order = await markPaymentPaid(order.order_id, {
          method: 'demo',
          billing_plan: billingPlan,
          payment_plan: planLabel,
        });
        return res.json({
          ok: true,
          mode: 'demo',
          redirect: inscriptionRedirect(order),
        });
      }

      // ——— PayPal natif (1× ou tentative Pay Later si éligible côté PayPal) ———
      if (preferredCheckout === 'paypal') {
        if (!isPaypalEnabled(gym)) {
          return res.status(503).json({ ok: false, error: 'paypal_not_configured' });
        }
        const landing = String(req.body.paypal_landing || '').toLowerCase();
        const guestCard =
          planLabel !== '4x' &&
          (landing === 'billing' ||
            landing === 'guest' ||
            req.body.paypal_guest_card === true ||
            (Boolean(display.portetViaPaypal) && landing !== 'login' && payMethod !== 'paypal'));
        const ppOrder = await createPaypalOrder({
          order,
          product,
          amountCents: product.price_cents,
          baseUrl,
          paymentPlan: planLabel === '4x' ? '4x' : 'once',
          gym,
          guestCard,
          payerEmail: order.customer_short?.email || order.customer_full?.email,
        });
        if (!ppOrder.approve_url) {
          return res.status(502).json({ ok: false, error: 'paypal_url_missing' });
        }
        order.payment = {
          ...order.payment,
          method: 'paypal',
          preferred_checkout: 'paypal',
          payment_plan: planLabel === '4x' ? '4x' : 'once',
          paypal_order_id: ppOrder.id,
          paypal_account: ppOrder.paypal_account || paypalAccountForGym(gym),
          status: 'pending',
        };
        await saveOrderAsync(order);
        return res.json({
          ok: true,
          mode: 'paypal',
          url: ppOrder.approve_url,
          paypal_order_id: ppOrder.id,
        });
      }

      // ——— Carte PayPlug : 4× Oney ou 1× hosted ———
      if (!isPayplugEnabled()) {
        return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
      }

      const customerOverrides = {
        address: req.body.address || order.customer_full?.address,
        postal_code: req.body.postal_code || order.customer_full?.postal_code,
        city: req.body.city || order.customer_full?.city,
        gender: req.body.gender || order.customer_full?.gender,
        phone: req.body.phone || short?.phone,
      };

      try {
        let payment;
        if (planLabel === '4x') {
          payment = await createFourTimesPayment({
            order: {
              ...order,
              customer_full: { ...(order.customer_full || {}), gym, ...customerOverrides },
            },
            product,
            baseUrl,
            customerOverrides,
          });
        } else {
          payment = await createHostedPayment({
            order: {
              ...order,
              customer_full: { ...(order.customer_full || {}), gym, ...customerOverrides },
            },
            product,
            baseUrl,
            amountCents: product.price_cents,
            metadata: {
              payment_plan: 'once',
              billing_plan: billingPlan || '',
            },
            customerOverrides,
          });
        }

        order.payment = {
          ...order.payment,
          method: 'payplug',
          payment_plan: planLabel === '4x' ? '4x' : 'once',
          preferred_checkout: 'payplug',
          payplug_payment_ids: rememberPreviousPayplugId(order.payment, payment.id),
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
          mode: planLabel === '4x' ? 'payplug_4x' : 'payplug',
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
        logError('Erreur PayPlug checkout', {
          error: err.message,
          body: err.body || null,
          order_id: order.order_id,
        });
        return res.status(502).json({
          ok: false,
          error: formatPayplugError(err) || err.message,
        });
      }
    } catch (err) {
      logError('Erreur pay order', { error: err.message, gym: req.body?.gym });
      res.status(500).json({
        ok: false,
        error: formatPaypalError(err, { gym: req.body?.gym || '' }) || err.message,
      });
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
      const { assertMembershipAttemptAllowed } = require('./lib/membership-rate-limit');
      const limit = await assertMembershipAttemptAllowed(body, 'cancel');
      if (!limit.ok) {
        return res.status(429).json({
          ok: false,
          error: limit.error,
          message: limit.message || limit.error,
          code: limit.code,
          retry_after_sec: limit.retry_after_sec,
          locked_until: limit.locked_until,
          remaining: 0,
          max_attempts: limit.max_attempts,
        });
      }
      const { enqueueCancelRequest } = require('./lib/membership');
      const result = await enqueueCancelRequest(body);
      res.json({
        ok: true,
        ...result,
        rate_limit_remaining: limit.remaining,
        max_attempts: limit.max_attempts,
        rate_limit_message: limit.message,
      });
    } catch (err) {
      logError('Erreur résiliation', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/counsel', async (req, res) => {
    try {
      const body = req.body || {};
      const { guideRetention } = require('./lib/counselor-ai');
      const messages = Array.isArray(body.messages)
        ? body.messages
            .slice(-16)
            .map((m) => ({
              role: m.role === 'bot' || m.role === 'assistant' ? 'assistant' : 'user',
              content: String(m.content || m.text || m.html || '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 600),
            }))
            .filter((m) => m.content)
        : [];
      const result = await guideRetention({
        reasonId: body.reason_id || body.reason || 'other',
        reasonLabel: body.reason_label || '',
        freeText: body.free_text || body.message || '',
        messages,
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

  app.post('/api/membership/welcome-counsel', async (req, res) => {
    try {
      const body = req.body || {};
      const { guideWelcome, isInternalUnlockPhrase } = require('./lib/counselor-ai');
      const freeText = body.free_text || body.message || '';
      if (isInternalUnlockPhrase(freeText)) {
        if (getDevSession(req)) {
          return res.json({
            ok: true,
            reply: 'C’est bon, j’ouvre l’espace.',
            next: 'open',
            url: '/dev',
          });
        }
        return res.json({
          ok: true,
          reply: 'Ok. Envoie-moi le code.',
          next: 'code',
        });
      }
      const messages = Array.isArray(body.messages)
        ? body.messages
            .slice(-16)
            .map((m) => ({
              role: m.role === 'bot' || m.role === 'assistant' ? 'assistant' : 'user',
              content: String(m.content || m.text || m.html || '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 600),
            }))
            .filter(
              (m) =>
                m.content &&
                !isInternalUnlockPhrase(m.content) &&
                !/^\d{4,8}$/.test(m.content)
            )
        : [];
      const result = await guideWelcome({
        freeText,
        messages,
        /* Conseiller choisi côté client ; un identifiant inconnu retombe sur Chloe. */
        persona: body.persona,
      });
      res.json({
        ok: true,
        reply: result.reply,
        source: result.source,
        persona: result.persona,
      });
    } catch (err) {
      logError('Erreur welcome counsel', { error: err.message });
      res.status(500).json({
        ok: false,
        error: err.message,
        reply:
          'Je peux t’aider sur les offres, salles ou documents. Pour une résiliation, ouvre « Gérer mon abo » (David).',
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
      const { assertMembershipAttemptAllowed } = require('./lib/membership-rate-limit');
      const limit = await assertMembershipAttemptAllowed(body, 'change');
      if (!limit.ok) {
        return res.status(429).json({
          ok: false,
          error: limit.error,
          message: limit.message || limit.error,
          code: limit.code,
          retry_after_sec: limit.retry_after_sec,
          locked_until: limit.locked_until,
          remaining: 0,
          max_attempts: limit.max_attempts,
        });
      }
      const { enqueueVerifyIdentity } = require('./lib/membership');
      const result = await enqueueVerifyIdentity({ ...body, verify_mode: body.verify_mode || 'change' });
      res.json({
        ok: true,
        ...result,
        rate_limit_remaining: limit.remaining,
        max_attempts: limit.max_attempts,
        rate_limit_message: limit.message,
      });
    } catch (err) {
      logError('Erreur verify identité', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/rate-limit-status', async (req, res) => {
    try {
      const body = req.body || {};
      const scope = body.scope === 'cancel' ? 'cancel' : 'change';
      if (!body.first_name || !body.last_name || !body.birthdate) {
        return res.status(400).json({
          ok: false,
          error: 'Identité incomplète pour consulter le quota.',
        });
      }
      if (scope === 'cancel' && !body.phone) {
        return res.status(400).json({ ok: false, error: 'Téléphone requis.' });
      }
      if (scope === 'change' && !body.email && !body.phone) {
        return res.status(400).json({ ok: false, error: 'Email ou téléphone requis.' });
      }
      const { peekMembershipRateLimit } = require('./lib/membership-rate-limit');
      const status = await peekMembershipRateLimit(body, scope);
      res.json({ ok: true, ...status });
    } catch (err) {
      logError('Erreur rate-limit status', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/membership/change/checkout', async (req, res) => {
    try {
      const body = req.body || {};
      const product = findProduct(body.target_product_id);
      if (!product) return res.status(404).json({ ok: false, error: 'Offre introuvable' });
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
      const method = String(body.payment_method || body.method || 'payplug').toLowerCase();
      const gymNorm = String(body.gym || '').trim().toLowerCase();
      const display = await resolvePaymentDisplay(req, gymNorm, {
        payplugReady: isPayplugEnabled(),
        paypalReady: isPaypalEnabled(gymNorm),
      });
      let preferPaypal = method === 'paypal' || display.portetViaPaypal === true;
      const {
        productSupportsInstallmentChoice,
        normalizePaymentPlan,
      } = require('../../lib/billing-plan');
      const paymentPlan =
        normalizePaymentPlan(body.payment_plan, product) ||
        (productSupportsInstallmentChoice(product) ? 'once' : 'once');
      if (paymentPlan === '4x' && !preferPaypal && !isOney4xEnabled()) {
        return res.status(503).json({
          ok: false,
          error: ONEY_4X_UNAVAILABLE_MESSAGE,
          code: 'oney_4x_unavailable',
        });
      }
      if (preferPaypal && !display.show_paypal) {
        return res.status(503).json({ ok: false, error: 'paypal_not_configured' });
      }
      if (!preferPaypal && !display.show_payplug) {
        return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
      }

      const baseUrl = getCheckoutBaseUrl(req);
      let deciplusMemberId = body.deciplus_member_id || '';
      if (!deciplusMemberId && body.verify_order_id) {
        try {
          const verified = await loadOrderAsync(body.verify_order_id);
          if (verified?.deciplus_member_id) deciplusMemberId = verified.deciplus_member_id;
        } catch {
          /* ignore */
        }
      }
      const amountCents =
        paymentPlan === '4x'
          ? Math.round(Number(product.price_cents || 0) / 4)
          : Number(product.price_cents || 0);
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
        deciplus_member_id: String(deciplusMemberId || ''),
        payment_plan: paymentPlan,
        amount_cents: Number(product.price_cents || 0),
        charge_cents: amountCents,
      };

      const {
        saveMembershipChangePending,
      } = require('./lib/membership');

      if (preferPaypal) {
        const landing = String(body.paypal_landing || '').toLowerCase();
        const guestCard =
          paymentPlan !== '4x' &&
          (landing === 'billing' ||
            landing === 'guest' ||
            body.paypal_guest_card === true ||
            (Boolean(display.portetViaPaypal) && landing !== 'login' && method !== 'paypal'));
        const ppOrder = await createPaypalOrder({
          product,
          amountCents: product.price_cents,
          baseUrl,
          paymentPlan: paymentPlan === '4x' ? '4x' : 'once',
          description: product.display_name || product.name || 'Changement abo comptant',
          gym: gymNorm,
          guestCard,
          payerEmail: body.email,
          metadata: {
            order_id: body.verify_order_id || `chg-${Date.now()}`,
            verify_order_id: body.verify_order_id || '',
            gym: gymNorm,
            email: body.email || '',
          },
          returnUrl: `${baseUrl}/gerer-abonnement?change=1&paypal_return=1`,
          cancelUrl: `${baseUrl}/gerer-abonnement?change=cancelled`,
        });
        if (!ppOrder.approve_url) {
          return res.status(502).json({ ok: false, error: 'paypal_url_missing' });
        }
        await saveMembershipChangePending(ppOrder.id, {
          ...meta,
          payment_method: 'paypal',
          paypal_order_id: ppOrder.id,
          paypal_account: ppOrder.paypal_account || paypalAccountForGym(gymNorm),
        });
        return res.json({
          ok: true,
          mode: 'paypal',
          url: ppOrder.approve_url,
          paypal_order_id: ppOrder.id,
          product: {
            id: product.id,
            name: product.display_name || product.name,
            price_label: product.price_label || product.marketing_price_label,
            price_cents: product.price_cents,
            supports_installment_choice: productSupportsInstallmentChoice(product),
          },
        });
      }

      if (paymentPlan === '4x' && !isOney4xEnabled()) {
        return res.status(503).json({
          ok: false,
          error: ONEY_4X_UNAVAILABLE_MESSAGE,
          code: 'oney_4x_unavailable',
        });
      }

      if (paymentPlan === '4x') {
        const syntheticOrder = {
          order_id: body.verify_order_id || `chg-${Date.now()}`,
          customer_short: {
            first_name: body.first_name,
            last_name: body.last_name,
            email: body.email,
            phone: body.phone,
          },
          customer_full: {
            first_name: body.first_name,
            last_name: body.last_name,
            email: body.email,
            phone: body.phone,
            gym: body.gym || 'minimes',
            address: body.address,
            postal_code: body.postal_code,
            city: body.city,
            gender: body.gender,
          },
        };
        const payment = await createFourTimesPayment({
          order: syntheticOrder,
          product,
          baseUrl,
          customerOverrides: {
            first_name: body.first_name,
            last_name: body.last_name,
            email: body.email,
            phone: body.phone,
            address: body.address,
            postal_code: body.postal_code,
            city: body.city,
            gender: body.gender,
          },
          returnUrl: `${baseUrl}/gerer-abonnement?change=1&payplug_return=1`,
          cancelUrl: `${baseUrl}/gerer-abonnement?change=cancelled`,
          metadata: { order_type: 'membership_change' },
        });
        const url = hostedPaymentUrl(payment);
        if (!url) return res.status(502).json({ ok: false, error: 'payplug_url_missing' });
        await saveMembershipChangePending(payment.id, {
          ...meta,
          payment_method: 'payplug',
          payplug_payment_id: payment.id,
        });
        return res.json({
          ok: true,
          mode: 'payplug_4x',
          url,
          payment_id: payment.id,
          product: {
            id: product.id,
            name: product.display_name || product.name,
            price_label: product.price_label || product.marketing_price_label,
            price_cents: product.price_cents,
            supports_installment_choice: true,
          },
        });
      }

      const payment = await createHostedPayment({
        amountCents: product.price_cents,
        description: product.display_name || product.name || 'Changement abo comptant',
        baseUrl,
        metadata: meta,
        customerOverrides: {
          first_name: body.first_name,
          last_name: body.last_name,
          email: body.email,
          phone: body.phone,
        },
        returnUrl: `${baseUrl}/gerer-abonnement?change=1&payplug_return=1`,
        cancelUrl: `${baseUrl}/gerer-abonnement?change=cancelled`,
      });
      const url = hostedPaymentUrl(payment);
      if (!url) return res.status(502).json({ ok: false, error: 'payplug_url_missing' });
      await saveMembershipChangePending(payment.id, {
        ...meta,
        payment_method: 'payplug',
        payplug_payment_id: payment.id,
      });
      res.json({
        ok: true,
        mode: 'payplug',
        url,
        payment_id: payment.id,
        product: {
          id: product.id,
          name: product.display_name || product.name,
          price_label: product.price_label || product.marketing_price_label,
          price_cents: product.price_cents,
          supports_installment_choice: productSupportsInstallmentChoice(product),
        },
      });
    } catch (err) {
      if (err.code === 'payplug_customer_incomplete') {
        return res.status(400).json({
          ok: false,
          error: err.message,
          missing: err.missing || [],
        });
      }
      logError('Erreur change checkout', { error: err.message, body: err.body || null });
      res.status(500).json({ ok: false, error: formatPayplugError(err) || err.message });
    }
  });

  app.post('/api/membership/change/confirm', async (req, res) => {
    try {
      const paymentId = req.body?.payment_id || req.body?.payplug_payment_id;
      const paypalOrderId = req.body?.paypal_order_id;
      const sessionId = req.body?.session_id;
      const {
        confirmMembershipChangeOnce,
        resolveDeciplusMemberId,
        getCancelStatus,
        loadMembershipChangePending,
      } = require('./lib/membership');

      if (paypalOrderId) {
        const pending = await loadMembershipChangePending(paypalOrderId);
        if (!isPaypalEnabled(pending?.paypal_account || pending?.gym)) {
          return res.status(503).json({ ok: false, error: 'paypal_not_configured' });
        }
        const paypalOpts = {
          gym: pending?.gym,
          account: pending?.paypal_account,
        };
        let captured = await retrievePaypalOrder(paypalOrderId, paypalOpts);
        if (!isPaypalOrderPaid(captured)) {
          try {
            captured = await capturePaypalOrder(paypalOrderId, paypalOpts);
          } catch (capErr) {
            // Déjà capturé / course webhook → relecture
            logWarn('PayPal change capture', { error: capErr.message, paypal_order_id: paypalOrderId });
            captured = await retrievePaypalOrder(paypalOrderId, paypalOpts);
          }
        }
        if (!isPaypalOrderPaid(captured)) {
          return res.status(402).json({
            ok: false,
            error: 'paiement non confirmé',
            paypal_status: captured?.status || null,
          });
        }
        if (!pending?.target_product_id) {
          return res.status(404).json({ ok: false, error: 'changement introuvable pour ce paiement' });
        }
        const changeBound = paypalMatches({
          captured,
          orderId: pending.verify_order_id || pending.order_id,
          expectedCents: pending.charge_cents || pending.amount_cents,
          storedPaypalId: paypalOrderId,
        });
        if (!changeBound.ok) {
          return res.status(409).json({ ok: false, error: changeBound.error });
        }
        const deciplusMemberId = await resolveDeciplusMemberId(
          {
            deciplus_member_id: pending.deciplus_member_id,
            verify_order_id: pending.verify_order_id,
          },
          getCancelStatus
        );
        const result = await confirmMembershipChangeOnce({
          identity: {
            first_name: pending.first_name,
            last_name: pending.last_name,
            birthdate: pending.birthdate,
            email: pending.email,
            phone: pending.phone,
            gym: pending.gym || 'minimes',
          },
          targetProductId: pending.target_product_id,
          stripeSessionId: `paypal_${paypalOrderId}`,
          deciplusMemberId,
        });
        return res.json({ ok: true, ...result, mode: 'paypal' });
      }

      if (paymentId && isPayplugEnabled()) {
        const safePayId = sanitizePaymentId(paymentId);
        if (!safePayId) return res.status(400).json({ ok: false, error: 'payment_id manquant' });
        const payment = await retrievePayment(safePayId);
        if (!isPayplugPaymentPaid(payment)) {
          return res.status(402).json({ ok: false, error: 'paiement non confirmé' });
        }
        const meta = payment.metadata || {};
        const pendingChange = await loadMembershipChangePending(payment.id);
        if (String(meta.order_type || pendingChange?.order_type || '') !== 'membership_change') {
          return res.status(409).json({ ok: false, error: 'payment_mismatch' });
        }
        const target = findProduct(meta.target_product_id || pendingChange?.target_product_id);
        const changeBound = payplugMatches({
          payment,
          orderId: pendingChange?.verify_order_id || meta.verify_order_id || meta.order_id,
          expectedCents:
            pendingChange?.charge_cents ||
            pendingChange?.amount_cents ||
            meta.charge_cents ||
            meta.amount_cents ||
            target?.price_cents,
          storedPaymentId: pendingChange?.payplug_payment_id,
        });
        if (!changeBound.ok) {
          return res.status(409).json({ ok: false, error: changeBound.error });
        }
        const deciplusMemberId = await resolveDeciplusMemberId(meta, getCancelStatus);
        const result = await confirmMembershipChangeOnce({
          identity: {
            first_name: meta.first_name,
            last_name: meta.last_name,
            birthdate: meta.birthdate,
            email: meta.email,
            phone: meta.phone,
            gym: meta.gym || 'minimes',
          },
          targetProductId: meta.target_product_id,
          stripeSessionId: `payplug_${payment.id}`,
          deciplusMemberId,
        });
        return res.json({ ok: true, ...result, mode: 'payplug' });
      }

      if (!sessionId || !stripe) {
        return res.status(400).json({
          ok: false,
          error: 'payment_id, paypal_order_id ou session_id requis',
        });
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!isStripeCheckoutPaid(session)) {
        return res.status(402).json({ ok: false, error: 'paiement non confirmé' });
      }
      const meta = session.metadata || {};
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
      const result = await confirmMembershipChangeOnce({
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
    const plan =
      payment.metadata?.payment_plan ||
      order.payment?.payment_plan ||
      'once';
    const hist = rememberPreviousPayplugId(order.payment, payment.id);
    const paid = await markPaymentPaid(order.order_id, {
      method: 'payplug',
      payment_plan: plan,
      billing_plan: order.payment?.billing_plan || payment.metadata?.billing_plan || null,
      payplug_payment_ids: hist,
      payplug_payment_id: payment.id,
      status: 'paid',
    });
    return paid;
  }

  function inscriptionEmail(order) {
    return String(
      order?.customer_short?.email || order?.customer_full?.email || order?.customer?.email || ''
    )
      .trim()
      .toLowerCase();
  }

  async function fulfillInscriptionPayplug(payment, orderHint = null) {
    const meta = payment.metadata || {};
    const orderId = meta.lifecycle_order_id || meta.order_id || orderHint?.order_id || null;
    let order = orderHint;
    if (!order && orderId) order = await loadOrderAsync(orderId);
    if (!order) {
      return { ok: false, error: 'order_not_found', http: 200, ignored: true };
    }
    if (order.payment?.status === 'paid' || order.payment?.status === 'free') {
      return { ok: true, already_paid: true, order_id: order.order_id };
    }
    const bound = payplugMatches({
      payment,
      orderId: order.order_id,
      expectedCents: expectedChargeCents(order, findProduct(order.product_id) || order.product_snapshot),
      storedPaymentId: order.payment?.payplug_payment_id,
    });
    if (!bound.ok) {
      const metaOrder = String(meta.lifecycle_order_id || meta.order_id || meta.verify_order_id || '').trim();
      const amountOk = paidMatchesExpected(
        payment.amount || payment.authorized_amount,
        expectedChargeCents(order, findProduct(order.product_id) || order.product_snapshot)
      );
      const trustedHint =
        orderHint &&
        orderHint.order_id === order.order_id &&
        amountOk &&
        (!metaOrder || metaOrder === order.order_id);
      if (!trustedHint) {
        return { ok: false, error: bound.error, http: 409, order_id: order.order_id };
      }
    }
    if (isPayplugPaymentPaid(payment)) {
      await markPayplugOrderPaid(order, payment);
      logInfo('PayPlug confirmé', {
        order_id: order.order_id,
        payment_id: payment.id,
        payment_plan: payment.metadata?.payment_plan || order.payment?.payment_plan,
      });
      return { ok: true, paid: true, order_id: order.order_id, payment_id: payment.id };
    }
    if (payment.failure) {
      await markPaymentFailed(order.order_id, {
        method: 'payplug',
        payment_plan: payment.metadata?.payment_plan || order.payment?.payment_plan || 'once',
        payplug_payment_id: payment.id,
        failure: payment.failure,
      }).catch(() => {});
      return { ok: true, failed: true, order_id: order.order_id };
    }
    return { ok: true, pending: true, order_id: order.order_id };
  }

  async function findUnpaidOrderForPayplug(payment, orders) {
    const metaId = String(
      payment?.metadata?.lifecycle_order_id || payment?.metadata?.order_id || ''
    ).trim();
    if (metaId) {
      const byId = orders.find((o) => o.order_id === metaId);
      if (byId) return byId;
      const loaded = await loadOrderAsync(metaId);
      if (loaded) return loaded;
    }
    const email = String(payment?.billing?.email || payment?.metadata?.email || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) return null;
    const amount = payment.amount || payment.authorized_amount;
    const hits = orders.filter((order) => {
      if (String(order.payment?.status) === 'paid' || String(order.payment?.status) === 'free') {
        return false;
      }
      if (inscriptionEmail(order) !== email) return false;
      const expected = expectedChargeCents(
        order,
        findProduct(order.product_id) || order.product_snapshot
      );
      return paidMatchesExpected(amount, expected);
    });
    return hits.length === 1 ? hits[0] : null;
  }

  async function retrievePayplugPaymentSafe(paymentId) {
    const id = sanitizePaymentId(paymentId);
    if (!id) return null;
    try {
      return await retrievePayment(id);
    } catch {
      try {
        return await runPaymentContext({ test: true }, () => retrievePayment(id));
      } catch {
        return null;
      }
    }
  }

  async function reconcilePayplugPayments({
    paymentIds = [],
    orderIds = [],
    listRecent = false,
    scanPending = false,
  } = {}) {
    const results = [];
    const seen = new Set();
    let recentUnpaid = [];
    if (scanPending) {
      const orders = await listAllOrdersAsync();
      const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
      recentUnpaid = orders
        .filter((order) => {
          if (String(order.payment?.status) === 'paid' || String(order.payment?.status) === 'free') {
            return false;
          }
          if (!payplugIdCandidates(order).length) return false;
          const t = Date.parse(order.updated_at || order.created_at || 0);
          return Number.isFinite(t) && t >= cutoff;
        })
        .slice(0, 25);
    }

    async function tryOne(paymentId, orderHint) {
      const id = sanitizePaymentId(paymentId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const payment = await retrievePayplugPaymentSafe(id);
      if (!payment) {
        results.push({ payment_id: id, ok: false, error: 'retrieve_failed' });
        return;
      }
      const metaType = String(payment.metadata?.order_type || '');
      if (metaType === 'echeancier' || metaType === 'materiel' || metaType === 'membership_change') {
        results.push({ payment_id: id, ok: true, skipped: metaType });
        return;
      }
      const order = orderHint || (await findUnpaidOrderForPayplug(payment, recentUnpaid));
      const out = await fulfillInscriptionPayplug(payment, order);
      results.push({ payment_id: id, ...out });
    }

    for (const id of paymentIds) await tryOne(id, null);

    if (scanPending) {
      for (const order of recentUnpaid) {
        for (const id of payplugIdCandidates(order)) await tryOne(id, order);
      }
    }

    const wantedOrders = new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    const wantedOrderList = [];
    for (const id of wantedOrders) {
      const loaded = await loadOrderAsync(id);
      if (loaded) wantedOrderList.push(loaded);
    }
    if ((wantedOrders.size || listRecent) && isPayplugEnabled()) {
      const maxPages = wantedOrders.size ? 6 : 1;
      for (let page = 0; page < maxPages; page += 1) {
        let listing;
        try {
          listing = await listPayments({ page, perPage: 10 });
        } catch (err) {
          logWarn('PayPlug liste paiements', { error: err.message, page });
          results.push({ ok: false, error: 'list_failed', page, message: err.message });
          break;
        }
        const rows = listing?.data || listing?.payments || [];
        for (const row of rows) {
          const metaId = String(row?.metadata?.lifecycle_order_id || row?.metadata?.order_id || '').trim();
          const payEmail = String(row?.billing?.email || row?.metadata?.email || '')
            .trim()
            .toLowerCase();
          let order = null;
          if (wantedOrders.size) {
            order =
              wantedOrderList.find((o) => o.order_id === metaId) ||
              (payEmail ? wantedOrderList.find((o) => inscriptionEmail(o) === payEmail) : null);
            if (!order) continue;
          } else {
            order = await findUnpaidOrderForPayplug(row, recentUnpaid);
          }
          if (!isPayplugPaymentPaid(row)) continue;
          const id = sanitizePaymentId(row.id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (!order || String(order.payment?.status) === 'paid' || String(order.payment?.status) === 'free') {
            continue;
          }
          const out = await fulfillInscriptionPayplug(row, order);
          results.push({ payment_id: id, ...out });
        }
        if (!listing?.has_more && rows.length < 10) break;
      }
    }

    const marked = results.filter((r) => r.paid).length;
    const already = results.filter((r) => r.already_paid).length;
    logInfo('PayPlug réconciliation', { checked: results.length, marked, already });
    return { ok: true, checked: results.length, marked, already, results };
  }

  registerEcheancierPayRoutes(app);

  app.get('/api/payments/config', async (req, res) => {
    const gym = req.query.gym;
    const display = await resolvePaymentDisplay(req, gym, {
      payplugReady: isPayplugEnabled(),
      paypalReady: isPaypalEnabled(gym),
    });
    res.json({
      ok: true,
      payplug: isPayplugEnabled(),
      paypal: isPaypalEnabled(gym),
      paypal_client_id:
        display.show_paypal && isPaypalEnabled(gym) ? paypalPublicClientId(gym) : null,
      paypal_mode: paypalMode(),
      paypal_account: paypalAccountForGym(gym),
      show_payplug: display.show_payplug,
      show_paypal: display.show_paypal,
      portet_via_paypal: display.portetViaPaypal === true,
      oney_4x: isOney4xEnabled(),
      oney_4x_message: isOney4xEnabled() ? null : ONEY_4X_UNAVAILABLE_MESSAGE,
      preview: display.preview,
      sandbox: Boolean(display.preview),
    });
  });

  app.post('/api/webhooks/payplug', async (req, res) => {
    try {
      const secret = process.env.PAYPLUG_SECRET_KEY || '';
      const sig = req.headers['payplug-signature'] || req.headers['Payplug-Signature'];
      if (sig && secret && !verifyPayplugSignature(req.rawBody || '', sig, secret)) {
        return res.status(400).json({ ok: false, error: 'invalid_signature' });
      }
      const body = req.body || {};
      const paymentId = sanitizePaymentId(body.id || body.resource_id || body.object?.id);
      if (!paymentId) return res.status(400).json({ ok: false, error: 'payment_id manquant' });
      if (!isPayplugEnabled()) return res.status(503).json({ ok: false, error: 'payplug_not_configured' });

      let payment;
      try {
        payment = await retrievePayment(paymentId);
      } catch (err) {
        payment = await runPaymentContext({ test: true }, () => retrievePayment(paymentId));
      }
      const meta = payment.metadata || {};

      if (String(meta.order_type || '') === 'echeancier') {
        const out = await fulfillEcheancierIfPaid(payment);
        return res.json({ ok: true, echeancier: true, ...(out || {}) });
      }

      // Changement d’abo (pas de lifecycle order)
      if (meta.order_type === 'membership_change' && isPayplugPaymentPaid(payment)) {
        const {
          confirmMembershipChangeOnce,
          resolveDeciplusMemberId,
          getCancelStatus,
        } = require('./lib/membership');
        const deciplusMemberId = await resolveDeciplusMemberId(meta, getCancelStatus);
        const result = await confirmMembershipChangeOnce({
          identity: {
            first_name: meta.first_name,
            last_name: meta.last_name,
            birthdate: meta.birthdate,
            email: meta.email,
            phone: meta.phone,
            gym: meta.gym || 'minimes',
          },
          targetProductId: meta.target_product_id,
          stripeSessionId: `payplug_${payment.id}`,
          deciplusMemberId,
        });
        logInfo('PayPlug changement abo confirmé', {
          payment_id: paymentId,
          already_processed: Boolean(result.already_processed),
          order_id: result.order_id,
        });
        return res.json({ ok: true, membership_change: true, already_processed: Boolean(result.already_processed) });
      }

      // Matériel
      if (meta.order_type === 'materiel') {
        const out = await fulfillMaterielPayplug(paymentId);
        return res.json({
          ok: true,
          materiel: true,
          fulfilled: Boolean(out.ok),
          order_id: out.order_id || meta.order_id || null,
          status: out.error || (out.already_processed ? 'already_paid' : 'ok'),
        });
      }

      const out = await fulfillInscriptionPayplug(payment);
      if (!out.ok && out.ignored) {
        logWarn('PayPlug webhook ignoré', { payment_id: paymentId, error: out.error });
        return res.json({ ok: true, ignored: true });
      }
      if (!out.ok && out.http === 409) {
        logWarn('PayPlug webhook — paiement non lié', {
          order_id: out.order_id,
          payment_id: paymentId,
          error: out.error,
        });
        return res.status(409).json({ ok: false, error: out.error });
      }
      return res.json({ ok: true, ...out });
    } catch (err) {
      logError('Erreur webhook PayPlug', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/internal/payplug-reconcile', async (req, res) => {
    if (!isAuthorizedSync(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!isPayplugEnabled()) return res.status(503).json({ ok: false, error: 'payplug_not_configured' });
    try {
      const paymentIds = Array.isArray(req.body?.payment_ids) ? req.body.payment_ids : [];
      const orderIds = Array.isArray(req.body?.order_ids) ? req.body.order_ids : [];
      const listRecent = req.body?.list_recent === true;
      const scanPending = req.body?.scan_pending === true;
      const out = await reconcilePayplugPayments({ paymentIds, orderIds, listRecent, scanPending });
      res.json(out);
    } catch (err) {
      logError('PayPlug réconciliation', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/cron/payplug-reconcile', async (req, res) => {
    if (!isAuthorizedCron(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (!isPayplugEnabled()) return res.json({ ok: true, skipped: 'payplug_not_configured' });
    try {
      const out = await reconcilePayplugPayments({ listRecent: true, scanPending: false });
      let nudges = { count: 0 };
      try {
        const { dispatchDueNudges } = require('./lib/inscription-nudge');
        nudges = await dispatchDueNudges();
      } catch (err) {
        logWarn('Relances inscription (cron PayPlug)', { error: err.message });
      }
      res.json({ ...out, nudges: { count: nudges.count || 0 } });
    } catch (err) {
      logError('Cron PayPlug réconciliation', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/confirm-payplug-materiel', async (req, res) => {
    try {
      const paymentId = req.body?.payment_id || req.body?.payplug_payment_id;
      const orderIdHint = req.body?.order_id || null;
      if (!paymentId && !orderIdHint) {
        return res.status(400).json({ ok: false, error: 'payment_id ou order_id requis' });
      }
      let id = sanitizePaymentId(paymentId);
      if (!id && orderIdHint) {
        const pendingByOrder = loadPendingCheckout(sanitizePaymentId(orderIdHint) || sanitizeOrderId(orderIdHint));
        id = sanitizePaymentId(pendingByOrder?.payplug_payment_id);
      }
      if (!id && orderIdHint) {
        const order = await loadMaterielOrderAsync(sanitizeOrderId(orderIdHint));
        id = sanitizePaymentId(order?.payment?.payplug_payment_id);
      }
      if (!id) return res.status(400).json({ ok: false, error: 'payment_id manquant' });

      const out = await fulfillMaterielPayplug(id);
      if (!out.ok) {
        const status = out.error === 'payment_failed' ? 402 : out.error === 'payment_pending' ? 202 : 400;
        return res.status(status).json(out);
      }
      return res.json(out);
    } catch (err) {
      logError('Erreur confirm PayPlug matériel', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/confirm-payplug', async (req, res) => {
    try {
      const { order_id: orderId, payment_id: paymentId } = req.body || {};
      const token = requestAccessToken(req);
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
      const id = sanitizePaymentId(paymentId || order.payment?.payplug_payment_id);
      if (!id) return res.status(400).json({ ok: false, error: 'payment_id manquant' });
      const payment = await retrievePayment(id);
      const bound = payplugMatches({
        payment,
        orderId: order.order_id,
        expectedCents: expectedChargeCents(order, findProduct(order.product_id) || order.product_snapshot),
        storedPaymentId: order.payment?.payplug_payment_id,
      });
      if (!bound.ok) {
        return res.status(409).json({ ok: false, error: bound.error });
      }
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
          message: payment.failure?.message || 'Paiement refusé',
        });
      }
      return res.json({
        ok: true,
        pending: isPayplugPaymentPending(payment) || true,
        message:
          'Votre paiement est en cours de validation. Merci de patienter quelques instants.',
      });
    } catch (err) {
      logError('Erreur confirm PayPlug', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/confirm-paypal', async (req, res) => {
    try {
      const { order_id: orderId, paypal_order_id: paypalOrderId } = req.body || {};
      const token = requestAccessToken(req);
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
      if (!isPaypalEnabled(order.payment?.paypal_account || order.customer_full?.gym)) {
        return res.status(503).json({ ok: false, error: 'paypal_not_configured' });
      }
      const id = sanitizePaymentId(paypalOrderId || order.payment?.paypal_order_id);
      if (!id) return res.status(400).json({ ok: false, error: 'paypal_order_id manquant' });

      const paypalOpts = {
        gym: order.customer_full?.gym,
        account: order.payment?.paypal_account,
      };
      let captured = await retrievePaypalOrder(id, paypalOpts);
      if (!isPaypalOrderPaid(captured)) {
        captured = await capturePaypalOrder(id, paypalOpts);
      }
      if (!isPaypalOrderPaid(captured)) {
        return res.status(402).json({
          ok: false,
          error: 'payment_not_completed',
          message: 'Paiement PayPal non confirmé',
        });
      }
      const bound = paypalMatches({
        captured,
        orderId: order.order_id,
        expectedCents: expectedChargeCents(order, findProduct(order.product_id) || order.product_snapshot),
        storedPaypalId: order.payment?.paypal_order_id,
      });
      if (!bound.ok) {
        return res.status(409).json({ ok: false, error: bound.error });
      }
      order = await markPaymentPaid(order.order_id, {
        method: 'paypal',
        payment_plan: order.payment?.payment_plan || 'once',
        billing_plan: order.payment?.billing_plan || 'paypal',
        paypal_order_id: id,
        status: 'paid',
      });
      return res.json({
        ok: true,
        paid: true,
        redirect: inscriptionRedirect(order),
      });
    } catch (err) {
      logError('Erreur confirm PayPal', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/checkout/demo', async (req, res) => {
    try {
      if (!isDemoCheckoutAllowed()) {
        return res.status(403).json({ ok: false, error: 'demo_disabled' });
      }
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
    '/regulariser': 'regulariser.html',
    '/checkout.html': 'checkout.html',
    '/admin': 'admin/index.html',
    '/admin/': 'admin/index.html',
    '/admin/login': 'admin/login.html',
    '/admin/contrats': 'admin/index.html',
    '/contrat': 'contrat.html',
  };

  for (const [route, file] of Object.entries(pageRoutes)) {
    app.get(route, (_req, res) => {
      res.type('text/html; charset=utf-8');
      if (route.startsWith('/admin')) {
        res.setHeader('Cache-Control', 'no-store');
      }
      res.sendFile(path.join(PUBLIC_DIR, file));
    });
  }

  app.get('/', (_req, res) => {
    res.type('text/html; charset=utf-8');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  const sendNotFoundPage = (res) => {
    res.status(404).type('text/html; charset=utf-8');
    res.sendFile(path.join(PUBLIC_DIR, '404.html'));
  };

  app.get(['/dev', '/dev/'], (req, res) => {
    if (!getDevSession(req)) return sendNotFoundPage(res);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'views', 'dev.html'));
  });

  app.get(['/404', '/404.html'], (_req, res) => sendNotFoundPage(res));

  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          if (filePath.replace(/\\/g, '/').includes('/admin/')) {
            res.setHeader('Cache-Control', 'no-store');
          }
        } else if (/\.(mp4|webm|jpg|jpeg|png|webp|woff2)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    return sendNotFoundPage(res);
  });

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
