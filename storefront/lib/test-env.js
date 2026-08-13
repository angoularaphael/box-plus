'use strict';

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { ROOT } = require('../../lib/utils');

const als = new AsyncLocalStorage();

const FILE_KEYS = [
  'PAYPAL_MODE',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_PORTET_CLIENT_ID',
  'PAYPAL_PORTET_CLIENT_SECRET',
  'PAYPLUG_SECRET_KEY',
];

const ENV_ALIAS = {
  PAYPAL_MODE: 'PAYPAL_TEST_MODE',
  PAYPAL_CLIENT_ID: 'PAYPAL_TEST_CLIENT_ID',
  PAYPAL_CLIENT_SECRET: 'PAYPAL_TEST_CLIENT_SECRET',
  PAYPAL_PORTET_CLIENT_ID: 'PAYPAL_TEST_PORTET_CLIENT_ID',
  PAYPAL_PORTET_CLIENT_SECRET: 'PAYPAL_TEST_PORTET_CLIENT_SECRET',
  PAYPLUG_SECRET_KEY: 'PAYPLUG_TEST_SECRET_KEY',
};

let fileCache = null;

function parseEnvFile(contents) {
  const out = {};
  for (const line of String(contents || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadTestFile() {
  if (fileCache) return fileCache;
  const candidates = [
    process.env.BOXPLUS_TEST_ENV_FILE,
    path.join(ROOT, 'env.test'),
    path.join(ROOT, '.env.test'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      fileCache = { path: file, vars: parseEnvFile(fs.readFileSync(file, 'utf8')) };
      return fileCache;
    } catch {
      /* next */
    }
  }
  fileCache = { path: null, vars: {} };
  return fileCache;
}

function getOverlay() {
  const file = loadTestFile();
  const overlay = {};
  let source = null;
  for (const key of FILE_KEYS) {
    const fromFile = file.vars[key];
    const fromEnv = process.env[ENV_ALIAS[key]];
    if (fromFile) {
      overlay[key] = fromFile;
      if (!source) source = 'env.test';
    } else if (fromEnv) {
      overlay[key] = fromEnv;
      if (!source) source = 'env';
    }
  }
  return { overlay, source, file: file.path };
}

function useTestPayments() {
  return Boolean(als.getStore()?.test);
}

function runPaymentContext({ test }, fn) {
  return als.run({ test: Boolean(test) }, fn);
}

function paymentVar(key) {
  if (useTestPayments()) {
    const { overlay } = getOverlay();
    if (overlay[key]) return overlay[key];
  }
  return process.env[key] || '';
}

function testPaymentsInfo() {
  const { overlay, source, file } = getOverlay();
  return {
    active: useTestPayments(),
    configured: Boolean(overlay.PAYPAL_CLIENT_ID || overlay.PAYPLUG_SECRET_KEY),
    source: useTestPayments() ? source : null,
    file: source === 'env.test' ? file : null,
    paypal_mode: overlay.PAYPAL_MODE || 'sandbox',
    has_paypal: Boolean(overlay.PAYPAL_CLIENT_ID && overlay.PAYPAL_CLIENT_SECRET),
    has_paypal_portet: Boolean(overlay.PAYPAL_PORTET_CLIENT_ID && overlay.PAYPAL_PORTET_CLIENT_SECRET),
    has_payplug: Boolean(overlay.PAYPLUG_SECRET_KEY),
  };
}

function resetTestFileCache() {
  fileCache = null;
}

module.exports = {
  runPaymentContext,
  useTestPayments,
  paymentVar,
  getOverlay,
  testPaymentsInfo,
  loadTestFile,
  resetTestFileCache,
  parseEnvFile,
};
