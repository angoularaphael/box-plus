'use strict';

/**
 * Inventaire des messages 29 € pas encore partis (SMS / Signal / WhatsApp).
 * Même logique que scripts/flush-unsent-to-sms.js — liste + comptage admin.
 */
const { listOrdersCreatedSinceAsync } = require('./order-lifecycle');
const { sanitizeFriend, isOffre29Order, buildReferralCopy } = require('./referral-notify');
const {
  canPayOrder,
  customerPhone,
  resumeWhatsAppText,
  nudgeWhatsAppText,
  isNudgeDue,
  nudgeFullySent,
  isPaidIncomplete,
} = require('./inscription-nudge');

const DEFAULT_SINCE = '2026-08-17T00:00:00.000Z';

function waDuoSent(row) {
  return Boolean(row?.referral_notify?.whatsapp?.sent || row?.referral_notify?.sms?.sent);
}

function resumeSent(row) {
  return Boolean(
    row?.funnel?.resume_whatsapp_sent_at ||
      row?.funnel?.nudge_whatsapp_sent_at ||
      row?.funnel?.resume_whatsapp_backfill_at ||
      row?.funnel?.resume_sms_sent_at
  );
}

function nudgeWaUnsent(row, now = Date.now()) {
  const f = row?.funnel || {};
  if (f.nudge_whatsapp_sent_at || f.nudge_sms_sent_at || f.nudge_email_sent_at) return false;
  if (nudgeFullySent(row)) return false;
  const skip = String(f.nudge_whatsapp_skipped || f.nudge_email_skipped || '').toLowerCase();
  if (skip.includes('promo') || skip.includes('pause') || skip.includes('restrict')) return true;
  return isNudgeDue(row, now, { force: false });
}

function customerName(row) {
  const short = row?.customer_short || {};
  return [short.first_name, short.last_name].filter(Boolean).join(' ').trim() || '—';
}

function summarizeRow(row, { type, label, phone, extra = {} }) {
  return {
    type,
    label,
    order_id: row.order_id,
    created_at: row.created_at || null,
    name: customerName(row),
    phone: phone || customerPhone(row) || null,
    gym: row.customer_full?.gym || row.customer_short?.gym || null,
    payment_status: row.payment?.status || 'pending',
    step: row.step || null,
    ...extra,
  };
}

async function listOffre29Unsent({ since = DEFAULT_SINCE, now = Date.now(), rows: rowsOverride } = {}) {
  const rows = (rowsOverride || (await listOrdersCreatedSinceAsync(since))).filter(isOffre29Order);
  const items = [];

  for (const row of rows) {
    const pay = String(row.payment?.status || 'pending').toLowerCase();

    if (pay === 'paid' && sanitizeFriend(row.referral_friend) && !waDuoSent(row)) {
      const friend = sanitizeFriend(row.referral_friend);
      const copy = buildReferralCopy({
        friendPrenom: friend.prenom,
        referrerFirst: row.customer_short?.first_name,
        referrerLast: row.customer_short?.last_name,
      });
      items.push(
        summarizeRow(row, {
          type: 'duo_ami',
          label: `Ami ${friend.prenom} (invité par ${copy.who})`,
          phone: friend.telephone,
          extra: { friend_name: friend.prenom, referrer: copy.who },
        })
      );
    }

    if (pay !== 'paid' && pay !== 'free' && customerPhone(row) && !resumeSent(row) && canPayOrder(row)) {
      items.push(
        summarizeRow(row, {
          type: 'reprise',
          label: 'Reprise inscription 29 € (paiement en attente)',
          phone: customerPhone(row),
        })
      );
    }

    if (pay === 'paid' && isPaidIncomplete(row) && nudgeWaUnsent(row, now)) {
      items.push(
        summarizeRow(row, {
          type: 'relance',
          label: 'Relance inscription 29 € (dossier non finalisé)',
          phone: customerPhone(row),
        })
      );
    }
  }

  items.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  const byType = {
    duo_ami: items.filter((i) => i.type === 'duo_ami').length,
    reprise: items.filter((i) => i.type === 'reprise').length,
    relance: items.filter((i) => i.type === 'relance').length,
  };

  return {
    since,
    scanned: rows.length,
    count: items.length,
    by_type: byType,
    items,
    preview: {
      duo_ami: items.filter((i) => i.type === 'duo_ami').slice(0, 3).map((i) => i.label),
      reprise: items.filter((i) => i.type === 'reprise').slice(0, 3).map((i) => i.label),
      relance: items.filter((i) => i.type === 'relance').slice(0, 3).map((i) => i.label),
    },
  };
}

function typeLabel(type) {
  if (type === 'duo_ami') return 'Ami parrainé';
  if (type === 'reprise') return 'Reprise 29 €';
  if (type === 'relance') return 'Relance dossier';
  return type;
}

module.exports = {
  DEFAULT_SINCE,
  listOffre29Unsent,
  typeLabel,
  waDuoSent,
  resumeSent,
  nudgeWaUnsent,
};
