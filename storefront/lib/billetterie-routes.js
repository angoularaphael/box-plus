'use strict';

/**
 * Routes billetterie FIGHT & Furious.
 *   GET  /billetterie (?produit=vendredi|samedi|dimanche|weekend) et /billetterie/:produit
 *   GET  /billet?id=...&t=...                     billet + QR code apres paiement
 *   GET  /api/billetterie/produits
 *   POST /api/billetterie/commande                 { produit, prenom, nom, email, quantite, methode }
 *   POST /api/billetterie/confirmer                { id, t }
 *   GET  /api/billetterie/commande/:id?t=
 *   GET  /api/billetterie/qr/:id/:numero.png?t=
 * Paiement : PayPal Boxing Center (compte minimes) ou PayPlug. Aucun autre moyen.
 */

const path = require('path');
const bil = require('./billetterie');
const { getCheckoutBaseUrl } = require('../../lib/app-urls');
const { logInfo, logError } = require('../../lib/logger');

const PAYPAL_ACCOUNT = 'minimes';

function paypalLib() {
  return require('./paypal');
}

function payplugLib() {
  return require('./payplug');
}

function montantPaypal(order) {
  for (const unit of order?.purchase_units || []) {
    for (const cap of unit.payments?.captures || []) {
      if (String(cap.status || '').toUpperCase() === 'COMPLETED') {
        return Math.round(Number(cap.amount?.value || 0) * 100);
      }
    }
  }
  const unit = order?.purchase_units?.[0];
  return Math.round(Number(unit?.amount?.value || 0) * 100);
}

async function verifierPaypal(commande) {
  const { capturePaypalOrder, retrievePaypalOrder, isPaypalOrderPaid } = paypalLib();
  const id = commande.payment?.paypal_order_id;
  if (!id) return { paid: false, error: 'paypal_id_manquant' };
  let order = null;
  try {
    order = await capturePaypalOrder(id, { account: PAYPAL_ACCOUNT });
  } catch (err) {
    const msg = String(err?.message || '') + JSON.stringify(err?.body || {});
    if (/ORDER_NOT_APPROVED|PAYER_ACTION_REQUIRED/i.test(msg)) {
      return { paid: false, pending: true };
    }
    // Deja capture (retour + webhook) : on relit la commande.
    order = await retrievePaypalOrder(id, { account: PAYPAL_ACCOUNT });
  }
  if (!isPaypalOrderPaid(order)) return { paid: false, pending: true };
  if (montantPaypal(order) !== commande.total_cents) return { paid: false, error: 'amount_mismatch' };
  return { paid: true };
}

async function verifierPayplug(commande) {
  const { retrievePaymentLiveOrTest, isPayplugPaymentPaid, isPayplugPaymentPending } = payplugLib();
  const id = commande.payment?.payplug_payment_id;
  if (!id) return { paid: false, error: 'payplug_id_manquant' };
  const { payment } = await retrievePaymentLiveOrTest(id);
  if (isPayplugPaymentPaid(payment)) {
    if (Number(payment.amount) !== commande.total_cents) return { paid: false, error: 'amount_mismatch' };
    return { paid: true };
  }
  if (isPayplugPaymentPending(payment)) return { paid: false, pending: true };
  return { paid: false, error: 'payment_failed' };
}

