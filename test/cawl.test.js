'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  merchantReference,
  buildSignatureSubject,
  hmacSignature,
  authorizationHeader,
  isCawlPaid,
  isCawlCancelled,
  cawlPaidCents,
  cawlMerchantReference,
  cawlPaymentId,
  isCawlEnabled,
  cawlMode,
  formatCawlError,
  buildCawlReturnUrl,
  CAWL_RETURN_URL_MAX_LEN,
} = require('../storefront/lib/cawl');
const { resolveDisplay } = require('../storefront/lib/payment-display');
const { cawlMatches, rememberPreviousCawlId, cawlIdCandidates } = require('../storefront/lib/payment-bind');

test('CAWL merchantReference reste alphanumérique ≤ 30', () => {
  assert.equal(merchantReference('BC-1770000000000-abc123'), 'BC-1770000000000-abc123');
  assert.ok(merchantReference('BC-' + 'x'.repeat(80)).length <= 30);
  assert.match(merchantReference('hello world!'), /^helloworld/);
});

test('CAWL HMAC v1 : sujet et Authorization', () => {
  const date = 'Tue, 25 Aug 2026 10:00:00 GMT';
  const subject = buildSignatureSubject(
    'POST',
    'application/json',
    date,
    '/v2/CA131066056934/hostedcheckouts'
  );
  assert.equal(
    subject,
    'POST\napplication/json\nTue, 25 Aug 2026 10:00:00 GMT\n/v2/CA131066056934/hostedcheckouts\n'
  );
  const sig = hmacSignature('test-secret', subject);
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 20);
  const auth = authorizationHeader(
    'POST',
    'application/json',
    date,
    '/v2/CA131066056934/hostedcheckouts',
    'KEYID',
    'test-secret'
  );
  assert.equal(auth, `GCS v1HMAC:KEYID:${sig}`);
});

test('CAWL GET signature : Content-Type vide', () => {
  const subject = buildSignatureSubject('GET', '', 'Tue, 25 Aug 2026 10:00:00 GMT', '/v2/M/hostedcheckouts/abc');
  assert.equal(subject, 'GET\n\nTue, 25 Aug 2026 10:00:00 GMT\n/v2/M/hostedcheckouts/abc\n');
});

test('isCawlPaid / cancelled / cents', () => {
  const paid = {
    status: 'PAYMENT_CREATED',
    createdPaymentOutput: {
      paymentStatusCategory: 'SUCCESSFUL',
      payment: {
        id: 'pay-1',
        status: 'CAPTURED',
        statusOutput: { statusCode: 9 },
        paymentOutput: {
          amountOfMoney: { amount: 25900, currencyCode: 'EUR' },
          references: { merchantReference: 'BC-1' },
        },
      },
    },
  };
  assert.equal(isCawlPaid(paid), true);
  assert.equal(cawlPaidCents(paid), 25900);
  assert.equal(cawlMerchantReference(paid), 'BC-1');
  assert.equal(cawlPaymentId(paid), 'pay-1');
  assert.equal(isCawlCancelled({ status: 'CANCELLED_BY_CONSUMER' }), true);
  assert.equal(isCawlPaid({ status: 'IN_PROGRESS' }), false);
});

test('cawlMatches lie session et commande', () => {
  const session = {
    createdPaymentOutput: {
      paymentStatusCategory: 'SUCCESSFUL',
      payment: {
        id: 'pay-1',
        status: 'CAPTURED',
        statusOutput: { statusCode: 9 },
        paymentOutput: {
          amountOfMoney: { amount: 25900 },
          references: { merchantReference: 'BC-99' },
        },
      },
    },
  };
  assert.equal(cawlMatches({ session, orderId: 'BC-99', expectedCents: 25900, storedCheckoutId: 'hc-1' }).ok, true);
  assert.equal(cawlMatches({ session, orderId: 'BC-OTHER', expectedCents: 25900, storedCheckoutId: '' }).ok, false);
});

test('historique hostedCheckoutId CAWL', () => {
  const hist = rememberPreviousCawlId({ cawl_hosted_checkout_id: 'old' }, 'new');
  assert.deepEqual(hist, ['old']);
  const ids = cawlIdCandidates({ payment: { cawl_hosted_checkout_id: 'new', cawl_hosted_checkout_ids: ['old'] } }, 'extra');
  assert.deepEqual(ids, ['extra', 'new', 'old']);
});

