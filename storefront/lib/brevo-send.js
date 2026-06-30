/**
 * Envoi Brevo — API REST en priorité (pas de blocage IP Vercel).
 */
const fs = require('fs');
const nodemailer = require('nodemailer');

const DEFAULT_SENDER_EMAIL = 'suzinabot@gmail.com';
const DEFAULT_SENDER_NAME = 'Boxing Center';

function readApiKey() {
  return (process.env.BREVO_API_KEY || '').trim().replace(/^["']|["']$/g, '');
}

function apiKeyConfigured() {
  return readApiKey().startsWith('xkeysib-');
}

function smtpConfigured() {
  const user = process.env.SMTP_USER || process.env.BREVO_SMTP_LOGIN;
  const pass = process.env.SMTP_PASS || process.env.BREVO_SMTP_KEY;
  return Boolean(user && pass);
}

function senderEmail() {
  return process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER_EMAIL;
}

function senderName() {
  return process.env.BREVO_SENDER_NAME || 'Boxing Center';
}

function defaultReplyTo() {
  return (
    process.env.BREVO_REPLY_TO ||
    process.env.MAIL_REPLY_TO ||
    'boxingcenter31@gmail.com'
  );
}

function onVercel() {
  return Boolean(process.env.VERCEL);
}

function normalizeAttachments(attachments = []) {
  const out = [];
  for (const att of attachments) {
    if (att.content != null) {
      const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(String(att.content));
      out.push({ name: att.filename || att.name || 'piece-jointe', content: buf });
      continue;
    }
    if (att.path && fs.existsSync(att.path)) {
      out.push({
        name: att.filename || att.name || require('path').basename(att.path),
        content: fs.readFileSync(att.path),
      });
    }
  }
  return out;
}

let smtpTransport = null;

function getSmtpTransport() {
  if (!smtpTransport) {
    const host = process.env.SMTP_HOST || process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
    const user = process.env.SMTP_USER || process.env.BREVO_SMTP_LOGIN;
    const pass = process.env.SMTP_PASS || process.env.BREVO_SMTP_KEY;
    const port = Number(process.env.SMTP_PORT || process.env.BREVO_SMTP_PORT || 587);
    smtpTransport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465 || process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
  }
  return smtpTransport;
}

async function sendViaRestApi({ to, subject, html, text, replyTo, attachments }) {
  const apiKey = readApiKey();
  const files = normalizeAttachments(attachments);
  const body = {
    sender: { name: senderName(), email: senderEmail() },
    to: [{ email: to }],
    replyTo: { email: replyTo || defaultReplyTo(), name: senderName() },
    subject: subject || 'Message Boxing Center',
    htmlContent: html || undefined,
    textContent: text || undefined,
  };
  if (files.length) {
    body.attachment = files.map((f) => ({
      name: f.name,
      content: f.content.toString('base64'),
    }));
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw.slice(0, 200) };
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `Brevo API HTTP ${res.status}`);
  }
  return { sent: true, messageId: data.messageId, via: 'brevo-api', sender: senderEmail() };
}

async function sendViaSmtp({ to, subject, html, text, replyTo, attachments }) {
  const info = await getSmtpTransport().sendMail({
    from: `"${senderName()}" <${senderEmail()}>`,
    to,
    replyTo: replyTo || defaultReplyTo(),
    subject: subject || 'Message Boxing Center',
    text: text || '',
    html: html || undefined,
    attachments: attachments || [],
  });
  return { sent: true, messageId: info.messageId, via: 'brevo-smtp' };
}

async function sendEmailViaBrevo({ to, subject, html, text, replyTo, attachments }) {
  if (!to) throw new Error('Destinataire email manquant');
  if (!apiKeyConfigured() && !smtpConfigured()) return null;

  if (apiKeyConfigured()) {
    return sendViaRestApi({ to, subject, html, text, replyTo, attachments });
  }

  if (onVercel()) {
    return null;
  }

  return sendViaSmtp({ to, subject, html, text, replyTo, attachments });
}

function isConfigured() {
  return apiKeyConfigured() || smtpConfigured();
}

module.exports = {
  DEFAULT_SENDER_EMAIL,
  DEFAULT_SENDER_NAME,
  senderEmail,
  senderName,
  defaultReplyTo,
  apiKeyConfigured,
  isConfigured,
  sendEmailViaBrevo,
};
