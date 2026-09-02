const fs = require('fs');
const path = require('path');
const { logError, logWarn } = require('../../lib/logger');
const { getSupabase } = require('./supabase');
const { sanitizeOrderId } = require('./security');

const ORDERS_DIR =
  process.env.BOXPLUS_ORDERS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-orders' : path.join(__dirname, '../../data/storefront/orders'));

const PAGE_SIZE = 1000;
const LIST_CACHE_MS = Number(process.env.BOXPLUS_ORDERS_LIST_CACHE_MS || 60 * 1000);
const HEAVY_KEY = /base64|email_html|image_data|data_url/i;

let listCache = { at: 0, rows: null };

function invalidateOrderListCache() {
  listCache = { at: 0, rows: null };
}

function useRemoteStore() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(
    (process.env.VERCEL || process.env.BOXPLUS_ORDERS_REMOTE === '1') &&
      url &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function orderPath(orderId) {
  const safe = sanitizeOrderId(orderId);
  if (!safe) return null;
  return path.join(ORDERS_DIR, `${safe}.json`);
}

function ensureOrdersDir() {
  fs.mkdirSync(ORDERS_DIR, { recursive: true });
}

function stripHeavyFields(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => stripHeavyFields(item, depth + 1));
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (HEAVY_KEY.test(key)) continue;
    if (typeof nested === 'string' && nested.length > 4000 && /^data:[^;]+;base64,/i.test(nested)) {
      continue;
    }
    out[key] = typeof nested === 'object' ? stripHeavyFields(nested, depth + 1) : nested;
  }
  return out;
}

function pickSnapshot(snapshot) {
  const s = snapshot || {};
  return {
    id: s.id || null,
    legacy_id: s.legacy_id || null,
    name: s.name || null,
    display_name: s.display_name || null,
    price_cents: s.price_cents || 0,
    price_label: s.price_label || null,
    requires_payment: s.requires_payment,
    requires_iban: s.requires_iban,
    sale_type: s.sale_type || null,
    tab: s.tab || null,
    subsection: s.subsection || null,
    duration_label: s.duration_label || null,
    supports_installment_choice: s.supports_installment_choice === true,
    installments_note: s.installments_note || null,
    badge: s.badge || null,
    party_size: Number(s.party_size) >= 1 ? Math.min(4, Math.round(Number(s.party_size))) : null,
  };
}

function pickPayment(payment) {
  const p = payment || {};
  return {
    status: p.status || null,
    paid_at: p.paid_at || null,
    amount: p.amount || null,
    billing_plan: p.billing_plan || null,
    payment_plan: p.payment_plan || null,
    stripe_subscription_id: p.stripe_subscription_id || null,
    subscription_id: p.subscription_id || null,
    payplug_payment_id: p.payplug_payment_id || null,
    payplug_payment_ids: Array.isArray(p.payplug_payment_ids) ? p.payplug_payment_ids.slice(-8) : [],
    has_iban: Boolean(p.iban),
  };
}

