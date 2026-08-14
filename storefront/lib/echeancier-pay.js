'use strict';

const crypto = require('crypto');
const { logInfo, logWarn, logError } = require('../../lib/logger');
const { getCheckoutBaseUrl } = require('../../lib/app-urls');
const { forwardJobToBot } = require('../../lib/bot-forward');
const {
  createHostedPayment,
  retrievePayment,
  isPayplugPaymentPaid,
  isPayplugEnabled,
  hostedPaymentUrl,
  formatPayplugError,
} = require('./payplug');
const {
  isPaypalEnabled,
  createPaypalOrder,
  capturePaypalOrder,
  retrievePaypalOrder,
  isPaypalOrderPaid,
  formatPaypalError,
} = require('./paypal');
const { resolvePaymentDisplay, isPortetGym } = require('./payment-display');

const OFFER_LABELS = {
  '29': '29,99 €',
  '36': '36,99 €',
  '44': '44,99 €',
};

function paySecret() {
  return String(process.env.SYNC_SECRET || process.env.ECHEANCIER_PAY_SECRET || '').trim();
}

function verifyPayToken(token) {
  const secret = paySecret();
  if (!secret) return null;
  const raw = String(token || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot < 8) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const exp = Number(payload.x || payload.exp || 0);
  if (exp && Date.now() / 1000 > exp) return null;
  return payload;
}

function readToken(req) {
  return String(req.body?.token || req.body?.t || req.query?.t || req.query?.token || '').trim();
}

function decodePayload(payload) {
  if (!payload) return null;
  const gym = String(payload.g || 'minimes').toLowerCase() || 'minimes';
  const offer = String(payload.o || 'other');
  const amountCents = Number(payload.a) || 0;
  return {
    member_id: String(payload.m || ''),
    email: String(payload.e || ''),
    prenom: String(payload.p || ''),
    nom: String(payload.n || ''),
    amount_cents: amountCents,
    gym,
    offer,
    offer_label: OFFER_LABELS[offer] || `${(amountCents / 100).toFixed(2).replace('.', ',')} €`,
    portet: isPortetGym(gym),
  };
}

