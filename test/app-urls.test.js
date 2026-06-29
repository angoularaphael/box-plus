const test = require('node:test');
const assert = require('node:assert/strict');

test('app-urls — prod Vercel par défaut si STORE_URL absent', () => {
  delete process.env.STORE_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_URL;
  const { getStoreUrl, PRODUCTION_STORE_URL } = require('../lib/app-urls');
  assert.equal(getStoreUrl(), 'http://localhost:3040');
  assert.equal(PRODUCTION_STORE_URL, 'https://box-plus.vercel.app');
});

test('app-urls — VERCEL_URL auto', () => {
  process.env.VERCEL = '1';
  process.env.VERCEL_URL = 'box-plus.vercel.app';
  delete process.env.STORE_URL;
  delete require.cache[require.resolve('../lib/app-urls')];
  const { getStoreUrl } = require('../lib/app-urls');
  assert.equal(getStoreUrl(), 'https://box-plus.vercel.app');
  delete process.env.VERCEL;
  delete process.env.VERCEL_URL;
});

test('app-urls — ingest catalogue', () => {
  process.env.STORE_URL = 'https://box-plus.vercel.app';
  delete require.cache[require.resolve('../lib/app-urls')];
  const { getCatalogIngestUrl } = require('../lib/app-urls');
  assert.equal(getCatalogIngestUrl(), 'https://box-plus.vercel.app/api/admin/ingest-catalog');
  delete process.env.STORE_URL;
});

test('app-urls — checkout base URL suit localhost en dev', () => {
  process.env.STORE_URL = 'https://box-plus.vercel.app';
  delete require.cache[require.resolve('../lib/app-urls')];
  const { getCheckoutBaseUrl } = require('../lib/app-urls');
  const req = { get: (h) => (h === 'host' ? 'localhost:3040' : 'http'), protocol: 'http' };
  assert.equal(getCheckoutBaseUrl(req), 'http://localhost:3040');
  delete process.env.STORE_URL;
});