test('Portet + CAWL masque PayPal / PayPlug', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: true },
    preview: false,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
    cawlReady: true,
  });
  assert.equal(vis.portetViaCawl, true);
  assert.equal(vis.portetViaPaypal, false);
  assert.equal(vis.show_cawl, true);
  assert.equal(vis.show_paypal, false);
  assert.equal(vis.show_payplug, false);
});

test('Portet sans CAWL reste sur PayPal', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: true },
    preview: false,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
    cawlReady: false,
  });
  assert.equal(vis.portetViaCawl, false);
  assert.equal(vis.portetViaPaypal, true);
  assert.equal(vis.show_paypal, true);
});

test('Portet en pause masque tous les paiements (sauf studio)', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: true },
    preview: false,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
    cawlReady: true,
    portetPaused: true,
  });
  assert.equal(vis.portetPaused, true);
  assert.equal(vis.show_cawl, false);
  assert.equal(vis.show_paypal, false);
  assert.equal(vis.show_payplug, false);
  assert.equal(vis.portetViaCawl, false);

  const studio = resolveDisplay({
    stored: { payplug: true, paypal: true },
    preview: true,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
    cawlReady: true,
    portetPaused: true,
  });
  assert.equal(studio.portetPaused, false);
  assert.equal(studio.show_cawl, true);
  assert.equal(studio.preview, true);
});

test('Minimes ignore CAWL même si clés présentes', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: true },
    preview: false,
    gym: 'minimes',
    payplugReady: true,
    paypalReady: true,
    cawlReady: true,
  });
  assert.equal(vis.portetViaCawl, false);
  assert.equal(vis.show_cawl, false);
  assert.equal(vis.show_payplug, true);
  assert.equal(vis.show_paypal, true);
});

test('Portet + CAWL décoché repasse PayPal / PayPlug', () => {
  const vis = resolveDisplay({
    stored: { payplug: true, paypal: true, cawl: false },
    preview: false,
    gym: 'portet',
    payplugReady: true,
    paypalReady: true,
    cawlReady: true,
  });
  assert.equal(vis.portetViaCawl, false);
  assert.equal(vis.show_cawl, false);
  assert.equal(vis.show_paypal, true);
  assert.equal(vis.show_payplug, true);
});

test('sans clés, CAWL est off', () => {
  const prev = {
    id: process.env.CAWL_MERCHANT_ID,
    key: process.env.CAWL_API_KEY_ID,
    secret: process.env.CAWL_API_SECRET,
  };
  delete process.env.CAWL_MERCHANT_ID;
  delete process.env.CAWL_API_KEY_ID;
  delete process.env.CAWL_API_SECRET;
  try {
    assert.equal(isCawlEnabled(), false);
  } finally {
    if (prev.id == null) delete process.env.CAWL_MERCHANT_ID;
    else process.env.CAWL_MERCHANT_ID = prev.id;
    if (prev.key == null) delete process.env.CAWL_API_KEY_ID;
    else process.env.CAWL_API_KEY_ID = prev.key;
    if (prev.secret == null) delete process.env.CAWL_API_SECRET;
    else process.env.CAWL_API_SECRET = prev.secret;
  }
});

test('formatCawlError explique ACCESS_TO_MERCHANT_NOT_ALLOWED', () => {
  const err = new Error('ACCESS_TO_MERCHANT_NOT_ALLOWED');
  err.status = 403;
  err.body = {
    errors: [{ code: '9007', id: 'ACCESS_TO_MERCHANT_NOT_ALLOWED', httpStatusCode: 403 }],
  };
  const msg = formatCawlError(err);
  assert.match(msg, /CAWL live refuse|portail CAWL/i);
  assert.doesNotMatch(msg, /^ACCESS_TO_MERCHANT_NOT_ALLOWED$/);
});

test('formatCawlError explique le 1008 sans jargon HTTP', () => {
  const err = new Error('CAWL HTTP 400');
  err.status = 400;
  err.body = {
    errors: [{ code: '1008', id: 'INVALID_VALUE', propertyName: 'order.amountOfMoney' }],
  };
  assert.match(formatCawlError(err), /order\.amountOfMoney|configuration du compte test|1008/i);
  assert.doesNotMatch(formatCawlError(err), /^CAWL HTTP 400 — 1008$/);

  const returnErr = new Error('CAWL HTTP 400');
  returnErr.status = 400;
  returnErr.body = {
    errors: [{ code: '1008', id: 'INVALID_VALUE', propertyName: 'hostedCheckoutSpecificInput.returnUrl' }],
  };
  assert.match(formatCawlError(returnErr), /URL de retour CAWL/i);
});

