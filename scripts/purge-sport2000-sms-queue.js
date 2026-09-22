'use strict';

/**
 * Vide la file Redis Sport2000 / seance offerte (ancien texte encore en attente).
 *   node scripts/purge-sport2000-sms-queue.js
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
}

const API = (process.env.SMS_GATEWAY_URL || 'http://prem-eu2.bot-hosting.net:21724').replace(/\/$/, '');
const EMAIL = process.env.SMS_GATEWAY_EMAIL || 'angoularaphael05@gmail.com';
const PASS = process.env.SMS_GATEWAY_PASSWORD || 'Fareno12';

(async () => {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const body = await login.json();
  if (!login.ok) throw new Error(body.error || `login ${login.status}`);
  const res = await fetch(`${API}/api/ops/purge-sport2000`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `purge ${res.status}`);
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
