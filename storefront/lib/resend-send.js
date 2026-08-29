'use strict';

/**
 * Resend — campagnes clients (no-reply@boxingcenter.fr).
 * Pas Brevo / suzinabot : ce domaine est banni.
 * https://resend.com
 */
const API = 'https://api.resend.com/emails';
const DEFAULT_SENDER_EMAIL = 'no-reply@boxingcenter.fr';
const DEFAULT_SENDER_NAME = 'Guillaume';
const DEFAULT_REPLY_TO = 'boxingcenter31@gmail.com';

function readApiKey() {
  return String(process.env.RESEND_API_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

function senderEmail() {
  return process.env.RESEND_SENDER_EMAIL || DEFAULT_SENDER_EMAIL;
}

function senderName() {
  return process.env.RESEND_SENDER_NAME || DEFAULT_SENDER_NAME;
}

function defaultReplyTo() {
  return process.env.RESEND_REPLY_TO || process.env.MAIL_REPLY_TO || DEFAULT_REPLY_TO;
}

function isConfigured() {
  return Boolean(readApiKey());
}

async function sendEmailViaResend({ to, subject, html, text, replyTo, headers, attachments, tags }) {
  if (!to) throw new Error('Destinataire email manquant');
  if (!isConfigured()) throw new Error('RESEND_API_KEY manquant');

  const body = {
    from: `${senderName()} <${senderEmail()}>`,
    to: [to],
    subject: subject || 'Message Boxing Center',
    text: text || undefined,
    html: html || undefined,
    reply_to: replyTo || defaultReplyTo(),
  };
  if (headers && typeof headers === 'object') body.headers = headers;
  if (Array.isArray(attachments) && attachments.length) body.attachments = attachments;
  if (Array.isArray(tags) && tags.length) body.tags = tags;

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.name || `Resend HTTP ${res.status}`);
  }
  return {
    sent: true,
    messageId: data.id,
    via: 'resend',
    sender: senderEmail(),
  };
}

module.exports = {
  DEFAULT_SENDER_EMAIL,
  DEFAULT_SENDER_NAME,
  senderEmail,
  senderName,
  defaultReplyTo,
  isConfigured,
  sendEmailViaResend,
};
