'use strict';

const { getStoreUrl } = require('../../lib/app-urls');
const { sendEmailViaBrevo, isConfigured } = require('./brevo-send');
const { sendWhatsAppMessage } = require('./whatsapp-bot');
const { logInfo, logWarn } = require('../../lib/logger');

function clean(v, max = 80) {
  return String(v || '')
    .trim()
    .slice(0, max);
}

function sanitizeFriend(input = {}) {
  const prenom = clean(input.prenom || input.first_name);
  const nom = clean(input.nom || input.last_name);
  const telephone = clean(input.telephone || input.phone, 20);
  const email = clean(input.email, 120).toLowerCase();
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
  const text =
    `Félicitations ${ami} !\n\n` +
    `Grâce à ${who}, tu bénéficies de l’Offre Duo à 29 € au lieu de ~40 € chez Boxing Center.\n\n` +
    `Découvre l’offre ici :\n${link}`;
  return { ami, who, link, text };
}

function referralEmailHtml({ ami, who, link }) {
  return `<!DOCTYPE html>
<html lang="fr">
<body style="font-family:Arial,sans-serif;color:#0C1829;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#E8001C;font-size:22px">Félicitations ${escapeHtml(ami)} !</h1>
  <p>Grâce à <strong>${escapeHtml(who)}</strong>, tu bénéficies de l’<strong>Offre Duo à 29&nbsp;€</strong> au lieu de ~40&nbsp;€, chez Boxing Center.</p>
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

async function notifyReferralFriend({ order, friend, referrer }) {
  const copy = buildReferralCopy({
    friendPrenom: friend.prenom,
    referrerFirst: referrer.first_name,
    referrerLast: referrer.last_name,
  });
  const out = { email: { sent: false }, whatsapp: { sent: false } };

  if (friend.email && isConfigured()) {
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
  }

  try {
    await sendWhatsAppMessage(friend.telephone, copy.text);
    out.whatsapp = { sent: true };
  } catch (err) {
    out.whatsapp = { sent: false, error: err.message };
    logWarn('WhatsApp parrainage ami', { error: err.message, order_id: order.order_id });
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
