'use strict';

const { verifyCheckoutToken, parseAppCheckoutQuery } = require('../../lib/app-checkout-token');
const { logWarn } = require('../../lib/logger');

const CLUBS = new Set(['minimes', 'saint-cyprien', 'etats-unis', 'ramonville', 'portet']);

async function bootstrapAppCheckout(query, { findProduct, createDraftAsync, inscriptionRedirect }) {
  const parsed = parseAppCheckoutQuery(query);
  if (!parsed) return { ok: false, status: 400, error: 'requete_invalide' };
  const secret = process.env.APP_BRIDGE_SECRET || '';
  if (!secret) return { ok: false, status: 503, error: 'app_checkout_indisponible' };
  if (parsed.expiresUnix < Math.floor(Date.now() / 1000)) {
    return { ok: false, status: 410, error: 'checkout_expire' };
  }
  if (!CLUBS.has(parsed.club)) return { ok: false, status: 400, error: 'club_invalide' };
  if (
    !verifyCheckoutToken(secret, parsed.sessionId, parsed.profileId, parsed.expiresUnix, parsed.signature)
  ) {
    return { ok: false, status: 401, error: 'signature_invalide' };
  }
  const product = findProduct(parsed.offerSlug);
  if (!product) {
    logWarn('Checkout app : offre inconnue', { offer: parsed.offerSlug });
    return { ok: false, status: 404, error: 'offre_inconnue' };
  }
  const order = await createDraftAsync({
    product_id: product.id,
    product,
    gym: parsed.club,
    source: 'app_mobile',
    app_checkout: {
      checkout_session_id: parsed.sessionId,
      profile_id: parsed.profileId,
      offer_slug: parsed.offerSlug,
      club: parsed.club,
    },
  });
  const redirect = inscriptionRedirect(order, order.step);
  return { ok: true, redirect, order_id: order.order_id };
}

async function replayAppBridgeOutbox({ listAllOrdersAsync, saveOrderAsync, limit = 40 }) {
  const { flushAppBridgeOutbox, isAppOrder } = require('../../lib/app-bridge-shop');
  const orders = await listAllOrdersAsync();
  let replayed = 0;
  let pending = 0;
  for (const order of orders) {
    if (!isAppOrder(order)) continue;
    if (!Array.isArray(order.app_bridge?.outbox) || !order.app_bridge.outbox.length) continue;
    pending += order.app_bridge.outbox.length;
    if (replayed >= limit) continue;
    await flushAppBridgeOutbox(order, saveOrderAsync);
    replayed += 1;
  }
  return { ok: true, replayed_orders: replayed, pending_events: pending };
}

module.exports = { bootstrapAppCheckout, replayAppBridgeOutbox };