function formatEuros(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

async function fulfillEcheancierPayment({ provider, paymentId, meta = {}, amountCents = 0 }) {
  const memberId = String(meta.member_id || '').trim();
  if (!memberId) return { ok: false, error: 'member_id manquant' };
  const gym = String(meta.gym || 'minimes').toLowerCase() || 'minimes';
  const cents = Number(meta.amount_cents || amountCents || 0);
  const job = {
    order_id: `ENCAISSER-${provider}-${paymentId}`,
    action: 'encaisser',
    deciplus_member_id: memberId,
    gym,
    amount_cents: cents,
    product_name: 'Encaissement échéance impayée',
    requires_payment: false,
    requires_iban: false,
    sale_type: 'none',
    customer: {
      first_name: meta.first_name || '',
      last_name: meta.last_name || '',
      email: meta.email || '',
    },
    payment: { status: 'paid', amount: cents / 100, method: provider },
  };
  try {
    const forwarded = await forwardJobToBot(job);
    logInfo('Échéancier — job encaisser envoyé', {
      member_id: memberId,
      payment_id: paymentId,
      forwarded: forwarded.forwarded,
    });
    return { ok: true, forwarded: Boolean(forwarded.forwarded), order_id: job.order_id };
  } catch (err) {
    logError('Échéancier — forward encaisser échoué', { error: err.message, member_id: memberId });
    return { ok: false, error: err.message };
  }
}

async function fulfillEcheancierIfPaid(payment) {
  const meta = payment?.metadata || {};
  if (String(meta.order_type || '') !== 'echeancier') return null;
  if (!isPayplugPaymentPaid(payment)) return { ok: false, pending: true };
  return fulfillEcheancierPayment({
    provider: 'payplug',
    paymentId: payment.id,
    meta,
    amountCents: payment.amount,
  });
}

function metaFromInfo(info) {
  return {
    order_type: 'echeancier',
    member_id: String(info.member_id).slice(0, 40),
    gym: String(info.gym).slice(0, 20),
    amount_cents: String(info.amount_cents),
    first_name: String(info.prenom || '').slice(0, 40),
    last_name: String(info.nom || '').slice(0, 40),
    email: String(info.email || '').slice(0, 80),
    offer: String(info.offer || '').slice(0, 12),
  };
}

function registerEcheancierPayRoutes(app) {
  app.get('/api/echeancier/pay-info', async (req, res) => {
    const info = decodePayload(verifyPayToken(readToken(req)));
    if (!info?.member_id || !info.amount_cents) {
      return res.status(400).json({ ok: false, error: 'lien_invalide' });
    }
    const display = await resolvePaymentDisplay(req, info.gym, {
      payplugReady: isPayplugEnabled(),
      paypalReady: isPaypalEnabled(info.gym),
    });
    const showPaypal = Boolean(display.show_paypal);
    const showPayplug = info.portet ? false : Boolean(display.show_payplug);
    res.json({
      ok: true,
      prenom: info.prenom,
      amount_label: formatEuros(info.amount_cents),
      offer_label: info.offer_label,
      gym: info.gym,
      portet: info.portet,
      show_payplug: showPayplug,
      show_paypal: showPaypal,
      portet_via_paypal: info.portet && showPaypal,
    });
  });

  app.post('/api/echeancier/checkout', async (req, res) => {
    try {
      const token = readToken(req);
      const info = decodePayload(verifyPayToken(token));
      if (!info?.member_id || !info.amount_cents) {
        return res.status(400).json({ ok: false, error: 'lien_invalide' });
      }
      const method = String(req.body?.method || '').toLowerCase();
      const baseUrl = getCheckoutBaseUrl(req);
      const returnUrl = `${baseUrl}/regulariser?t=${encodeURIComponent(token)}`;
      const fakeOrder = {
        order_id: `ECH-${info.member_id}`,
        customer_short: { email: info.email, first_name: info.prenom, last_name: info.nom },
        customer_full: { gym: info.gym, email: info.email, first_name: info.prenom, last_name: info.nom },
      };
      const meta = metaFromInfo(info);

      if (method === 'paypal' || (info.portet && method !== 'payplug')) {
        if (!isPaypalEnabled(info.gym)) {
          return res.status(503).json({ ok: false, error: 'paypal_not_configured' });
        }
        const ppOrder = await createPaypalOrder({
          order: fakeOrder,
          product: { name: `Échéance Boxing Center ${info.offer_label}` },
          amountCents: info.amount_cents,
          baseUrl,
          paymentPlan: 'once',
          gym: info.gym,
          guestCard: info.portet,
          payerEmail: info.email,
          returnUrl: `${returnUrl}&paypal_return=1`,
          cancelUrl: `${returnUrl}&cancelled=1`,
          metadata: { ...meta, order_id: fakeOrder.order_id },
        });
        if (!ppOrder.approve_url) {
          return res.status(502).json({ ok: false, error: 'paypal_url_missing' });
        }
        return res.json({ ok: true, mode: 'paypal', url: ppOrder.approve_url, paypal_order_id: ppOrder.id });
      }

      if (!isPayplugEnabled() || info.portet) {
        return res.status(503).json({ ok: false, error: info.portet ? 'portet_paypal_only' : 'payplug_not_configured' });
      }
      const payment = await createHostedPayment({
        order: fakeOrder,
        product: { name: `Échéance Boxing Center ${info.offer_label}` },
        baseUrl,
        amountCents: info.amount_cents,
        metadata: meta,
        returnUrl: `${returnUrl}&payplug_return=1`,
        cancelUrl: `${returnUrl}&cancelled=1`,
      });
      const url = hostedPaymentUrl(payment);
      if (!url) return res.status(502).json({ ok: false, error: 'payplug_url_missing' });
      return res.json({ ok: true, mode: 'payplug', url, payment_id: payment.id });
    } catch (err) {
      logWarn('Échéancier checkout échoué', { error: err.message });
      const msg = formatPayplugError(err) || formatPaypalError(err) || err.message;
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post('/api/echeancier/confirm', async (req, res) => {
    try {
      const token = readToken(req);
      const info = decodePayload(verifyPayToken(token));
      if (!info?.member_id) {
        return res.status(400).json({ ok: false, error: 'lien_invalide' });
      }
      const meta = metaFromInfo(info);
      const paypalId = String(req.body?.paypal_order_id || req.query?.paypal_order_id || '').trim();
      const payplugId = String(req.body?.payment_id || req.query?.payment_id || '').trim();

      if (paypalId) {
        const captured = await capturePaypalOrder(paypalId, { gym: info.gym }).catch(() => null);
        const order = captured || (await retrievePaypalOrder(paypalId, { gym: info.gym }));
        if (!isPaypalOrderPaid(order)) {
          return res.status(402).json({ ok: false, error: 'payment_pending' });
        }
        const out = await fulfillEcheancierPayment({
          provider: 'paypal',
          paymentId: paypalId,
          meta,
          amountCents: info.amount_cents,
        });
        return res.json({ ok: out.ok, paid: true, ...out });
      }

      if (payplugId) {
        const payment = await retrievePayment(payplugId);
        if (!isPayplugPaymentPaid(payment)) {
          return res.status(402).json({ ok: false, error: 'payment_pending' });
        }
        const out = await fulfillEcheancierPayment({
          provider: 'payplug',
          paymentId: payment.id,
          meta: { ...meta, ...(payment.metadata || {}) },
          amountCents: payment.amount || info.amount_cents,
        });
        return res.json({ ok: out.ok, paid: true, ...out });
      }

      return res.status(400).json({ ok: false, error: 'payment_id manquant' });
    } catch (err) {
      logWarn('Échéancier confirm échoué', { error: err.message });
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = {
  verifyPayToken,
  decodePayload,
  fulfillEcheancierPayment,
  fulfillEcheancierIfPaid,
  registerEcheancierPayRoutes,
  OFFER_LABELS,
};
