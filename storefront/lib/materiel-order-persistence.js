/**
 * Persistance commandes matériel — filesystem local + Supabase sur Vercel
 */
const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir } = require('../../lib/utils');
const { logError } = require('../../lib/logger');
const { getSupabase } = require('./supabase');

const ORDERS_DIR =
  process.env.BOXPLUS_MATERIEL_ORDERS_DIR ||
  (process.env.VERCEL
    ? path.join('/tmp', 'boxplus-materiel-orders')
    : path.join(ROOT, 'data', 'storefront', 'materiel-orders'));

function useRemoteStore() {
  return Boolean(
    (process.env.VERCEL || process.env.BOXPLUS_MATERIEL_ORDERS_REMOTE === '1') &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function orderPath(orderId) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
}

function ensureOrdersDir() {
  ensureDir(ORDERS_DIR);
}

function loadOrderFromFs(orderId) {
  ensureOrdersDir();
  const file = orderPath(orderId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveOrderToFs(order) {
  ensureOrdersDir();
  fs.writeFileSync(orderPath(order.order_id), JSON.stringify(order, null, 2), 'utf8');
}

async function loadOrderFromRemote(orderId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_materiel_orders')
    .select('payload')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data?.payload || null;
}

async function saveOrderToRemote(order) {
  const sb = getSupabase();
  const { error } = await sb.from('boxplus_materiel_orders').upsert(
    {
      order_id: order.order_id,
      payload: order,
      updated_at: order.updated_at || new Date().toISOString(),
    },
    { onConflict: 'order_id' }
  );
  if (error) throw error;
}

async function listOrdersFromRemote() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_materiel_orders')
    .select('payload')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => row.payload).filter(Boolean);
}

function listOrdersFromFs() {
  ensureOrdersDir();
  if (!fs.existsSync(ORDERS_DIR)) return [];
  try {
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
      .filter(Boolean);
  } catch {
    return [];
  }
}

function loadOrder(orderId) {
  return loadOrderFromFs(orderId);
}

async function loadOrderAsync(orderId) {
  const local = loadOrderFromFs(orderId);
  if (local) return local;
  if (!useRemoteStore()) return null;
  try {
    const remote = await loadOrderFromRemote(orderId);
    if (remote) saveOrderToFs(remote);
    return remote;
  } catch (err) {
    logError('Chargement commande matériel Supabase', { order_id: orderId, error: err.message });
    return null;
  }
}

function saveOrder(order) {
  order.updated_at = new Date().toISOString();
  saveOrderToFs(order);
  if (useRemoteStore()) {
    saveOrderToRemote(order).catch((err) => {
      logError('Sauvegarde commande matériel Supabase', {
        order_id: order.order_id,
        error: err.message,
      });
    });
  }
  return order;
}

async function saveOrderAsync(order) {
  order.updated_at = new Date().toISOString();
  saveOrderToFs(order);
  if (useRemoteStore()) {
    await saveOrderToRemote(order);
  }
  return order;
}

async function listAllOrdersAsync() {
  if (useRemoteStore()) {
    try {
      const remote = await listOrdersFromRemote();
      if (remote.length) return remote;
    } catch (err) {
      logError('Liste commandes matériel Supabase', { error: err.message });
    }
  }
  return listOrdersFromFs();
}

module.exports = {
  ORDERS_DIR,
  useRemoteStore,
  loadOrder,
  loadOrderAsync,
  saveOrder,
  saveOrderAsync,
  listAllOrdersAsync,
};
