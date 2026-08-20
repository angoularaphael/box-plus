'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { logError } = require('../../lib/logger');
const { getSupabase } = require('./supabase');
const { getDevSession } = require('./dev-session');

const CONFIG_KEY = 'payment_display';
const DEFAULTS = { payplug: true, paypal: true };
const FILE =
  process.env.BOXPLUS_PAYMENT_DISPLAY_FILE ||
  (process.env.VERCEL
    ? '/tmp/boxplus-payment-display.json'
    : path.join(ROOT, 'data', 'storefront', 'payment-display.json'));

let cache = { at: 0, value: null };
const CACHE_MS = 4000;

function useRemoteStore() {
  return Boolean(
    (process.env.VERCEL || process.env.BOXPLUS_MERCH_REMOTE === '1') &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const payplug = src.payplug !== false;
  const paypal = src.paypal !== false;
  if (!payplug && !paypal) return { ...DEFAULTS };
  return { payplug, paypal };
}

function readFile() {
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return { ...DEFAULTS };
  }
}

function writeFile(value) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(value, null, 2), 'utf8');
}

async function loadFromRemote() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_store_config')
    .select('payload')
    .eq('key', CONFIG_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.payload ? normalize(data.payload) : null;
}

async function saveToRemote(payload) {
  const sb = getSupabase();
  const { error } = await sb.from('boxplus_store_config').upsert(
    {
      key: CONFIG_KEY,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) throw error;
}

async function getPaymentDisplay() {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;

  if (useRemoteStore()) {
    try {
      const remote = await loadFromRemote();
      if (remote) {
        cache = { at: now, value: remote };
        try {
          writeFile(remote);
        } catch {
          /* tmp may be read-only */
        }
        return remote;
      }
    } catch (err) {
      logError('Chargement affichage paiements', { error: err.message });
    }
  }

  const local = readFile();
  cache = { at: now, value: local };
  return local;
}

async function setPaymentDisplay(input) {
  const next = normalize(input);
  if (!next.payplug && !next.paypal) {
    const err = new Error('Au moins un moyen de paiement doit rester affiché.');
    err.code = 'need_one';
    throw err;
  }
  writeFile(next);
  cache = { at: Date.now(), value: next };
  if (useRemoteStore()) {
    try {
      await saveToRemote(next);
    } catch (err) {
      logError('Sauvegarde affichage paiements', { error: err.message });
    }
  }
  return next;
}

function isPortetGym(gym) {
  return String(gym || '').trim().toLowerCase() === 'portet';
}

/**
 * Ce que CE visiteur doit voir.
 * Session studio : tout ce qui est branché, même si décoché en prod.
 * Visiteur : cases cochées. À Portet, la CB passe aussi par PayPal
 * (PayPal accepte la carte) : les deux tuiles restent visibles.
 */
function resolveDisplay({ stored, preview, gym, payplugReady, paypalReady }) {
  const flags = normalize(stored);
  if (preview) {
    const show_paypal = Boolean(paypalReady);
    return {
      preview: true,
      show_payplug: Boolean(payplugReady),
      show_paypal,
      portetPaypalOnly: false,
      portetViaPaypal: isPortetGym(gym) && show_paypal,
    };
  }
  const show_payplug = Boolean(payplugReady) && flags.payplug;
  const show_paypal = Boolean(paypalReady) && flags.paypal;
  return {
    preview: false,
    show_payplug,
    show_paypal,
    portetPaypalOnly: false,
    portetViaPaypal: isPortetGym(gym) && show_paypal,
  };
}

function isLocalPreviewHost(req) {
  const host = String(req?.headers?.host || req?.get?.('host') || '')
    .split(':')[0]
    .toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

async function resolvePaymentDisplay(req, gym, { payplugReady, paypalReady }) {
  const stored = await getPaymentDisplay();
  return resolveDisplay({
    stored,
    preview: Boolean(getDevSession(req)) || isLocalPreviewHost(req),
    gym,
    payplugReady,
    paypalReady,
  });
}

module.exports = {
  DEFAULTS,
  getPaymentDisplay,
  setPaymentDisplay,
  resolveDisplay,
  resolvePaymentDisplay,
  isPortetGym,
};
