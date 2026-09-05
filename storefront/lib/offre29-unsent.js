'use strict';

/**
 * Amis invités via l’Offre Duo 29 € dont le SMS / WhatsApp n’est pas encore parti.
 * (Pas les reprises ni relances d’inscription — uniquement le parrainage ami.)
 */
const { listOrdersCreatedSinceAsync } = require('./order-lifecycle');
const { sanitizeFriend, isOffre29Order, buildReferralCopy } = require('./referral-notify');

const DEFAULT_SINCE = '2026-08-17T00:00:00.000Z';

function waDuoSent(row) {
  return Boolean(row?.referral_notify?.whatsapp?.sent || row?.referral_notify?.sms?.sent);
}

function referrerName(row) {
  const short = row?.customer_short || {};
  return [short.first_name, short.last_name].filter(Boolean).join(' ').trim() || '—';
}

function summarizeDuoFriend(row, friend, copy) {
  return {
    type: 'duo_ami',
    order_id: row.order_id,
    created_at: row.created_at || null,
    name: [friend.prenom, friend.nom].filter(Boolean).join(' ').trim() || friend.prenom,
    phone: friend.telephone,
    email: friend.email || null,
    referrer: copy.who,
    label: `Invité par ${copy.who}`,
    gym: row.customer_full?.gym || row.customer_short?.gym || null,
    paid_at: row.payment?.paid_at || row.paid_at || null,
  };
}

async function listOffre29Unsent({ since = DEFAULT_SINCE, rows: rowsOverride } = {}) {
  const rows = (rowsOverride || (await listOrdersCreatedSinceAsync(since))).filter(isOffre29Order);
  const items = [];

  for (const row of rows) {
    const pay = String(row.payment?.status || 'pending').toLowerCase();
    if (pay !== 'paid') continue;
    const friend = sanitizeFriend(row.referral_friend);
    if (!friend || waDuoSent(row)) continue;
    const copy = buildReferralCopy({
      friendPrenom: friend.prenom,
      referrerFirst: row.customer_short?.first_name,
      referrerLast: row.customer_short?.last_name,
    });
    items.push(summarizeDuoFriend(row, friend, copy));
  }

  items.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  return {
    since,
    scanned: rows.length,
    count: items.length,
    items,
    preview: items.slice(0, 5).map((i) => `${i.name} (par ${i.referrer})`),
  };
}

function typeLabel() {
  return 'Ami Offre Duo';
}

module.exports = {
  DEFAULT_SINCE,
  listOffre29Unsent,
  typeLabel,
  waDuoSent,
};
