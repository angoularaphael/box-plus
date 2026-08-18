'use strict';

/**
 * Rattrapage : WhatsApp Offre Duo (ami parrainé) non envoyés.
 * Usage : node scripts/backfill-duo-whatsapp.js [--since=2026-08-17T12:00:00Z] [--dry]
 */
require('dotenv').config();

const { getSupabase } = require('../storefront/lib/supabase');
const {
  sanitizeFriend,
  isOffre29Order,
  buildReferralCopy,
} = require('../storefront/lib/referral-notify');
const { getWhatsAppStatus, sendWhatsAppMessage } = require('../storefront/lib/whatsapp-bot');
const { loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');

const SINCE = process.argv.find((a) => a.startsWith('--since='))?.slice(8) || '2026-08-17T12:00:00.000Z';
const DRY = process.argv.includes('--dry');

function waSent(order) {
  return Boolean(order?.referral_notify?.whatsapp?.sent);
}
function mailSent(order) {
  const e = order?.referral_notify?.email;
  return Boolean(e?.sent && !e?.skipped);
}

async function listDuoSince(sinceIso) {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  const page = 200;
  while (true) {
    const to = from + page - 1;
    const { data, error } = await sb
      .from('boxplus_orders')
      .select(
        [
          'order_id',
          'created_at',
          'referral_friend:payload->referral_friend',
          'referral_notify:payload->referral_notify',
          'customer_short:payload->customer_short',
          'product_id:payload->product_id',
          'product_snapshot:payload->product_snapshot',
        ].join(',')
      )
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return all.filter((row) => {
    if (!isOffre29Order(row)) return false;
    const friend = sanitizeFriend(row.referral_friend);
    return Boolean(friend);
  });
}

async function main() {
  const status = await getWhatsAppStatus();
  console.log(
    JSON.stringify({
      wa: {
        reachable: status.reachable,
        connected: status.connected,
        connecting: status.connecting,
        error: status.error || null,
      },
      since: SINCE,
      dry: DRY,
    })
  );

  const rows = await listDuoSince(SINCE);
  const missingWa = rows.filter((r) => !waSent(r));
  const missingBoth = missingWa.filter((r) => !mailSent(r));
  console.log(
    JSON.stringify({
      duo_with_friend: rows.length,
      missing_whatsapp: missingWa.length,
      missing_mail_and_whatsapp: missingBoth.length,
    })
  );

  const targets = missingWa;
  for (const row of targets) {
    const friend = sanitizeFriend(row.referral_friend);
    const referrer = row.customer_short || {};
    const copy = buildReferralCopy({
      friendPrenom: friend.prenom,
      referrerFirst: referrer.first_name,
      referrerLast: referrer.last_name,
    });
    const summary = {
      order_id: row.order_id,
      ami: friend.prenom,
      parrain: [referrer.first_name, referrer.last_name].filter(Boolean).join(' '),
      mail_deja: mailSent(row),
      created_at: row.created_at,
    };
    if (DRY) {
      console.log(JSON.stringify({ dry: true, ...summary }));
      continue;
    }
    if (!status.connected) {
      console.log(JSON.stringify({ skipped: 'wa_disconnected', ...summary }));
      continue;
    }
    try {
      await sendWhatsAppMessage(friend.telephone, copy.text);
      const order = await loadOrderAsync(row.order_id);
      if (order) {
        order.referral_notify = {
          ...(order.referral_notify || {}),
          whatsapp: { sent: true, backfill: true, at: new Date().toISOString() },
        };
        order.referral_notified_at = order.referral_notified_at || new Date().toISOString();
        await saveOrderAsync(order);
      }
      console.log(JSON.stringify({ sent: true, ...summary }));
    } catch (err) {
      console.log(JSON.stringify({ sent: false, error: err.message, ...summary }));
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
