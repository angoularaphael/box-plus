#!/usr/bin/env node
'use strict';
/**
 * Audit honnête : concours + amis 29 € vs gateway SMS réel (pas seulement wa_status en base).
 */
require('dotenv').config();

const SMS_API = (process.env.SMS_GATEWAY_URL || 'http://prem-eu2.bot-hosting.net:21724').replace(/\/$/, '');
const SMS_EMAIL = process.env.SMS_GATEWAY_EMAIL;
const SMS_PASSWORD = process.env.SMS_GATEWAY_PASSWORD;

async function sms(pathname, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${SMS_API}${pathname}`, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function supabaseAll(table, query) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rows = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const sep = query.includes('?') ? '&' : '?';
    const res = await fetch(`${url}/rest/v1/${table}${query}${sep}offset=${from}&limit=${page}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(JSON.stringify(batch));
    rows.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return rows;
}

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('33') && d.length >= 11) d = `0${d.slice(-9)}`;
  if (d.length === 9 && /^[67]/.test(d)) d = `0${d}`;
  return d;
}

(async () => {
  const report = { gateway: {}, concours: {}, offre_duo_29: {} };

  // 1) Gateway health
  try {
    const health = await sms('/api/health');
    report.gateway.health = health.json;
    report.gateway.reachable = health.ok;
  } catch (err) {
    report.gateway.reachable = false;
    report.gateway.error = err.message;
  }

  let token = null;
  try {
    const login = await sms('/api/auth/login', {
      method: 'POST',
      body: { email: SMS_EMAIL, password: SMS_PASSWORD },
    });
    token = login.json?.token || null;
    report.gateway.login_ok = Boolean(token);
  } catch (err) {
    report.gateway.login_ok = false;
    report.gateway.login_error = err.message;
  }

  if (token) {
    try {
      const devices = await sms('/api/devices', { token });
      const list = devices.json?.devices || devices.json || [];
      report.gateway.devices = Array.isArray(list)
        ? list.map((d) => ({
            id: d.id,
            name: d.name,
            connected: d.connected,
            status: d.status,
            lastSeen: d.lastSeen || d.last_seen,
          }))
        : devices.json;
      report.gateway.any_connected = Array.isArray(list) && list.some((d) => d.connected);
    } catch (err) {
      report.gateway.devices_error = err.message;
    }

    try {
      const campaigns = await sms('/api/campaigns', { token });
      const list = Array.isArray(campaigns.json) ? campaigns.json : campaigns.json?.campaigns || [];
      const concours = list.filter((c) => /^Concours/i.test(c.name || ''));
      const stats = { total: concours.length, queued: 0, sent: 0, failed: 0, delivered: 0, stuck: 0 };
      const stuckList = [];
      for (const c of concours) {
        const s = c.stats || {};
        stats.queued += s.queued || 0;
        stats.sent += s.sent || 0;
        stats.failed += s.failed || 0;
        stats.delivered += s.delivered || 0;
        if ((s.queued || 0) > 0 || (s.failed || 0) > 0 || c.status === 'failed') {
          stats.stuck += 1;
          stuckList.push({
            name: c.name,
            status: c.status,
            createdAt: c.createdAt,
            queued: s.queued,
            sent: s.sent,
            failed: s.failed,
            delivered: s.delivered,
          });
        }
      }
      report.gateway.concours_campaigns = stats;
      report.gateway.concours_stuck_sample = stuckList.slice(-30);
    } catch (err) {
      report.gateway.campaigns_error = err.message;
    }
  }

  // 2) Concours contacts — croiser base vs livraison réelle
  const contacts = await supabaseAll(
    'concours_contacts',
    '?select=id,prenom,nom,telephone,wa_status,wa_error,created_at&order=created_at.asc'
  );
  const byStatus = {};
  for (const c of contacts) {
    byStatus[c.wa_status] = (byStatus[c.wa_status] || 0) + 1;
  }
  report.concours.db_total = contacts.length;
  report.concours.db_by_wa_status = byStatus;
  report.concours.db_marked_sent = byStatus.sent || 0;

  // Si gateway déconnecté : tous les "sent" depuis la déconnexion sont suspects
  const sinceDisconnect = '2026-08-28T00:00:00Z'; // ajuster si besoin
  const markedSentSince = contacts.filter(
    (c) => c.wa_status === 'sent' && c.created_at >= sinceDisconnect
  );
  const notSent = contacts.filter((c) => c.wa_status !== 'sent');
  report.concours.marked_sent_since_28_aug = markedSentSince.length;
  report.concours.not_marked_sent_total = notSent.length;
  report.concours.not_marked_sent_list = notSent.map((c) => ({
    nom: [c.prenom, c.nom].filter(Boolean).join(' '),
    phone: c.telephone,
    status: c.wa_status,
    erreur: c.wa_error,
    date: c.created_at,
  }));

  // Si gateway déconnecté, les "sent" depuis déconnexion = probablement pas reçus
  if (!report.gateway.any_connected) {
    report.concours.estimated_pas_parti =
      notSent.length + markedSentSince.length;
    report.concours.estimated_pas_parti_note =
      'Gateway déconnecté : les contacts marqués sent depuis le 28 août sont probablement seulement en file API, pas livrés sur téléphone.';
    report.concours.liste_pas_parti_probable = [
      ...notSent.map((c) => ({
        nom: [c.prenom, c.nom].filter(Boolean).join(' '),
        phone: c.telephone,
        raison: c.wa_status === 'skipped' ? 'skipped' : c.wa_error || c.wa_status,
        date: c.created_at,
      })),
      ...markedSentSince.map((c) => ({
        nom: [c.prenom, c.nom].filter(Boolean).join(' '),
        phone: c.telephone,
        raison: 'marqué sent mais gateway déconnecté',
        date: c.created_at,
      })),
    ];
  } else {
    report.concours.estimated_pas_parti = notSent.length;
    report.concours.liste_pas_parti_probable = report.concours.not_marked_sent_list;
  }

  // 3) Amis 29 € duo
  process.env.BOXPLUS_ORDERS_REMOTE = '1';
  const { getSupabase } = require('../storefront/lib/supabase');
  const { sanitizeFriend, isOffre29Order } = require('../storefront/lib/referral-notify');
  const sb = getSupabase();
  let from = 0;
  const orders = [];
  for (;;) {
    const { data } = await sb
      .from('boxplus_orders')
      .select('order_id,created_at,payload')
      .order('created_at', { ascending: true })
      .range(from, from + 199);
    if (!data?.length) break;
    orders.push(...data);
    if (data.length < 200) break;
    from += 200;
  }
  const duoUnsent = [];
  for (const r of orders) {
    const p = r.payload || {};
    if (!isOffre29Order(p) || p.payment?.status !== 'paid') continue;
    const friend = sanitizeFriend(p.referral_friend);
    if (!friend) continue;
    const sent = p.referral_notify?.whatsapp?.sent || p.referral_notify?.sms?.sent;
    if (sent) continue;
    duoUnsent.push({
      ami: [friend.prenom, friend.nom].filter(Boolean).join(' '),
      phone: friend.telephone,
      parrain: [p.customer_short?.first_name, p.customer_short?.last_name].filter(Boolean).join(' '),
      date: r.created_at,
      erreur: p.referral_notify?.whatsapp?.error || 'jamais_tente',
    });
  }
  report.offre_duo_29.amis_pas_parti = duoUnsent.length;
  report.offre_duo_29.liste = duoUnsent;

  console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
