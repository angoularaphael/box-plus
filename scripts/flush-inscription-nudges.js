'use strict';

/**
 * Déclenche tout de suite les relances 30 min / reprise 29 € sur la boutique.
 * Usage : node scripts/flush-inscription-nudges.js
 */
require('dotenv').config();

const STORE = String(process.env.STORE_URL || 'https://boutique.boxingcenter.fr').replace(/\/$/, '');
const SECRET = process.env.SYNC_SECRET || process.env.ADMIN_SECRET || '';

async function main() {
  if (!SECRET) throw new Error('SYNC_SECRET manquant');
  const res = await fetch(`${STORE}/api/cron/inscription-nudges`, {
    method: 'GET',
    headers: { 'x-sync-secret': SECRET },
    signal: AbortSignal.timeout(28000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  const results = Array.isArray(data.results) ? data.results : [];
  const sent = results.filter((r) => r.sent || r.whatsapp?.sent).length;
  const wa = results.filter((r) => r.whatsapp?.sent).length;
  console.log(
    JSON.stringify({
      ok: data.ok,
      due: data.count || results.length,
      sent,
      whatsapp: wa,
      sample: results.slice(0, 12).map((r) => ({
        order_id: r.order_id,
        sent: r.sent,
        wa: r.whatsapp?.sent || false,
        email: r.email?.sent || false,
        reason: r.reason || r.whatsapp?.error || r.email?.error || null,
      })),
    })
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
