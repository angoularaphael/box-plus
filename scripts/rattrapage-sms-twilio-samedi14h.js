#!/usr/bin/env node
'use strict';
/**
 * Rattrapage SMS Twilio — portet_clients depuis samedi 5 sept. 14h Paris.
 *   node scripts/rattrapage-sms-twilio-samedi14h.js
 *   node scripts/rattrapage-sms-twilio-samedi14h.js --dry-run
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const fs = require('fs');
const path = require('path');
const { sendTransactionalSms, isConfigured } = require('../storefront/lib/twilio-sms');
const { buildReferralCopy } = require('../storefront/lib/referral-notify');
const { getSupabase } = require('../storefront/lib/supabase');

const CUTOFF = new Date('2026-09-05T14:00:00+02:00').toISOString();
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = Number(process.env.SMS_CATCHUP_DELAY_MS || 400);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

function phoneKeys(v) {
  const d = digits(v);
  if (!d) return [];
  const s = new Set([d]);
  if (d.length >= 9) s.add(d.slice(-9));
  if (d.length === 10 && d.startsWith('0')) s.add(d.slice(1));
  if (d.length === 9) s.add(`0${d}`);
  return [...s];
}

function confirmationMessage(prenom) {
  return `Bonjour ${prenom},

Votre inscription au grand jeu concours des 10 ans Boxing Center est bien confirmee.

Vous participez au tirage au sort pour tenter de gagner un abonnement 12 mois d'une valeur de 400 euros.

Un gagnant sera tire au sort chaque soir pendant 10 jours a partir du 01/09/2026.

Bonne chance.

L'equipe BOXING CENTER`;
}

async function loadPortetTargets() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rows = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${url}/rest/v1/portet_clients?select=id,prenom,nom,telephone,email,source,offre,created_at&created_at=gte.${encodeURIComponent(CUTOFF)}&source=in.(concours,boxplus)&order=created_at.asc&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  const concours = rows.filter((c) => c.source === 'concours');
  const ami = rows.filter(
    (c) => c.source === 'boxplus' && /Parrainage/i.test(String(c.offre || ''))
  );
  return { concours, ami };
}

async function loadFriendOrderMap() {
  const sb = getSupabase();
  const map = new Map();
  let from = 0;
  for (;;) {
    const { data } = await sb
      .from('boxplus_orders')
      .select('order_id,payload')
      .gte('created_at', CUTOFF)
      .order('created_at', { ascending: true })
      .range(from, from + 499);
    if (!data?.length) break;
    for (const row of data) {
      const p = row.payload || {};
      const f = p.referral_friend || {};
      const ref = p.customer_short || {};
      for (const k of phoneKeys(f.telephone || f.phone)) {
        map.set(k, {
          order_id: row.order_id,
          friend: f,
          referrer: ref,
        });
      }
    }
    if (data.length < 500) break;
    from += 500;
  }
  return map;
}

async function markConcoursSent(telephone, sid) {
  const sb = getSupabase();
  for (const k of phoneKeys(telephone)) {
    const variants = [k, k.length === 9 ? `0${k}` : k, `33${k.replace(/^0/, '')}`];
    for (const tel of variants) {
      await sb
        .from('concours_contacts')
        .update({ wa_status: 'sent', wa_error: null, updated_at: new Date().toISOString() })
        .eq('telephone', tel);
    }
  }
}

async function markAmiSent(orderId, sid) {
  if (!orderId) return;
  const sb = getSupabase();
  const { data } = await sb.from('boxplus_orders').select('payload').eq('order_id', orderId).maybeSingle();
  if (!data?.payload) return;
  const payload = data.payload;
  payload.referral_notify = {
    ...(payload.referral_notify || {}),
    sms: { sent: true, via: 'twilio', sid, catchup: true, at: new Date().toISOString() },
    whatsapp: { sent: true, via: 'twilio', sid, catchup: true, at: new Date().toISOString() },
  };
  payload.referral_notified_at = new Date().toISOString();
  await sb.from('boxplus_orders').update({ payload, updated_at: new Date().toISOString() }).eq('order_id', orderId);
}

async function main() {
  if (!isConfigured() && !DRY_RUN) {
    throw new Error('Twilio non configure (TWILIO_ACCOUNT_SID / TOKEN / PHONE_NUMBER)');
  }
  if (DRY_RUN) process.env.BOXPLUS_SMS_DRY_RUN = '1';

  const { concours, ami } = await loadPortetTargets();
  const friendOrders = await loadFriendOrderMap();
  const report = {
    at: new Date().toISOString(),
    cutoff: CUTOFF,
    dry_run: DRY_RUN,
    targets: { concours: concours.length, ami: ami.length, total: concours.length + ami.length },
    sent: 0,
    failed: 0,
    results: [],
  };

  console.log(`Rattrapage Twilio — ${report.targets.total} SMS (${concours.length} concours + ${ami.length} amis 29€)`);

  for (const c of concours) {
    const body = confirmationMessage(c.prenom || 'there');
    const out = await sendTransactionalSms(c.telephone, body, { source: 'concours-rattrapage' });
    report.results.push({
      kind: 'concours',
      nom: [c.prenom, c.nom].filter(Boolean).join(' '),
      phone: c.telephone,
      ok: out.ok,
      sid: out.sid || null,
      error: out.error || null,
    });
    if (out.ok) {
      report.sent += 1;
      if (!DRY_RUN) await markConcoursSent(c.telephone, out.sid).catch(() => {});
      console.log('OK concours', c.prenom, c.nom, out.sid || 'dry-run');
    } else {
      report.failed += 1;
      console.log('FAIL concours', c.prenom, c.nom, out.error);
    }
    await sleep(DELAY_MS);
  }

  for (const c of ami) {
    let match = null;
    for (const k of phoneKeys(c.telephone)) {
      if (friendOrders.has(k)) {
        match = friendOrders.get(k);
        break;
      }
    }
    const copy = buildReferralCopy({
      friendPrenom: c.prenom || match?.friend?.prenom,
      referrerFirst: match?.referrer?.first_name || '',
      referrerLast: match?.referrer?.last_name || '',
    });
    const out = await sendTransactionalSms(c.telephone, copy.text, { source: 'offre29-ami-rattrapage' });
    report.results.push({
      kind: 'ami_29',
      nom: [c.prenom, c.nom].filter(Boolean).join(' '),
      phone: c.telephone,
      order_id: match?.order_id || null,
      ok: out.ok,
      sid: out.sid || null,
      error: out.error || null,
    });
    if (out.ok) {
      report.sent += 1;
      if (!DRY_RUN && match?.order_id) await markAmiSent(match.order_id, out.sid).catch(() => {});
      console.log('OK ami', c.prenom, c.nom, out.sid || 'dry-run');
    } else {
      report.failed += 1;
      console.log('FAIL ami', c.prenom, c.nom, out.error);
    }
    await sleep(DELAY_MS);
  }

  const outPath = path.join(__dirname, '..', 'data', `rattrapage-sms-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nTermine', { sent: report.sent, failed: report.failed, log: outPath });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