test('buildCawlReturnUrl reste sous la limite CAWL (pas de bc_token dupliqué)', () => {
  const token = 'a'.repeat(48);
  const orderId = `BC-${Date.now()}`;
  const url = buildCawlReturnUrl({
    baseUrl: 'https://boutique.boxingcenter.fr',
    orderId,
    accessToken: token,
    step: 4,
  });
  assert.ok(url.length <= CAWL_RETURN_URL_MAX_LEN);
  assert.match(url, /cawl_return=1/);
  assert.doesNotMatch(url, /bc_token=/);
  assert.doesNotMatch(url, /token=.*token=/);
});

test('buildCawlReturnUrl bascule sans token si URL encore trop longue', () => {
  const longOrder = `BC-${'x'.repeat(80)}`;
  const url = buildCawlReturnUrl({
    baseUrl: 'https://boutique.boxingcenter.fr',
    orderId: longOrder,
    accessToken: 'b'.repeat(48),
    step: 4,
  });
  assert.ok(url.length <= CAWL_RETURN_URL_MAX_LEN);
  assert.match(url, /order=/);
  assert.doesNotMatch(url, /token=/);
});

test('studio sans CAWL_TEST_* ne mélange pas le PSPID live avec preprod', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { runPaymentContext, paymentVar, resetTestFileCache } = require('../storefront/lib/test-env');
  const empty = path.join(os.tmpdir(), `cawl-empty-${Date.now()}.env`);
  fs.writeFileSync(empty, '');
  const prev = {
    file: process.env.BOXPLUS_TEST_ENV_FILE,
    id: process.env.CAWL_MERCHANT_ID,
    key: process.env.CAWL_API_KEY_ID,
    secret: process.env.CAWL_API_SECRET,
    tid: process.env.CAWL_TEST_MERCHANT_ID,
    tkey: process.env.CAWL_TEST_API_KEY_ID,
    tsec: process.env.CAWL_TEST_API_SECRET,
  };
  process.env.BOXPLUS_TEST_ENV_FILE = empty;
  process.env.CAWL_MERCHANT_ID = 'CA131066056934';
  process.env.CAWL_API_KEY_ID = 'LIVEKEY';
  process.env.CAWL_API_SECRET = 'LIVESECRET';
  process.env.CAWL_TEST_MERCHANT_ID = '';
  process.env.CAWL_TEST_API_KEY_ID = '';
  process.env.CAWL_TEST_API_SECRET = '';
  resetTestFileCache();
  try {
    runPaymentContext({ test: true }, () => {
      assert.equal(paymentVar('CAWL_MERCHANT_ID'), '');
      assert.equal(isCawlEnabled(), false);
      assert.equal(cawlMode(), 'live');
    });
  } finally {
    if (prev.file == null) delete process.env.BOXPLUS_TEST_ENV_FILE;
    else process.env.BOXPLUS_TEST_ENV_FILE = prev.file;
    if (prev.id == null) delete process.env.CAWL_MERCHANT_ID;
    else process.env.CAWL_MERCHANT_ID = prev.id;
    if (prev.key == null) delete process.env.CAWL_API_KEY_ID;
    else process.env.CAWL_API_KEY_ID = prev.key;
    if (prev.secret == null) delete process.env.CAWL_API_SECRET;
    else process.env.CAWL_API_SECRET = prev.secret;
    if (prev.tid == null) delete process.env.CAWL_TEST_MERCHANT_ID;
    else process.env.CAWL_TEST_MERCHANT_ID = prev.tid;
    if (prev.tkey == null) delete process.env.CAWL_TEST_API_KEY_ID;
    else process.env.CAWL_TEST_API_KEY_ID = prev.tkey;
    if (prev.tsec == null) delete process.env.CAWL_TEST_API_SECRET;
    else process.env.CAWL_TEST_API_SECRET = prev.tsec;
    resetTestFileCache();
    try {
      fs.unlinkSync(empty);
    } catch {
      /* ignore */
    }
  }
});

test('inscription 4× Portet envoie CAWL, pas PayPlug', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'public', 'js', 'inscription.js'), 'utf8');
  assert.match(js, /cardValue: portetViaCawl \? 'cawl' : 'payplug'/);
  assert.match(js, /portetViaCawl && card4x \? 'cawl'/);
});
