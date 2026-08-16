'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  isDemoCheckoutAllowed,
  secretsEqual,
  hmacEqual,
  sanitizeOrderId,
  sanitizePaymentId,
  maskIban,
  redactOrderForClient,
  looksLikeAllowedImage,
  sessionSecret,
  requestAccessToken,
} = require('../storefront/lib/security');

const {
  amountsMatch,
  expectedChargeCents,
  payplugMatches,
  rememberPreviousPayplugId,
  paypalMatches,
  paypalPaidCents,
  verifyPayplugSignature,
} = require('../storefront/lib/payment-bind');

test('demo checkout refusé sans flag', () => {
  const prev = process.env.STORE_DEMO_ENABLED;
  const prevNode = process.env.NODE_ENV;
  delete process.env.STORE_DEMO_ENABLED;
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(isDemoCheckoutAllowed(), false);
    process.env.STORE_DEMO_ENABLED = 'true';
    assert.equal(isDemoCheckoutAllowed(), true);
    process.env.NODE_ENV = 'production';
    assert.equal(isDemoCheckoutAllowed(), false);
  } finally {
    if (prev == null) delete process.env.STORE_DEMO_ENABLED;
    else process.env.STORE_DEMO_ENABLED = prev;
    if (prevNode == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

test('sanitizeOrderId bloque la traversée de chemin', () => {
  assert.equal(sanitizeOrderId('BC-123-abc'), 'BC-123-abc');
  assert.equal(sanitizeOrderId('../etc/passwd'), null);
  assert.equal(sanitizeOrderId('MAT-1/../../x'), null);
  assert.equal(sanitizeOrderId('rl-change-abcdef'), 'rl-change-abcdef');
});

test('sanitizePaymentId accepte les ids PSP, refuse les chemins', () => {
  assert.ok(sanitizePaymentId('pay_live_abcDEF123'));
  assert.ok(sanitizePaymentId('cs_test_a'.padEnd(40, 'x')));
  assert.equal(sanitizePaymentId('../pay'), null);
  assert.equal(sanitizePaymentId('pay/../../x'), null);
});

test('maskIban et redactOrderForClient', () => {
  const masked = maskIban('FR7630001007941234567890185');
  assert.match(masked, /^FR76/);
  assert.ok(masked.includes('••••'));
  assert.ok(!masked.includes('1234567890185'));

  const safe = redactOrderForClient({
    order_id: 'BC-1',
    access_token: 'secret-token-value',
    payment: { status: 'paid', iban: 'FR7630001007941234567890185' },
    customer_full: { first_name: 'Jean', iban: 'FR7630001007941234567890185' },
    documents: { photo_base64: 'data:image/jpeg;base64,AAAA' },
  });
  assert.equal(safe.access_token, undefined);
  assert.equal(safe.payment.iban, undefined);
  assert.equal(safe.payment.has_iban, true);
  assert.equal(safe.documents.photo_base64, true);
});

test('PayPlug refuse un paiement lié à une autre commande', () => {
  const payment = {
    id: 'pay_cheap',
    amount: 1000,
    metadata: { lifecycle_order_id: 'BC-CHEAP', order_id: 'BC-CHEAP' },
  };
  const miss = payplugMatches({
    payment,
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaymentId: 'pay_expensive',
  });
  assert.equal(miss.ok, false);
  assert.equal(miss.error, 'payment_mismatch');

  const ok = payplugMatches({
    payment: { ...payment, amount: 25900, metadata: { lifecycle_order_id: 'BC-EXPENSIVE' }, id: 'pay_ok' },
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaymentId: 'pay_ok',
  });
  assert.equal(ok.ok, true);

  const storedWins = payplugMatches({
    payment: {
      id: 'pay_ok',
      amount: 25900,
      metadata: { lifecycle_order_id: 'BC-OTHER', order_id: 'BC-OTHER' },
    },
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaymentId: 'pay_ok',
  });
  assert.equal(storedWins.ok, true);

  // Double page hébergée : pay_A encaissé, la commande stocke pay_B.
  const rebound = payplugMatches({
    payment: {
      id: 'pay_A',
      amount: 25900,
      metadata: { lifecycle_order_id: 'BC-X', order_id: 'BC-X' },
    },
    orderId: 'BC-X',
    expectedCents: 25900,
    storedPaymentId: 'pay_B',
  });
  assert.equal(rebound.ok, true);

  const wrongAmountStored = payplugMatches({
    payment: { id: 'pay_ok', amount: 1000, metadata: { lifecycle_order_id: 'BC-EXPENSIVE' } },
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaymentId: 'pay_ok',
  });
  assert.equal(wrongAmountStored.ok, false);
  assert.equal(wrongAmountStored.error, 'amount_mismatch');
});

test('PayPlug conserve l’id précédent en cas de 2ᵉ page hébergée', () => {
  const hist = rememberPreviousPayplugId({ payplug_payment_id: 'pay_A' }, 'pay_B');
  assert.deepEqual(hist, ['pay_A']);
  const again = rememberPreviousPayplugId(
    { payplug_payment_id: 'pay_B', payplug_payment_ids: ['pay_A'] },
    'pay_C'
  );
  assert.deepEqual(again, ['pay_A', 'pay_B']);
});

test('PayPal refuse un custom_id / montant différent', () => {
  const captured = {
    id: 'PP-CHEAP',
    status: 'COMPLETED',
    purchase_units: [
      {
        custom_id: 'BC-CHEAP',
        amount: { value: '10.00', currency_code: 'EUR' },
        payments: { captures: [{ amount: { value: '10.00' }, status: 'COMPLETED' }] },
      },
    ],
  };
  const miss = paypalMatches({
    captured,
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaypalId: 'PP-EXPENSIVE',
  });
  assert.equal(miss.ok, false);

  const ok = paypalMatches({
    captured: {
      id: 'PP-OK',
      purchase_units: [
        {
          custom_id: 'BC-EXPENSIVE',
          amount: { value: '259.00' },
          payments: { captures: [{ amount: { value: '259.00' }, status: 'COMPLETED' }] },
        },
      ],
    },
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaypalId: 'PP-OK',
  });
  assert.equal(ok.ok, true);
  assert.equal(paypalPaidCents(captured), 1000);

  const storedWins = paypalMatches({
    captured: {
      id: 'PP-OK',
      purchase_units: [
        {
          custom_id: 'BC-OTHER',
          amount: { value: '259.00' },
          payments: { captures: [{ amount: { value: '259.00' }, status: 'COMPLETED' }] },
        },
      ],
    },
    orderId: 'BC-EXPENSIVE',
    expectedCents: 25900,
    storedPaypalId: 'PP-OK',
  });
  assert.equal(storedWins.ok, true);
});

test('4× accepte le montant plein ou le quart', () => {
  const expected = expectedChargeCents(
    { payment: { payment_plan: '4x' } },
    { price_cents: 25900 }
  );
  assert.deepEqual(expected, [25900, 6475]);
  assert.equal(amountsMatch(25900, 25900), true);
});

test('signature PayPlug JWT HS256', () => {
  const secret = 'sk_test_abc';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ id: 'pay_1' })).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  assert.equal(verifyPayplugSignature('{}', `${data}.${sig}`, secret), true);
  assert.equal(verifyPayplugSignature('{}', `${data}.aaaa`, secret), false);
  assert.equal(verifyPayplugSignature('{}', '', secret), false);
});

