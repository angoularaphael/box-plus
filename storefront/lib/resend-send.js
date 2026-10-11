'use strict';

/**
 * Compat: ancien module Resend — tout passe par Brevo.
 * Les scripts qui importent encore sendEmailViaResend restent valides.
 */
const fs = require('fs');
const brevo = require('./brevo-send');

function toResendAttachments(attachments = []) {
  const out = [];
  for (const att of attachments || []) {
    if (!att) continue;
    const filename = att.filename || att.name || 'piece-jointe.pdf';
    if (typeof att.content === 'string' && !att.path && !att.filepath && att.content.length >= 500) {
      out.push({ filename, content: att.content });
      continue;
    }
    let buf = null;
    if (Buffer.isBuffer(att.content)) buf = att.content;
    else {
      const filepath = att.filepath || att.path;
      if (filepath && fs.existsSync(filepath)) {
        try {
          buf = fs.readFileSync(filepath);
        } catch {
          buf = null;
        }
      }
    }
    if (buf && buf.length >= 500) out.push({ filename, content: buf.toString('base64') });
  }
  return out;
}

function senderEmail() {
  return brevo.senderEmail();
}

function senderName() {
  return (
    process.env.RESEND_SENDER_NAME ||
    process.env.BREVO_SENDER_NAME ||
    brevo.senderName()
  );
}

function defaultReplyTo() {
  const fromEnv =
    process.env.RESEND_REPLY_TO ||
    process.env.BREVO_REPLY_TO ||
    process.env.MAIL_REPLY_TO ||
    '';
  if (fromEnv) return fromEnv;
  return brevo.defaultReplyTo();
}

function isConfigured() {
  return brevo.isConfigured();
}

async function sendEmailViaResend(opts = {}) {
  const result = await brevo.sendEmailViaBrevo({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo || defaultReplyTo(),
    attachments: opts.attachments,
    cc: opts.cc,
    fromName: opts.fromName || senderName(),
    fromEmail: opts.fromEmail || senderEmail(),
    headers: opts.headers,
  });
  if (!result) throw new Error('BREVO_API_KEY manquant (ou SMTP Brevo non configure)');
  return { ...result, via: result.via || 'brevo' };
}

module.exports = {
  DEFAULT_SENDER_EMAIL: brevo.DEFAULT_SENDER_EMAIL,
  DEFAULT_SENDER_NAME: brevo.DEFAULT_SENDER_NAME,
  senderEmail,
  senderName,
  defaultReplyTo,
  isConfigured,
  sendEmailViaResend,
  toResendAttachments,
};