/** Verifie le paiement aupres du prestataire, marque la commande payee et envoie le billet (une seule fois). */
async function confirmerCommande(commande, baseUrl, { verifier } = {}) {
  if (!commande) return { ok: false, error: 'not_found' };
  if (commande.status !== 'paid') {
    const check = verifier
      ? await verifier(commande)
      : commande.payment?.method === 'paypal'
        ? await verifierPaypal(commande)
        : await verifierPayplug(commande);
    if (!check.paid) return { ok: false, ...check };
    commande.status = 'paid';
    commande.paid_at = new Date().toISOString();
    commande.payment = { ...(commande.payment || {}), status: 'paid' };
    await bil.enregistrerCommande(commande);
    logInfo('Billetterie : paiement confirme', {
      order_id: commande.order_id,
      produit: commande.produit,
      quantite: commande.quantite,
    });
  }
  if (!commande.emailed_at) {
    // Relecture pour limiter le double envoi (retour navigateur + webhook simultanes).
    const fresh = (await bil.chargerCommande(commande.order_id).catch(() => null)) || commande;
    if (!fresh.emailed_at) {
      try {
        await bil.envoyerMails(fresh, baseUrl);
        fresh.emailed_at = new Date().toISOString();
        await bil.enregistrerCommande(fresh);
        commande.emailed_at = fresh.emailed_at;
      } catch (err) {
        logError('Billetterie : envoi mail', { order_id: commande.order_id, error: err.message });
      }
    }
  }
  return { ok: true, paid: true, commande };
}

function tokenDe(req) {
  return String(req.query?.t || req.body?.t || '').trim();
}

async function chargerAvecAcces(req, id) {
  const commande = await bil.chargerCommande(id);
  if (!commande || !bil.verifierAcces(commande, tokenDe(req))) return null;
  return commande;
}

