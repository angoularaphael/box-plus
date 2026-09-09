#!/usr/bin/env node
'use strict';

/**
 * Vérifie que le routage parallèle Raphaël / Eddy est configuré.
 * Usage : node scripts/verify-sales-bot-env.js
 * Exit 0 = OK, 1 = manque BOXPLUS_BOT_URL_SALES_2 (100 % des ventes sur Raphaël).
 */
require('dotenv').config();

const raphael = String(process.env.BOXPLUS_BOT_URL || '').replace(/\/$/, '');
const eddy = String(process.env.BOXPLUS_BOT_URL_SALES_2 || '').replace(/\/$/, '');
const ops = String(process.env.BOXPLUS_BOT_URL_OPS || '').replace(/\/$/, '');

async function pingHealth(label, base) {
  if (!base) return { label, ok: false, error: 'URL manquante' };
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(12000) });
    const body = await res.json();
    return {
      label,
      ok: res.ok && body.ok,
      bot_id: body.bot_id || null,
      pending: body.stats?.pending_jobs ?? null,
      ready: body.ready,
    };
  } catch (err) {
    return { label, ok: false, error: err.message };
  }
}

(async () => {
  console.log('=== Routage bots inscriptions ===');
  console.log('BOXPLUS_BOT_URL (Raphaël):', raphael || '(vide)');
  console.log('BOXPLUS_BOT_URL_SALES_2 (Eddy):', eddy || '(vide — parallélisme désactivé)');
  console.log('BOXPLUS_BOT_URL_OPS:', ops || '(vide)');

  if (!raphael) {
    console.error('\nERREUR: BOXPLUS_BOT_URL manquant.');
    process.exit(1);
  }
  if (!eddy) {
    console.warn(
      '\nATTENTION: BOXPLUS_BOT_URL_SALES_2 manquant — toutes les ventes vont sur Raphaël.'
    );
    console.warn('Ajouter sur Vercel Production: BOXPLUS_BOT_URL_SALES_2=http://prem-eu2.bot-hosting.net:21871');
    process.exit(1);
  }

  const checks = await Promise.all([
    pingHealth('Raphaël', raphael),
    pingHealth('Eddy', eddy),
  ]);
  console.log('\n=== Health bots ===');
  for (const c of checks) {
    console.log(c.ok ? 'OK' : 'KO', c.label, c.bot_id ? `(${c.bot_id})` : '', c.pending != null ? `pending=${c.pending}` : '', c.error || '');
  }

  const allOk = checks.every((c) => c.ok);
  if (!allOk) process.exit(2);
  console.log('\nParallélisme actif: ~50 % Raphaël / ~50 % Eddy.');
})();
