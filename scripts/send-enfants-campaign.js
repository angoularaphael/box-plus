'use strict';

/**
 * Campagne enfants — mail (Resend) + SMS (gateway).
 *
 *   node scripts/send-enfants-campaign.js --dry
 *   node scripts/send-enfants-campaign.js --test
 *   node scripts/send-enfants-campaign.js --send
 *   node scripts/send-enfants-campaign.js --send --limit=50
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
process.env.RESEND_SENDER_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
process.env.RESEND_SENDER_NAME = 'David de Boxing Center';
process.env.RESEND_REPLY_TO = process.env.RESEND_REPLY_TO || 'boxingcentertls@gmail.com';

const {
  buildEnfantsCampaignEmail,
  enfantsCampaignSmsText,
} = require('../storefront/lib/campaign-email');
const { sendEmailViaResend, isConfigured: resendOk } = require('../storefront/lib/resend-send');

const SMS_API = (process.env.SMS_GATEWAY_URL || 'http://prem-eu2.bot-hosting.net:21724').replace(/\/$/, '');
const SMS_EMAIL = process.env.SMS_GATEWAY_EMAIL || 'angoularaphael05@gmail.com';
const SMS_PASSWORD = process.env.SMS_GATEWAY_PASSWORD || 'Fareno12';

const BD_FILES = [
  path.join(ROOT, '..', 'BD-ENFANTS-1.xls'),
  path.join(ROOT, '..', 'bd-enfants-2.csv'),
];
const STATE_FILE = path.join(ROOT, 'data', 'enfants-campaign-sent.json');

const TEST_EMAIL = 'boxingcentertls@gmail.com';
const TEST_PHONE = '0684698028';

const DRY = !process.argv.includes('--send') && !process.argv.includes('--test');
const TEST = process.argv.includes('--test');
const EMAIL_ONLY = process.argv.includes('--email-only');
const SMS_ONLY = process.argv.includes('--sms-only');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) || 0);
const DELAY_MS = Number(process.argv.find((a) => a.startsWith('--delay='))?.slice(8) || 400);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSemicolonCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ';') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || (ch === '\r' && next === '\n')) {
      if (ch === '\r') i++;
      row.push(field);
      field = '';
      if (row.some((c) => String(c || '').trim())) rows.push(row);
      row = [];
      continue;
    }
    if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => String(c || '').trim())) rows.push(row);
  }
  return rows;
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('33') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 9 && digits.startsWith('6')) digits = `0${digits}`;
  if (!/^0[67]\d{8}$/.test(digits)) return '';
  return digits;
}

function titleCase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function loadAudience() {
  const byId = new Map();
  for (const file of BD_FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`Fichier manquant: ${file}`);
      continue;
    }
    const rows = parseSemicolonCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const header = rows.shift() || [];
    const idx = (name) => header.findIndex((h) => String(h).replace(/"/g, '') === name);
    const iId = idx('Id_client');
    const iPrenom = idx('Prénom');
    const iNom = idx('Nom');
    const iEmail = idx('E-mail');
    const iPhone = idx('Tél.portable');
    const iPhone2 = idx('Tél.perso');
    const iMailing = idx('OK.mailing');
    const iSite = idx('Site');
    for (const row of rows) {
      const id = String(row[iId] || '').replace(/"/g, '').trim();
      if (!id) continue;
      const email = normalizeEmail(row[iEmail]);
      const phone = normalizePhone(row[iPhone]) || normalizePhone(row[iPhone2]);
      const okMailing = String(row[iMailing] || 'O').replace(/"/g, '').trim().toUpperCase();
      byId.set(id, {
        id,
        prenom: titleCase(String(row[iPrenom] || '').replace(/"/g, '')),
        nom: String(row[iNom] || '').replace(/"/g, '').trim(),
        email: okMailing === 'O' ? email : '',
        phone,
        site: String(row[iSite] || '').replace(/"/g, '').trim(),
      });
    }
  }

  const emailSeen = new Set();
  const phoneSeen = new Set();
  const contacts = [];
  for (const row of byId.values()) {
    const emailKey = row.email;
    const phoneKey = row.phone;
    if (emailKey && emailSeen.has(emailKey)) row.email = '';
    if (phoneKey && phoneSeen.has(phoneKey)) row.phone = '';
    if (!row.email && !row.phone) continue;
    if (emailKey) emailSeen.add(emailKey);
    if (phoneKey) phoneSeen.add(phoneKey);
    contacts.push(row);
  }
  return contacts;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { emails: {}, phones: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      emails: raw.emails || {},
      phones: raw.phones || {},
    };
  } catch {
    return { emails: {}, phones: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function sms(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${SMS_API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `SMS HTTP ${res.status}`);
  return data;
}

async function sendSmsOne({ prenom, nom, phone, message }) {
  const login = await sms('/api/auth/login', {
    method: 'POST',
    body: { email: SMS_EMAIL, password: SMS_PASSWORD },
  });
  const campaign = await sms('/api/campaigns', {
    method: 'POST',
    token: login.token,
    body: { name: `Enfants ${prenom || phone}`.slice(0, 80), message },
  });
  await sms(`/api/campaigns/${campaign.id}/contacts`, {
    method: 'POST',
    token: login.token,
    body: { prenom: prenom || 'Parent', nom: nom || '-', telephone: phone },
  });
  const start = await sms(`/api/campaigns/${campaign.id}/start`, { method: 'POST', token: login.token });
  return { campaignId: campaign.id, queued: start.queued || 0 };
}

async function sendEmailOne(contact) {
  const copy = buildEnfantsCampaignEmail({ name: contact.prenom });
  return sendEmailViaResend({
    to: contact.email,
    subject: copy.subject,
    text: copy.emailText,
    headers: copy.headers,
    fromName: copy.fromName,
    replyTo: copy.replyTo || 'boxingcentertls@gmail.com',
  });
}

async function main() {
  const smsMessage = enfantsCampaignSmsText();
  const audience = loadAudience();
  const state = loadState();

  const withEmail = audience.filter((c) => c.email);
  const withPhone = audience.filter((c) => c.phone);
  const pendingEmail = withEmail.filter((c) => !state.emails[c.email]);
  const pendingPhone = withPhone.filter((c) => !state.phones[c.phone]);

  const summary = {
    files: BD_FILES.filter((f) => fs.existsSync(f)).length,
    total_contacts: audience.length,
    with_email: withEmail.length,
    with_phone: withPhone.length,
    pending_email: pendingEmail.length,
    pending_phone: pendingPhone.length,
    already_sent_email: withEmail.length - pendingEmail.length,
    already_sent_phone: withPhone.length - pendingPhone.length,
    mode: TEST ? 'test' : DRY ? 'dry' : 'send',
    sms_chars: smsMessage.length,
  };
  console.log(JSON.stringify({ summary }, null, 2));

  if (DRY) {
    console.log(JSON.stringify({ dry: true, hint: '--test ou --send' }));
    return;
  }

  if (TEST) {
    const results = { email: null, sms: null };
    if (!SMS_ONLY) {
      if (!resendOk()) throw new Error('RESEND_API_KEY manquant');
      const testCopy = buildEnfantsCampaignEmail({ name: 'Test' });
      results.email = await sendEmailViaResend({
        to: TEST_EMAIL,
        subject: testCopy.subject,
        text: testCopy.emailText,
        headers: testCopy.headers,
        fromName: testCopy.fromName,
        replyTo: testCopy.replyTo || 'boxingcentertls@gmail.com',
      });
    }
    if (!EMAIL_ONLY) {
      results.sms = await sendSmsOne({
        prenom: 'Test',
        nom: 'Campagne',
        phone: TEST_PHONE,
        message: smsMessage,
      });
    }
    console.log(JSON.stringify({ ok: true, test: true, results }, null, 2));
    return;
  }

  if (!resendOk() && !SMS_ONLY) throw new Error('RESEND_API_KEY manquant');

  let sentEmail = 0;
  let sentSms = 0;
  let failedEmail = 0;
  let failedSms = 0;

  const emailBatch = SMS_ONLY ? [] : pendingEmail.slice(0, LIMIT || pendingEmail.length);
  const smsBatch = EMAIL_ONLY ? [] : pendingPhone.slice(0, LIMIT || pendingPhone.length);

  for (const contact of emailBatch) {
    try {
      const out = await sendEmailOne(contact);
      state.emails[contact.email] = { at: new Date().toISOString(), messageId: out.messageId, id: contact.id };
      sentEmail++;
      console.log(JSON.stringify({ email: contact.email, ok: true, id: contact.id }));
    } catch (err) {
      failedEmail++;
      console.error(JSON.stringify({ email: contact.email, ok: false, error: err.message }));
    }
    saveState(state);
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  for (const contact of smsBatch) {
    try {
      const out = await sendSmsOne({
        prenom: contact.prenom,
        nom: contact.nom,
        phone: contact.phone,
        message: smsMessage,
      });
      state.phones[contact.phone] = { at: new Date().toISOString(), campaignId: out.campaignId, id: contact.id };
      sentSms++;
      console.log(JSON.stringify({ phone: contact.phone, ok: true, id: contact.id, queued: out.queued }));
    } catch (err) {
      failedSms++;
      console.error(JSON.stringify({ phone: contact.phone, ok: false, error: err.message }));
    }
    saveState(state);
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        sentEmail,
        sentSms,
        failedEmail,
        failedSms,
        stateFile: STATE_FILE,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
