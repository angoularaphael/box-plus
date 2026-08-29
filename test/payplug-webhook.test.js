'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

process.env.STORE_DEMO_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.PAYPLUG_SECRET_KEY = 'sk_live_dummy_not_a_real_key_123456';
process.env.PAYPLUG_TEST_SECRET_KEY = '';
process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-pp-wh-insc-${Date.now()}`);
process.env.BOXPLUS_MATERIEL_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-pp-wh-mat-${Date.now()}`);
process.env.BOXPLUS_ORDERS_REMOTE = '0';
const emptyTestEnv = path.join(os.tmpdir(), `boxplus-pp-wh-env-${Date.now()}`);
fs.writeFileSync(emptyTestEnv, '');
process.env.BOXPLUS_TEST_ENV_FILE = emptyTestEnv;
require('../storefront/lib/test-env').resetTestFileCache();

const { createApp } = require('../storefront/server');

test('IPN PayPlug test inconnu : 200 received, jamais HTTP 500', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/payplug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'pay_jDCA38fVTZssMFgYe0eQF' }),
  });
  const data = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.notEqual(res.status, 500);
  assert.equal(data.ok, true);
  assert.ok(data.received || data.ignored || data.materiel);
});
