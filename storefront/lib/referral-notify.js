'use strict';

const { getStoreUrl } = require('../../lib/app-urls');
const { sendEmailViaBrevo, isConfigured } = require('./brevo-send');
const { sendWhatsAppMessage } = require('./whatsapp-bot');
const { isPromoWhatsAppPaused, isOfferPlacesSmsPaused } = require('./whatsapp-outbound');
const { logInfo, logWarn } = require('../../lib/logger');

function clean(v, max = 80) {
  return String(v || '')
    .trim()
    .slice(0, max);
}

function sanitizeFriend(input = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const prenom = clean(src.prenom || src.first_name);
  const nom = clean(src.nom || src.last_name);
  const telephone = clean(src.telephone || src.phone, 20);
  const email = clean(src.email, 120).toLowerCase();
  if (!prenom || !telephone) return null;
  return {
    prenom,
    nom: nom || '',
    telephone,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
  };
}

function isOffre29Order(order = {}) {
  const id = String(order.product_id || order.product_snapshot?.id || '').toLowerCase();
  if (id === 'offre-duo' || id === 'offre_29' || id === 'dp-104') return true;
  return /offre\s*a\s*29|29,99/i.test(String(order.product_snapshot?.name || ''));
}

function offre29Url() {
  return `${getStoreUrl()}/offre/29`;
}

function buildReferralCopy({ friendPrenom, referrerFirst, referrerLast }) {
  const ami = friendPrenom || 'toi';
  const who = [referrerFirst, referrerLast].filter(Boolean).join(' ').trim() || 'un ami';
  const link = offre29Url();
  const pressure = 'Il reste quelques places — dépêche-toi pour en profiter.';
  const text =
    `Félicitations ${ami} !\n\n` +
    `Grâce à ${who}, tu bénéficies de l’Offre Duo à *29 €* au lieu de ~44 €~ chez Boxing Center.\n\n` +
    `${pressure}\n\n` +
    `Découvre l’offre ici :\n${link}`;
  return { ami, who, link, pressure, text };
}

function referralEmailHtml({ ami, who, link, pressure }) {
  return `<!DOCTYPE html>
<html lang="fr">
<body style="font-family:Arial,sans-serif;color:#0C1829;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#E8001C;font-size:22px">Félicitations ${escapeHtml(ami)} !</h1>
  <p>Grâce à <strong>${escapeHtml(who)}</strong>, tu bénéficies de l’Offre Duo à <strong>29&nbsp;€</strong> au lieu de <s><strong>44&nbsp;€</strong></s>, chez Boxing Center.</p>
  <p style="color:#E8001C;font-weight:700">${escapeHtml(pressure)}</p>
  <p>Cours illimités, accès aux 5 salles, sans engagement.</p>
  <p style="margin:28px 0">
    <a href="${escapeHtml(link)}" style="background:#E8001C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Voir l’offre à 29&nbsp;€</a>
  </p>
  <p style="color:#5C6370;font-size:13px">Boxing Center — Toulouse</p>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function notifyReferralFriend({ order, friend, referrer, skipEmail = false }) {
  const copy = buildReferralCopy({
    friendPrenom: friend.prenom,
    referrerFirst: referrer.first_name,
    referrerLast: referrer.last_name,
  });
  const out = { email: { sent: false }, whatsapp: { sent: false } };

  if (!skipEmail && friend.email && isConfigured()) {
    try {
      const result = await sendEmailViaBrevo({
        to: friend.email,
        subject: `Félicitations ${copy.ami} — Offre Duo 29 € chez Boxing Center`,
        html: referralEmailHtml(copy),
        text: copy.text,
      });
      out.email = result?.sent ? { sent: true } : { sent: false, reason: result?.reason || 'not_sent' };
    } catch (err) {
      out.email = { sent: false, error: err.message };
      logWarn('Email parrainage ami', { error: err.message, order_id: order.order_id });
    }
  } else if (skipEmail) {
    out.email = { sent: true, skipped: true };
  }

  if (isOfferPlacesSmsPaused()) {
    out.whatsapp = { sent: false, skipped: true, reason: 'offer_places_sms_paused' };
  } else if (isPromoWhatsAppPaused()) {
    out.whatsapp = { sent: false, skipped: true, reason: 'promo_paused' };
  } else {
    try {
      await sendWhatsAppMessage(friend.telephone, copy.text, { kind: 'promo' });
      out.whatsapp = { sent: true };
    } catch (err) {
      out.whatsapp = { sent: false, error: err.message };
      logWarn('WhatsApp parrainage ami', { error: err.message, order_id: order.order_id });
    }
  }

  logInfo('Notif parrainage offre 29', {
    order_id: order.order_id,
    email: out.email.sent,
    whatsapp: out.whatsapp.sent,
  });
  return out;
}

module.exports = {
  sanitizeFriend,
  isOffre29Order,
  offre29Url,
  buildReferralCopy,
  notifyReferralFriend,
};