function registerBilletterieRoutes(app, { publicDir } = {}) {
  if (publicDir) {
    app.get(['/billetterie', '/billetterie/'], (_req, res) => {
      res.type('text/html; charset=utf-8');
      res.sendFile(path.join(publicDir, 'billetterie.html'));
    });
    app.get('/billetterie/:produit', (req, res, next) => {
      const produit = bil.trouverProduit(req.params.produit);
      if (!produit) return next();
      return res.redirect(302, `/billetterie?produit=${produit.id}`);
    });
    app.get(['/billet', '/billet/'], (_req, res) => {
      res.type('text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(path.join(publicDir, 'billet.html'));
    });
  }

  app.get('/api/billetterie/produits', (_req, res) => {
    const { isPaypalEnabled } = paypalLib();
    const { isPayplugEnabled } = payplugLib();
    res.json({
      ok: true,
      evenement: bil.EVENEMENT,
      produits: bil.listeProduits(),
      quantite_max: bil.QUANTITE_MAX,
      methodes: {
        paypal: isPaypalEnabled(PAYPAL_ACCOUNT),
        payplug: isPayplugEnabled(),
      },
    });
  });

  app.post('/api/billetterie/commande', async (req, res) => {
    try {
      const { errors, data } = bil.validerCommande(req.body || {});
      if (errors.length) {
        return res.status(400).json({ ok: false, error: errors[0].message, errors });
      }
      const baseUrl = getCheckoutBaseUrl(req);
      const commande = bil.creerCommande(data);
      const retour = `${bil.billetUrl(baseUrl, commande)}&retour=${data.methode}`;
      const annulation = `${baseUrl}/billetterie?produit=${data.produit.id}&annule=1`;
      const description = `Billet ${bil.EVENEMENT.nom} - ${data.produit.nom} x${data.quantite}`;

      if (data.methode === 'paypal') {
        const { isPaypalEnabled, createPaypalOrder, formatPaypalError } = paypalLib();
        if (!isPaypalEnabled(PAYPAL_ACCOUNT)) {
          return res.status(503).json({ ok: false, error: 'PayPal est indisponible pour le moment. Payez par carte bancaire.' });
        }
        let pp;
        try {
          pp = await createPaypalOrder({
            amountCents: commande.total_cents,
            baseUrl,
            description,
            metadata: { order_id: commande.order_id, email: data.email },
            returnUrl: retour,
            cancelUrl: annulation,
            gym: PAYPAL_ACCOUNT,
            payerEmail: data.email,
          });
        } catch (err) {
          logError('Billetterie : creation PayPal', { error: err.message });
          return res.status(502).json({ ok: false, error: formatPaypalError(err) });
        }
        if (!pp.approve_url) return res.status(502).json({ ok: false, error: 'Lien PayPal manquant.' });
        commande.payment = { method: 'paypal', status: 'pending', paypal_order_id: pp.id, paypal_account: PAYPAL_ACCOUNT };
        await bil.enregistrerCommande(commande);
        return res.json({ ok: true, url: pp.approve_url, order_id: commande.order_id });
      }

      const { isPayplugEnabled, createHostedPayment, hostedPaymentUrl, formatPayplugError } = payplugLib();
      if (!isPayplugEnabled()) {
        return res.status(503).json({ ok: false, error: 'Le paiement par carte est indisponible pour le moment. Essayez PayPal.' });
      }
      let payment;
      try {
        payment = await createHostedPayment({
          amountCents: commande.total_cents,
          baseUrl,
          description,
          metadata: { order_type: 'billet', order_id: commande.order_id, payment_plan: 'once' },
          customerOverrides: { first_name: data.prenom, last_name: data.nom, email: data.email },
          returnUrl: retour,
          cancelUrl: annulation,
        });
      } catch (err) {
        logError('Billetterie : creation PayPlug', { error: err.message, body: err.body || null });
        return res.status(502).json({ ok: false, error: formatPayplugError(err) || err.message });
      }
      const url = hostedPaymentUrl(payment);
      if (!url) return res.status(502).json({ ok: false, error: 'Lien de paiement manquant.' });
      commande.payment = { method: 'payplug', status: 'pending', payplug_payment_id: payment.id };
      await bil.enregistrerCommande(commande);
      return res.json({ ok: true, url, order_id: commande.order_id });
    } catch (err) {
      logError('Billetterie : commande', { error: err.message });
      return res.status(500).json({ ok: false, error: 'Erreur serveur, reessayez dans un instant.' });
    }
  });

  app.post('/api/billetterie/confirmer', async (req, res) => {
    try {
      const id = String(req.body?.id || '');
      const commande = await chargerAvecAcces(req, id);
      if (!commande) return res.status(403).json({ ok: false, error: 'forbidden' });
      const out = await confirmerCommande(commande, getCheckoutBaseUrl(req));
      if (!out.ok) {
        const status = out.pending ? 202 : 402;
        return res.status(status).json({ ok: false, pending: Boolean(out.pending), error: out.error || 'payment_pending', commande: bil.vuePublique(commande) });
      }
      return res.json({ ok: true, commande: bil.vuePublique(out.commande) });
    } catch (err) {
      logError('Billetterie : confirmation', { error: err.message });
      return res.status(500).json({ ok: false, error: 'Erreur serveur, reessayez dans un instant.' });
    }
  });

  app.get('/api/billetterie/commande/:id', async (req, res) => {
    try {
      const commande = await chargerAvecAcces(req, req.params.id);
      if (!commande) return res.status(403).json({ ok: false, error: 'forbidden' });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, commande: bil.vuePublique(commande) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/billetterie/qr/:id/:numero.png', async (req, res) => {
    try {
      const commande = await chargerAvecAcces(req, req.params.id);
      if (!commande || commande.status !== 'paid') return res.status(404).end();
      const billet = commande.billets.find((b) => String(b.numero) === String(req.params.numero));
      if (!billet) return res.status(404).end();
      const png = await bil.qrPng(bil.contenuQr(getCheckoutBaseUrl(req), commande, billet));
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.end(png);
    } catch (err) {
      return res.status(500).end();
    }
  });
}

/** Branche du webhook PayPlug (metadata.order_type === 'billet'). */
async function traiterWebhookPayplug(payment, baseUrl) {
  const orderId = payment?.metadata?.order_id;
  const commande = await bil.chargerCommande(orderId);
  if (!commande) return { ok: true, ignored: true };
  if (commande.payment?.payplug_payment_id !== payment.id) return { ok: true, ignored: true, error: 'payment_mismatch' };
  const out = await confirmerCommande(commande, baseUrl);
  return { ok: true, paid: Boolean(out.paid), pending: Boolean(out.pending) };
}

module.exports = {
  registerBilletterieRoutes,
  confirmerCommande,
  traiterWebhookPayplug,
  montantPaypal,
};