function buildOrderSummary(order) {
  if (!order || typeof order !== 'object') return null;
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const customer = order.customer || {};
  return {
    order_id: order.order_id,
    access_token: order.access_token || null,
    action: order.action || null,
    step: order.step || 1,
    product_id: order.product_id || order.product_snapshot?.id || null,
    product_name: order.product_name || null,
    product_snapshot: pickSnapshot(order.product_snapshot),
    payment: pickPayment(order.payment),
    customer_short: {
      first_name: short.first_name || null,
      last_name: short.last_name || null,
      email: short.email || null,
      phone: short.phone || null,
      birthdate: short.birthdate || null,
    },
    customer_full: {
      gym: full.gym || null,
      email: full.email || null,
    },
    customer: {
      name: customer.name || null,
      email: customer.email || null,
      phone: customer.phone || null,
      gym: customer.gym || null,
    },
    gym: order.gym || full.gym || customer.gym || null,
    party_size: Number(order.party_size || order.product_snapshot?.party_size) >= 1
      ? Math.min(4, Math.round(Number(order.party_size || order.product_snapshot?.party_size)))
      : null,
    companions: Array.isArray(order.companions) ? order.companions : [],
    activity: order.activity || null,
    activity_label: order.activity_label || null,
    booking_date: order.booking_date || null,
    slot: order.slot || null,
    slot_label: order.slot_label || null,
    booking_status: order.booking_status || null,
    cancel_status: order.cancel_status || null,
    access_blocked: Boolean(order.access_blocked),
    ready_for_dispatch: Boolean(order.ready_for_dispatch),
    gestion_client_id: order.gestion_client_id || null,
    signature: { signed_at: order.signature?.signed_at || null },
    funnel: {
      complete_deadline_at: order.funnel?.complete_deadline_at || null,
      step_entered_at: order.funnel?.step_entered_at || null,
      last_nudge_at: order.funnel?.last_nudge_at || null,
      nudge_attempts: Number(order.funnel?.nudge_attempts || 0) || 0,
      nudge_sent_at: order.funnel?.nudge_sent_at || null,
      nudge_email_sent_at: order.funnel?.nudge_email_sent_at || null,
      nudge_whatsapp_sent_at: order.funnel?.nudge_whatsapp_sent_at || null,
      nudge_whatsapp_skipped_at: order.funnel?.nudge_whatsapp_skipped_at || null,
      nudge_queued_at: order.funnel?.nudge_queued_at || null,
    },
    documents: {
      photo: order.documents?.photo || null,
      photo_filename: order.documents?.photo_filename || null,
      photo_url: order.documents?.photo_url || null,
      has_photo: Boolean(
        order.documents?.photo ||
          order.documents?.photo_base64 ||
          order.documents?.photo_filename ||
          order.documents?.photo_url
      ),
    },
    dispatched_at: order.dispatched_at || null,
    skip_bot: Boolean(order.skip_bot),
    sale_reconcile_at: order.sale_reconcile_at || null,
    sale_reconcile_attempts: Number(order.sale_reconcile_attempts || 0) || 0,
    bot_processed_at: order.bot_processed_at || null,
    email_sent_at: order.email_sent_at || null,
    created_at: order.created_at || null,
    updated_at: order.updated_at || null,
    deciplus_member_id: order.deciplus_member_id || null,
    deciplus_sale_id: order.deciplus_sale_id || null,
    bot_status: order.bot_status || null,
    bot_error: order.bot_error || null,
    manual_migration: Boolean(order.manual_migration),
    essai_followup_status: order.essai_followup_status || null,
    essai_followup_at: order.essai_followup_at || null,
    essai_followup_check_queued_at: order.essai_followup_check_queued_at || null,
    essai_abo_checked_at: order.essai_abo_checked_at || null,
    essai_has_abo: Boolean(order.essai_has_abo),
    essai_customer_nudges: Array.isArray(order.essai_customer_nudges)
      ? order.essai_customer_nudges.slice(0, 3)
      : [],
  };
}

function unwrapJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function rowValue(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return unwrapJson(row[key]);
  }
  return undefined;
}

function reconstructOrderFromListRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.summary && typeof row.summary === 'object' && (row.summary.order_id || row.order_id)) {
    return stripHeavyFields({
      ...row.summary,
      order_id: row.summary.order_id || row.order_id,
      access_token: row.summary.access_token || row.access_token || null,
      updated_at: row.summary.updated_at || row.updated_at,
    });
  }
  if (row.payload && typeof row.payload === 'object') {
    return stripHeavyFields(row.payload);
  }
  const signedAt = rowValue(row, 'signed_at', 'payload->signature->signed_at');
  const photo = rowValue(row, 'photo', 'payload->documents->photo');
  const photoFilename = rowValue(row, 'photo_filename', 'payload->documents->photo_filename');
  const photoUrl = rowValue(row, 'photo_url', 'payload->documents->photo_url');
  const reconstructed = {
    order_id: row.order_id,
    access_token: row.access_token || rowValue(row, 'token') || null,
    action: rowValue(row, 'action', 'payload->action') || null,
    step: rowValue(row, 'step', 'payload->step') || 1,
    product_id: rowValue(row, 'product_id', 'payload->product_id') || null,
    product_name: rowValue(row, 'product_name', 'payload->product_name') || null,
    product_snapshot: stripHeavyFields(rowValue(row, 'product_snapshot', 'payload->product_snapshot') || {}),
    payment: stripHeavyFields(rowValue(row, 'payment', 'payload->payment') || {}),
    customer_short: stripHeavyFields(rowValue(row, 'customer_short', 'payload->customer_short') || {}),
    customer_full: stripHeavyFields({
      gym: rowValue(row, 'customer_gym', 'gym_full') || (rowValue(row, 'customer_full', 'payload->customer_full') || {}).gym || null,
      email: rowValue(row, 'customer_email') || (rowValue(row, 'customer_full', 'payload->customer_full') || {}).email || null,
    }),
    customer: stripHeavyFields(rowValue(row, 'customer', 'payload->customer') || {}),
    gym: rowValue(row, 'gym', 'payload->gym') || rowValue(row, 'customer_gym') || null,
    aventure: Boolean(rowValue(row, 'aventure', 'payload->aventure')),
    source: rowValue(row, 'source', 'payload->source') || null,
    skip_dossier: Boolean(rowValue(row, 'skip_dossier', 'payload->skip_dossier')),
    activity: rowValue(row, 'activity', 'payload->activity') || null,
    activity_label: rowValue(row, 'activity_label', 'payload->activity_label') || null,
    booking_date: rowValue(row, 'booking_date', 'payload->booking_date') || null,
    slot: rowValue(row, 'slot', 'payload->slot') || null,
    slot_label: rowValue(row, 'slot_label', 'payload->slot_label') || null,
    booking_status: rowValue(row, 'booking_status', 'payload->booking_status') || null,
    cancel_status: rowValue(row, 'cancel_status', 'payload->cancel_status') || null,
    access_blocked: Boolean(rowValue(row, 'access_blocked', 'payload->access_blocked')),
    ready_for_dispatch: Boolean(rowValue(row, 'ready_for_dispatch', 'payload->ready_for_dispatch')),
    gestion_client_id: rowValue(row, 'gestion_client_id', 'payload->gestion_client_id') || null,
    signature: { signed_at: signedAt || null },
    funnel: stripHeavyFields(rowValue(row, 'funnel', 'payload->funnel') || {}),
    documents: {
      photo: photo || null,
      photo_filename: photoFilename || null,
      photo_url: photoUrl || null,
      has_photo: Boolean(photo || photoFilename || photoUrl),
    },
    dispatched_at: rowValue(row, 'dispatched_at', 'payload->dispatched_at') || null,
    skip_bot: Boolean(rowValue(row, 'skip_bot', 'payload->skip_bot')),
    sale_reconcile_at: rowValue(row, 'sale_reconcile_at', 'payload->sale_reconcile_at') || null,
    sale_reconcile_attempts: Number(rowValue(row, 'sale_reconcile_attempts', 'payload->sale_reconcile_attempts') || 0) || 0,
    bot_processed_at: rowValue(row, 'bot_processed_at', 'payload->bot_processed_at') || null,
    email_sent_at: rowValue(row, 'email_sent_at', 'payload->email_sent_at') || null,
    deciplus_member_id: rowValue(row, 'deciplus_member_id', 'payload->deciplus_member_id') || null,
    deciplus_sale_id: rowValue(row, 'deciplus_sale_id', 'payload->deciplus_sale_id') || null,
    addons: (() => {
      const blade = rowValue(row, 'blade_addon', 'payload->addons->blade');
      return blade ? { blade } : {};
    })(),
    bot_status: rowValue(row, 'bot_status', 'payload->bot_status') || null,
    bot_error: rowValue(row, 'bot_error', 'payload->bot_error') || null,
    manual_migration: Boolean(rowValue(row, 'manual_migration', 'payload->manual_migration')),
    created_at: rowValue(row, 'created_at', 'payload->created_at') || row.created_at || null,
    updated_at: row.updated_at || rowValue(row, 'payload->updated_at') || null,
  };
  return stripHeavyFields(reconstructed);
}

const SLIM_SELECT = [
  'order_id',
  'updated_at',
  'access_token',
  'created_at',
  'step:payload->step',
  'action:payload->action',
  'product_id:payload->product_id',
  'product_name:payload->product_name',
  'gym:payload->gym',
  'aventure:payload->aventure',
  'source:payload->source',
  'skip_dossier:payload->skip_dossier',
  'dispatched_at:payload->dispatched_at',
  'skip_bot:payload->skip_bot',
  'sale_reconcile_at:payload->sale_reconcile_at',
  'sale_reconcile_attempts:payload->sale_reconcile_attempts',
  'bot_processed_at:payload->bot_processed_at',
  'email_sent_at:payload->email_sent_at',
  'booking_status:payload->booking_status',
  'booking_date:payload->booking_date',
  'activity:payload->activity',
  'activity_label:payload->activity_label',
  'slot:payload->slot',
  'slot_label:payload->slot_label',
  'cancel_status:payload->cancel_status',
  'access_blocked:payload->access_blocked',
  'ready_for_dispatch:payload->ready_for_dispatch',
  'gestion_client_id:payload->gestion_client_id',
  'payment:payload->payment',
  'customer_short:payload->customer_short',
  'customer:payload->customer',
  'customer_gym:payload->customer_full->gym',
  'customer_email:payload->customer_full->email',
  'product_snapshot:payload->product_snapshot',
  'funnel:payload->funnel',
  'signed_at:payload->signature->signed_at',
  'photo:payload->documents->photo',
  'photo_filename:payload->documents->photo_filename',
  'photo_url:payload->documents->photo_url',
  'deciplus_member_id:payload->deciplus_member_id',
  'deciplus_sale_id:payload->deciplus_sale_id',
  'bot_status:payload->bot_status',
  'bot_error:payload->bot_error',
  'manual_migration:payload->manual_migration',
  'blade_addon:payload->addons->blade',
].join(',\n');

