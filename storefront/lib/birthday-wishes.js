'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { logInfo, logWarn } = require('../../lib/logger');
const { sendEmailViaResend, isConfigured: resendConfigured, DEFAULT_SENDER_EMAIL } = require('./resend-send');

const FROM_NAME = 'David';
const FROM_EMAIL = DEFAULT_SENDER_EMAIL;
const REPLY_TO = 'boxingcentertls@gmail.com';
const SIGN_OFF = 'David et toute l’equipe Boxing Center';

function stateFile() {
  const dir = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');
  return path.join(dir, 'birthday-wishes-state.json');
}

function firstNameOf(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0] || '';
  return first
    .split(/([-'])/)
    .map((part, i) => {
      if (i % 2 === 1 || !part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function parseBirthdate(raw) {
  const s = String(raw || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (fr) return { year: Number(fr[3]), month: Number(fr[2]), day: Number(fr[1]) };
  return null;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parisNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    dateKey: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`,
  };
}

function isBirthdayToday(birthdate, now = new Date()) {
  const born = parseBirthdate(birthdate);
  if (!born || !born.month || !born.day) return false;
  const today = parisNow(now);
  if (born.month === 2 && born.day === 29 && !isLeapYear(today.year)) {
    return today.month === 3 && today.day === 1;
  }
  return today.month === born.month && today.day === born.day;
}

function isSkipMember(member = {}) {
  const hay = `${member.first_name || ''} ${member.last_name || ''} ${member.email || ''}`.toLowerCase();
  if (/\btest\b|boxplus-test|@boxplus-test\.local/.test(hay)) return true;
  if (/deciplus lodecom/i.test(hay)) return true;
  return false;
}

function shouldRunAt(now = new Date(), lastDateKey = '') {
  if (String(process.env.BIRTHDAY_RUN_NOW || '') === '1') return true;
  const today = parisNow(now);
  if (lastDateKey === today.dateKey) return false;
  return today.hour <= 11;
}

function buildBirthdayEmail({ first_name, last_name } = {}) {
  const who = firstNameOf(first_name || last_name || '');
  const greeting = who ? `Salut ${who},` : 'Salut,';
  const subject = who ? `${who}, c’est David` : 'C’est David';
  const emailText = [
    greeting,
    '',
    'David et toute l’equipe Boxing Center te souhaitent un joyeux anniversaire.',
    '',
    'Passe une belle journee, on a hate de te revoir sur le ring.',
    '',
    'A tres vite,',
    SIGN_OFF,
  ].join('\n');
  return {
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    replyTo: REPLY_TO,
    subject,
    html: undefined,
    emailText,
    headers: undefined,
  };
}

function buildBirthdaySms({ first_name } = {}) {
  const who = firstNameOf(first_name || '');
  const hello = who ? `Salut ${who},` : 'Salut,';
  return [
    hello,
    'David et toute l’equipe Boxing Center te souhaitent un joyeux anniversaire.',
    'Passe une belle journee.',
    SIGN_OFF,
  ].join(' ');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { last_date: '', sent: {} };
  }
}

function saveState(state) {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function alreadySent(state, memberId, dateKey) {
  const key = String(memberId || '');
  return Boolean(key && state.sent && state.sent[`${dateKey}:${key}`]);
}

function markSent(state, memberId, dateKey, patch = {}) {
  const key = String(memberId || '');
  if (!key) return;
  state.sent = state.sent || {};
  state.sent[`${dateKey}:${key}`] = { at: new Date().toISOString(), ...patch };
}

async function sendBirthdayEmail(member) {
  const to = String(member.email || '').trim();
  if (!to || !to.includes('@')) return { sent: false, skipped: true, reason: 'no_email' };
  if (!resendConfigured()) return { sent: false, skipped: true, reason: 'no_resend' };
  const copy = buildBirthdayEmail(member);
  const out = await sendEmailViaResend({
    to,
    subject: copy.subject,
    text: copy.emailText,
    html: copy.html,
    fromName: copy.fromName,
    fromEmail: copy.fromEmail,
    replyTo: copy.replyTo,
    headers: copy.headers,
  });
  return { sent: true, via: out.via, messageId: out.messageId || null };
}

async function sendBirthdaySms(member) {
  const phone = String(member.phone || '').replace(/\D/g, '');
  if (phone.length < 9) return { sent: false, skipped: true, reason: 'no_phone' };
  const api = String(process.env.SMS_GATEWAY_URL || '').replace(/\/$/, '');
  const email = String(process.env.SMS_GATEWAY_EMAIL || '').trim();
  const password = String(process.env.SMS_GATEWAY_PASSWORD || '').trim();
  if (!api || !email || !password) return { sent: false, skipped: true, reason: 'no_sms_gateway' };
  const message = buildBirthdaySms(member);
  const loginRes = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const login = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !login.token) {
    throw new Error(login.error || login.message || `SMS login HTTP ${loginRes.status}`);
  }
  const campRes = await fetch(`${api}/api/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({
      name: `Anniversaire ${member.first_name || member.member_id || phone}`.slice(0, 80),
      message,
    }),
  });
  const campaign = await campRes.json().catch(() => ({}));
  if (!campRes.ok) throw new Error(campaign.error || `SMS campaign HTTP ${campRes.status}`);
  await fetch(`${api}/api/campaigns/${campaign.id}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({
      prenom: member.first_name || 'Membre',
      nom: member.last_name || '-',
      telephone: member.phone,
    }),
  });
  const startRes = await fetch(`${api}/api/campaigns/${campaign.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const start = await startRes.json().catch(() => ({}));
  if (!startRes.ok) throw new Error(start.error || `SMS start HTTP ${startRes.status}`);
  return { sent: true, via: 'sms_gateway', campaignId: campaign.id, queued: start.queued || 0 };
}

async function sendBirthdayWish(member, { email = true, sms = true } = {}) {
  const result = { member_id: member.member_id || null, name: `${member.first_name || ''} ${member.last_name || ''}`.trim() };
  if (email) {
    try {
      result.email = await sendBirthdayEmail(member);
    } catch (err) {
      result.email = { sent: false, error: err.message };
      logWarn('Anniversaire mail', { member_id: member.member_id, error: err.message });
    }
  }
  if (sms) {
    try {
      result.sms = await sendBirthdaySms(member);
    } catch (err) {
      result.sms = { sent: false, error: err.message };
      logWarn('Anniversaire SMS', { member_id: member.member_id, error: err.message });
    }
  }
  return result;
}

module.exports = {
  FROM_NAME,
  FROM_EMAIL,
  SIGN_OFF,
  firstNameOf,
  parseBirthdate,
  isBirthdayToday,
  isSkipMember,
  shouldRunAt,
  parisNow,
  buildBirthdayEmail,
  buildBirthdaySms,
  loadState,
  saveState,
  alreadySent,
  markSent,
  sendBirthdayEmail,
  sendBirthdaySms,
  sendBirthdayWish,
};
