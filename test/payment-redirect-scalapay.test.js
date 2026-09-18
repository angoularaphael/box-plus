/**
 * Page intermédiaire PayPlug / Scalapay — URL whitelist + wrap.
 */
'use strict';

const assert = require('assert');
const {
  isAllowedPayplugPaymentUrl,
  isPayplugTestPaymentUrl,
  buildPaymentRedirectUrl,
} = require('../storefront/lib/payment-redirect');

function run() {
  assert.equal(
    isAllowedPayplugPaymentUrl('https://secure.payplug.com/pay/4fKBE8jhnXEW3VVO4Eftat'),
    true
  );
  assert.equal(
    isAllowedPayplugPaymentUrl('https://secure.payplug.com/pay/test/abc123XYZ'),
    true
  );
  assert.equal(isAllowedPayplugPaymentUrl('https://evil.com/pay/abc'), false);
  assert.equal(isAllowedPayplugPaymentUrl('http://secure.payplug.com/pay/abc'), false);
  assert.equal(isAllowedPayplugPaymentUrl('https://secure.payplug.com/other/abc'), false);
  assert.equal(isAllowedPayplugPaymentUrl('javascript:alert(1)'), false);

  assert.equal(isPayplugTestPaymentUrl('https://secure.payplug.com/pay/test/abc'), true);
  assert.equal(isPayplugTestPaymentUrl('https://secure.payplug.com/pay/abc'), false);

  const wrapped = buildPaymentRedirectUrl(
    'https://boutique.boxingcenter.fr',
    'https://secure.payplug.com/pay/4fKBE8jhnXEW3VVO4Eftat',
    { kind: 'scalapay', cancelUrl: 'https://boutique.boxingcenter.fr/inscription?cancelled=1' }
  );
  assert.match(wrapped, /^https:\/\/boutique\.boxingcenter\.fr\/paiement-redirect\.html\?/);
  const q = new URL(wrapped).searchParams;
  assert.equal(q.get('u'), 'https://secure.payplug.com/pay/4fKBE8jhnXEW3VVO4Eftat');
  assert.equal(q.get('k'), 'scalapay');
  assert.match(q.get('c') || '', /cancelled=1/);

  assert.equal(
    buildPaymentRedirectUrl('https://boutique.boxingcenter.fr', 'https://evil.com/pay/x'),
    'https://evil.com/pay/x',
    'URL non whitelistée non wrappée'
  );

  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(
    path.join(__dirname, '../storefront/public/paiement-redirect.html'),
    'utf8'
  );
  assert.match(html, /secure\.payplug\.com/);
  assert.match(html, /portal\.scalapay\.com/);
  assert.match(html, /form\.submit/);
  assert.match(html, /Continuer le paiement/);

  const serverSrc = fs.readFileSync(path.join(__dirname, '../storefront/server.js'), 'utf8');
  assert.match(serverSrc, /buildPaymentRedirectUrl/);
  assert.match(serverSrc, /kind:\s*'scalapay'/);

  const payplugSrc = fs.readFileSync(path.join(__dirname, '../storefront/lib/payplug.js'), 'utf8');
  assert.match(payplugSrc, /sanitizePayplugEmail/);
  assert.match(payplugSrc, /company_name:\s*'Boxing Center'/);

  console.log('ok — payment-redirect Scalapay');
}

run();