test('looksLikeAllowedImage JPEG', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(looksLikeAllowedImage(jpeg, 'image/jpeg'), true);
  assert.equal(looksLikeAllowedImage(Buffer.from('<svg></svg>'), 'image/jpeg'), false);
});

test('secretsEqual ne matche pas un secret vide', () => {
  assert.equal(secretsEqual('x', ''), false);
  assert.equal(secretsEqual('abc', 'abc'), true);
  assert.equal(secretsEqual('abc', 'abd'), false);
});

test('hmacEqual longueurs différentes', () => {
  assert.equal(hmacEqual('aa', 'bb'), false);
  assert.equal(hmacEqual('same', 'same'), true);
});

test('sessionSecret refuse change-me en production', () => {
  const prev = {
    node: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    sess: process.env.SESSION_SECRET,
    site: process.env.SITE_API_SECRET,
    admin: process.env.ADMIN_SECRET,
  };
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  process.env.SESSION_SECRET = 'change-me';
  delete process.env.SITE_API_SECRET;
  delete process.env.ADMIN_SECRET;
  try {
    assert.equal(sessionSecret(), '');
  } finally {
    if (prev.node == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev.node;
    if (prev.vercel == null) delete process.env.VERCEL;
    else process.env.VERCEL = prev.vercel;
    if (prev.sess == null) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prev.sess;
    if (prev.site == null) delete process.env.SITE_API_SECRET;
    else process.env.SITE_API_SECRET = prev.site;
    if (prev.admin == null) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev.admin;
  }
});

test('requestAccessToken préfère bc_token / hex 48 face au token PayPal', () => {
  const hex = 'a'.repeat(48);
  const paypalId = '5O190127TN364715T';
  const picked = requestAccessToken({
    query: { token: paypalId, bc_token: hex },
    body: {},
  });
  assert.equal(picked, hex);
  assert.equal(
    requestAccessToken({ query: { token: paypalId }, body: { token: hex } }),
    hex
  );
});
