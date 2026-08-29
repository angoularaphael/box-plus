'use strict';

/**
 * Envoi WhatsApp programmé 17h00 Paris — 5 personnes, 3 min d’écart.
 *   node scripts/send-offer-wa-17h.js
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
process.env.STORE_URL = 'https://boutique.boxingcenter.fr';

const { customerNudgeCopy } = require('../storefront/lib/essai-followup');
const {
  sendWhatsAppMessage,
  toWhatsAppPhone,
  getWhatsAppStatus,
} = require('../storefront/lib/whatsapp-bot');

const START_AT = Date.parse('2026-08-29T17:00:00+02:00');
const GAP_MS = 3 * 60 * 1000;

const TARGETS = [
  { first_name: 'Benjamin', phone: '0603996176' },
  { first_name: 'Pauline', phone: '0658411318' },
  { first_name: 'Brigitte', phone: '0616638551' },
  { first_name: 'Maxime', phone: '0782307715' },
  { first_name: 'Guillaume', phone: '0684698028' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stamp() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

async function main() {
  const status = await getWhatsAppStatus();
  if (!status.connected) {
    throw new Error(`Bot boutique non connecté: ${status.error || 'offline'}`);
  }
  console.log(`[${stamp()}] bot connecté · ${status.me?.name || ''} ${status.me?.id || ''}`);

  const wait = START_AT - Date.now();
  if (wait > 0) {
    console.log(`[${stamp()}] attente 17h00 Paris (${Math.round(wait / 1000)} s)`);
    await sleep(wait);
  } else {
    console.log(`[${stamp()}] 17h00 déjà passé — envoi immédiat`);
  }

  const results = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const person = TARGETS[i];
    const to = toWhatsAppPhone(person.phone);
    const copy = customerNudgeCopy({ customer_short: person }, 1);
    if (!to) {
      console.error(`[${stamp()}] ERROR ${person.first_name} numéro invalide`);
      results.push({ name: person.first_name, ok: false, error: 'invalid_phone' });
    } else {
      try {
        const wa = await sendWhatsAppMessage(to, copy.text);
        const ok = Boolean(wa.ok || wa.success);
        console.log(
          `[${stamp()}] envoyé ${person.first_name} ${to} · ${ok ? 'ok' : 'fail'} · ack=${wa.ackName || wa.ack || '?'}`
        );
        results.push({ name: person.first_name, phone: to, ok, ack: wa.ackName || null, id: wa.id || null });
      } catch (err) {
        console.error(`[${stamp()}] ERROR ${person.first_name}: ${err.message}`);
        results.push({ name: person.first_name, phone: to, ok: false, error: err.message });
      }
    }
    if (i < TARGETS.length - 1) {
      console.log(`[${stamp()}] pause 3 min avant le suivant`);
      await sleep(GAP_MS);
    }
  }

  console.log(`[${stamp()}] terminé`);
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((err) => {
  console.error(`[${stamp()}] ERROR`, err.message || err);
  process.exit(1);
});