async function fetchAllPages(makeQuery) {
  const all = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function loadOrderFromFs(orderId) {
  ensureOrdersDir();
  const file = orderPath(orderId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveOrderToFs(order) {
  ensureOrdersDir();
  const file = orderPath(order.order_id);
  if (!file) return;
  fs.writeFileSync(file, JSON.stringify(order, null, 2));
}

async function loadOrderFromRemote(orderId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('payload')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data?.payload || null;
}

async function saveOrderToRemote(order) {
  const sb = getSupabase();
  const accessToken =
    order.access_token ||
    (order.action === 'cancel' ? `cancel-${order.order_id}` : null) ||
    `tok-${order.order_id}`;
  if (!order.access_token) order.access_token = accessToken;
  const row = {
    order_id: order.order_id,
    access_token: accessToken,
    payload: stripHeavyFields(order),
    summary: buildOrderSummary(order),
    updated_at: order.updated_at || new Date().toISOString(),
  };
  let { error } = await sb.from('boxplus_orders').upsert(row, { onConflict: 'order_id' });
  if (error && /summary/i.test(String(error.message || error.code || ''))) {
    delete row.summary;
    ({ error } = await sb.from('boxplus_orders').upsert(row, { onConflict: 'order_id' }));
  }
  if (error) throw error;
  invalidateOrderListCache();
}

async function listOrdersFromRemoteSlim() {
  const sb = getSupabase();
  const makeSlim = () =>
    sb.from('boxplus_orders').select(SLIM_SELECT).order('updated_at', { ascending: false });
  try {
    const rows = await fetchAllPages(makeSlim);
    return rows.map(reconstructOrderFromListRow).filter(Boolean);
  } catch (err) {
    logWarn('Liste commandes slim (json) indisponible, essai colonne summary', {
      error: err.message,
    });
  }

  const makeSummary = () =>
    sb
      .from('boxplus_orders')
      .select('order_id, updated_at, access_token, created_at, summary')
      .order('updated_at', { ascending: false });
  const rows = await fetchAllPages(makeSummary);
  return rows.map(reconstructOrderFromListRow).filter(Boolean);
}

async function listOrdersFromRemote() {
  const now = Date.now();
  if (listCache.rows && now - listCache.at < LIST_CACHE_MS) {
    return listCache.rows;
  }
  const rows = await listOrdersFromRemoteSlim();
  listCache = { at: now, rows };
  return rows;
}

async function findRemoteOrderBySubscriptionId(subscriptionId) {
  const id = String(subscriptionId || '').trim();
  if (!id || !/^[A-Za-z0-9_\-]+$/.test(id)) return null;
  const sb = getSupabase();
  const filter = [
    `payload->payment->>stripe_subscription_id.eq.${id}`,
    `payload->payment->>subscription_id.eq.${id}`,
  ].join(',');
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('payload')
    .or(filter)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.payload || null;
}

function listOrdersFromFs() {
  ensureOrdersDir();
  if (!fs.existsSync(ORDERS_DIR)) return [];
  return fs
    .readdirSync(ORDERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ORDERS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
    );
}

async function loadOrder(orderId) {
  // Sur Vercel, /tmp est local à l'instance : un cache FS périmé peut masquer
  // une mise à jour IBAN faite sur une autre lambda. Quand le store distant est
  // actif, on lit TOUJOURS Supabase en priorité.
  if (useRemoteStore()) {
    try {
      const remote = await loadOrderFromRemote(orderId);
      if (remote) {
        saveOrderToFs(remote);
        return remote;
      }
    } catch (err) {
      logError('Chargement commande Supabase', { order_id: orderId, error: err.message });
    }
  }
  return loadOrderFromFs(orderId);
}

function saveOrder(order) {
  order.updated_at = new Date().toISOString();
  saveOrderToFs(order);
  invalidateOrderListCache();
  if (useRemoteStore()) {
    saveOrderToRemote(order).catch((err) => {
      logError('Sauvegarde commande Supabase', { order_id: order.order_id, error: err.message });
    });
  }
  return order;
}

async function saveOrderAsync(order) {
  order.updated_at = new Date().toISOString();
  saveOrderToFs(order);
  invalidateOrderListCache();
  if (useRemoteStore()) {
    await saveOrderToRemote(order);
  }
  return order;
}

async function listAllOrders() {
  if (useRemoteStore()) {
    try {
      const remote = await listOrdersFromRemote();
      if (remote.length) return remote;
    } catch (err) {
      logError('Liste commandes Supabase', { error: err.message });
    }
  }
  return listOrdersFromFs().map((order) => stripHeavyFields(order));
}

async function listOrdersFromRemoteSince(sinceIso, extraQuery) {
  const sb = getSupabase();
  const makeSlim = () => {
    let q = sb
      .from('boxplus_orders')
      .select(SLIM_SELECT)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });
    if (typeof extraQuery === 'function') q = extraQuery(q);
    return q;
  };
  const rows = await fetchAllPages(makeSlim);
  return rows.map(reconstructOrderFromListRow).filter(Boolean);
}

/** Liste limitée dans le temps — crons Vercel (évite le 504 en chargeant tout l’historique). */
async function listOrdersCreatedSince(sinceIso) {
  const cutoff = Date.parse(sinceIso);
  if (!Number.isFinite(cutoff)) return listAllOrders();
  if (useRemoteStore()) {
    try {
      return await listOrdersFromRemoteSince(sinceIso);
    } catch (err) {
      logWarn('Liste commandes depuis date indisponible, repli complet', { error: err.message });
    }
  }
  return listOrdersFromFs()
    .filter((order) => Date.parse(order.created_at || order.updated_at || 0) >= cutoff)
    .map((order) => stripHeavyFields(order));
}

function isPaidOrFreeStatus(order) {
  const st = String(order?.payment?.status || '').toLowerCase();
  return st === 'paid' || st === 'free';
}

/** Inscriptions payées depuis une date — stats ventes (évite de charger les brouillons). */
async function listPaidOrdersSince(sinceIso) {
  const cutoff = Date.parse(sinceIso);
  if (!Number.isFinite(cutoff)) {
    return (await listAllOrders()).filter(isPaidOrFreeStatus);
  }
  if (useRemoteStore()) {
    try {
      const paid = await listOrdersFromRemoteSince(sinceIso, (q) =>
        q.or('payload->payment->>status.eq.paid,payload->payment->>status.eq.free')
      );
      return paid.filter(isPaidOrFreeStatus);
    } catch (err) {
      logWarn('Liste commandes payées filtrée indisponible, repli created-since', {
        error: err.message,
      });
      return (await listOrdersCreatedSince(sinceIso)).filter(isPaidOrFreeStatus);
    }
  }
  return listOrdersFromFs()
    .filter((order) => Date.parse(order.created_at || order.updated_at || 0) >= cutoff)
    .filter(isPaidOrFreeStatus)
    .map((order) => stripHeavyFields(order));
}

async function findOrderBySubscriptionId(subscriptionId) {
  if (!subscriptionId) return null;
  if (useRemoteStore()) {
    try {
      const remote = await findRemoteOrderBySubscriptionId(subscriptionId);
      if (remote) return remote;
    } catch (err) {
      logWarn('Recherche abonnement ciblée indisponible, repli liste slim', {
        error: err.message,
      });
    }
  }
  const all = await listAllOrders();
  return (
    all.find(
      (o) =>
        o.payment?.stripe_subscription_id === subscriptionId ||
        o.payment?.subscription_id === subscriptionId
    ) || null
  );
}

function deleteOrderFromFs(orderId) {
  ensureOrdersDir();
  const file = orderPath(orderId);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}

async function deleteOrderFromRemote(orderId) {
  const sb = getSupabase();
  const { error } = await sb.from('boxplus_orders').delete().eq('order_id', orderId);
  if (error) throw error;
}

async function deleteOrder(orderId) {
  deleteOrderFromFs(orderId);
  invalidateOrderListCache();
  if (useRemoteStore()) {
    await deleteOrderFromRemote(orderId);
  }
}

module.exports = {
  ORDERS_DIR,
  useRemoteStore,
  loadOrderFromFs,
  loadOrder,
  saveOrder,
  saveOrderAsync,
  listAllOrders,
  listOrdersCreatedSince,
  listPaidOrdersSince,
  deleteOrder,
  findOrderBySubscriptionId,
  buildOrderSummary,
  stripHeavyFields,
  reconstructOrderFromListRow,
  invalidateOrderListCache,
};
