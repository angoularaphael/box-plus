'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { logError } = require('../../lib/logger');
const { getSupabase } = require('./supabase');
const { getDevSession } = require('./dev-session');

const CONFIG_KEY = 'payment_display';
const DEFAULTS = { payplug: true, paypal: true, cawl: true };
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
  const cawl = src.cawl !== false;
  if (!payplug && !paypal && !cawl) return { ...DEFAULTS };
  return { payplug, paypal, cawl };
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
  if (!next.payplug && !next.paypal && !next.cawl) {
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

const PORTET_PAUSED_MESSAGE =
  'Les paiements en ligne pour la salle de Portet sont momentanément indisponibles. Contactez le club ou passez à l’accueil.';

/** Visiteurs : Portet fermé tant que PORTET_PAYMENTS_PAUSED n’est pas à 0. Studio / localhost restent ouverts. */
function isPortetPaymentsPaused() {
  const raw = process.env.PORTET_PAYMENTS_PAUSED;
  if (raw == null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

/**
 * Ce que CE visiteur doit voir.
 * Session studio : tout ce qui est branché, même si décoché en prod.
 * Visiteur : cases cochées.
 * Portet + CAWL : CAWL pour la carte (1× / 1ʳᵉ échéance). Le 4× sans frais
 * reste sur PayPal Portet (Pay Later) — Oney CAWL n’est pas activé.
 * Portet sans CAWL : repli PayPal (CB via PayPal).
 * Portet en pause : aucun moyen affiché (sauf studio).
 */
function resolveDisplay({ stored, preview, gym, payplugReady, paypalReady, cawlReady, portetPaused }) {
  const flags = normalize(stored);
  const portet = isPortetGym(gym);
  const paused = portet && Boolean(portetPaused) && !preview;
  if (paused) {
    return {
      preview: false,
      show_payplug: false,
      show_paypal: false,
      show_cawl: false,
      portetPaypalOnly: false,
      portetViaPaypal: false,
      portetViaCawl: false,
      portetPaypal4x: false,
      portetPaused: true,
      portetPausedMessage: PORTET_PAUSED_MESSAGE,
    };
  }
  const cawlConfigured = portet && Boolean(cawlReady);
  const cawlOn = cawlConfigured && (preview || flags.cawl);
  const portetPaypal4x = portet && Boolean(paypalReady) && (preview || flags.paypal);
  if (preview) {
    const show_paypal = Boolean(paypalReady) && !cawlOn;
    return {
      preview: true,
      show_payplug: cawlOn ? false : Boolean(payplugReady),
      show_paypal,
      show_cawl: cawlOn,
      portetPaypalOnly: false,
      portetViaPaypal: portet && show_paypal && !cawlOn,
      portetViaCawl: cawlOn,
      portetPaypal4x,
      portetPaused: false,
      portetPausedMessage: null,
    };
  }
  const show_cawl = cawlOn;
  const show_payplug = cawlOn ? false : Boolean(payplugReady) && flags.payplug;
  const show_paypal = cawlOn ? false : Boolean(paypalReady) && flags.paypal;
  return {
    preview: false,
    show_payplug,
    show_paypal,
    show_cawl,
    portetPaypalOnly: false,
    portetViaPaypal: portet && show_paypal && !cawlOn,
    portetViaCawl: cawlOn,
    portetPaypal4x,
    portetPaused: false,
    portetPausedMessage: null,
  };
}

function isLocalPreviewHost(req) {
  const host = String(req?.headers?.host || req?.get?.('host') || '')
    .split(':')[0]
    .toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

async function resolvePaymentDisplay(req, gym, { payplugReady, paypalReady, cawlReady }) {
  const stored = await getPaymentDisplay();
  return resolveDisplay({
    stored,
    preview: Boolean(getDevSession(req)) || isLocalPreviewHost(req),
    gym,
    payplugReady,
    paypalReady,
    cawlReady,
    portetPaused: isPortetPaymentsPaused(),
  });
}

module.exports = {
  DEFAULTS,
  PORTET_PAUSED_MESSAGE,
  getPaymentDisplay,
  setPaymentDisplay,
  resolveDisplay,
  resolvePaymentDisplay,
  isPortetGym,
  isPortetPaymentsPaused,
};
