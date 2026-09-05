#!/usr/bin/env node
'use strict';
/**
 * Chiffres exacts — messages 29 € (amis Duo) et concours pas partis.
 *   node scripts/audit-messages-pas-partis.js
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';

const { getSupabase } = require('../storefront/lib/supabase');
const { sanitizeFriend, isOffre29Order } = require('../storefront/lib/referral-notify');

function waDuoSent(row) {
  return Boolean(row?.referral_notify?.whatsapp?.sent || row?.referral_notify?.sms?.sent);
}

async function pageOrders() {
  const sb = getSupabase();
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select(
        [
          'order_id',
          'created_at',
          'product_id:payload->product_id',
          'product_snapshot:payload->product_snapshot',
          'payment:payload->payment',
          'customer_short:payload->customer_short',
          'referral_friend:payload->referral_friend',
          'referral_notify:payload->referral_notify',
        ].join(',')
      )
      .order('created_at', { ascending: true })
      .range(from, from + 199);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    from += 200;
  }
  return all;
}

async function supabaseRest(table, query) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  });
  const text = await res.text();
  let rows = [];
  try {
    rows = text ? JSON.parse(text) : [];
  } catch {
    rows = [];
  }
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]) || rows.length;
  return { rows: Array.isArray(rows) ? rows : [], total, ok: res.ok, status: res.status, raw: text };
}

async function main() {
  const orders = await pageOrders();
  const offre29Paid = orders.filter(
    (r) => isOffre29Order(r) && String(r.payment?.status || '').toLowerCase() === 'paid'
  );
  const duoWithFriend = [];
  const duoUnsent = [];
  for (const r of offre29Paid) {
    const friend = sanitizeFriend(r.referral_friend);
    if (!friend) continue;
    const row = {
      order_id: r.order_id,
      created_at: r.created_at,
      parrain: [r.customer_short?.first_name, r.customer_short?.last_name].filter(Boolean).join(' '),
      ami: [friend.prenom, friend.nom].filter(Boolean).join(' '),
      phone: friend.telephone,
      wa: Boolean(r.referral_notify?.whatsapp?.sent),
      sms: Boolean(r.referral_notify?.sms?.sent),
      notify: r.referral_notify || null,
    };
    duoWithFriend.push(row);
    if (!waDuoSent(r)) duoUnsent.push(row);
  }

  const concoursPending = await supabaseRest(
    'concours_contacts',
    'select=id,prenom,nom,telephone,email,salle,wa_status,wa_error,created_at&wa_status=eq.pending&order=created_at.desc'
  );
  const concoursError = await supabaseRest(
    'concours_contacts',
    'select=id,prenom,nom,telephone,email,salle,wa_status,wa_error,created_at&wa_status=eq.error&order=created_at.desc'
  );
  const concoursSkipped = await supabaseRest(
    'concours_contacts',
    'select=id,prenom,nom,telephone,wa_status,created_at&wa_status=eq.skipped&order=created_at.desc'
  );
  const waQueuePending = await supabaseRest(
    'concours_wa_queue',
    'select=id,contact_id,phone,status,kind,created_at&status=eq.pending&order=created_at.asc'
  );
  const waQueueError = await supabaseRest(
    'concours_wa_queue',
    'select=id,contact_id,phone,status,kind,error,created_at&status=eq.error&order=created_at.desc'
  );

  const tunnelAmis = await supabaseRest(
    'tunnel_leads',
    'select=id,prenom,nom,telephone,tunnel,created_at,meta&tunnel=eq.referral_pote&order=created_at.desc&limit=500'
  );

  const since3d = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const duoRecentUnsent = duoUnsent.filter((r) => Date.parse(r.created_at || '') >= since3d);
  const concoursRecentPending = (concoursPending.rows || []).filter(
    (r) => Date.parse(r.created_at || '') >= since3d
  );

  const report = {
    generated_at: new Date().toISOString(),
    offre_duo_29: {
      parrains_payes_avec_ami: duoWithFriend.length,
      amis_sms_pas_parti: duoUnsent.length,
      amis_deja_notifies: duoWithFriend.length - duoUnsent.length,
      dont_3_derniers_jours: duoRecentUnsent.length,
      liste_pas_parti: duoUnsent.map((r) => ({
        ami: r.ami,
        phone: r.phone,
        parrain: r.parrain,
        order_id: r.order_id,
        date: r.created_at,
      })),
    },
    concours: {
      contacts_wa_pending: concoursPending.rows?.length ?? 0,
      contacts_wa_error: concoursError.rows?.length ?? 0,
      contacts_wa_skipped: concoursSkipped.rows?.length ?? 0,
      file_wa_pending: waQueuePending.rows?.length ?? 0,
      file_wa_error: waQueueError.rows?.length ?? 0,
      dont_pending_3_derniers_jours: concoursRecentPending.length,
      liste_pending: (concoursPending.rows || []).map((r) => ({
        nom: [r.prenom, r.nom].filter(Boolean).join(' '),
        phone: r.telephone,
        email: r.email,
        salle: r.salle,
        date: r.created_at,
      })),
      liste_error: (concoursError.rows || []).slice(0, 30).map((r) => ({
        nom: [r.prenom, r.nom].filter(Boolean).join(' '),
        phone: r.telephone,
        erreur: r.wa_error,
        date: r.created_at,
      })),
    },
    tunnel_leads_ami: {
      total_referral_pote: tunnelAmis.rows?.length ?? 0,
    },
    total_pas_parti: duoUnsent.length + (concoursPending.rows?.length ?? 0) + (waQueuePending.rows?.length ?? 0),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
