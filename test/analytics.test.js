'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  summarizeFromRows,
  isBotUa,
  isSkippedPath,
  normalizeVid,
  normalizePath,
} = require('../storefront/lib/analytics');

test('visites 30 j = visiteurs uniques, pas les pageviews bruts', () => {
  const now = new Date().toISOString();
  const stats = summarizeFromRows(
    [
      { type: 'pageview', path: '/', vid: 'aaaaaaaa', at: now },
      { type: 'pageview', path: '/abonnements', vid: 'aaaaaaaa', at: now },
      { type: 'pageview', path: '/', vid: 'bbbbbbbb', at: now },
      { type: 'event', path: '/', vid: 'cccccccc', name: 'click', at: now },
    ],
    30
  );
  assert.equal(stats.unique_visitors, 2);
  assert.equal(stats.total, 2);
  assert.equal(stats.pageviews, 3);
  assert.equal(stats.top_pages[0].path, '/');
  assert.equal(stats.top_pages[0].count, 2);
});

test('ignore les visites trop anciennes', () => {
  const stats = summarizeFromRows(
    [{ type: 'pageview', path: '/', vid: 'aaaaaaaa', at: '2020-01-01T00:00:00.000Z' }],
    30
  );
  assert.equal(stats.total, 0);
  assert.equal(stats.pageviews, 0);
});

test('filtre bots, admin et vid invalide', () => {
  assert.equal(isBotUa('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  assert.equal(isBotUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), false);
  assert.equal(isSkippedPath('/admin/stats'), true);
  assert.equal(isSkippedPath('/abonnements'), false);
  assert.equal(normalizeVid('vid-ok_01'), 'vid-ok_01');
  assert.equal(normalizeVid('<script>'), '');
  assert.equal(normalizePath('abonnements'), '/abonnements');
});

test('admin stats affiche les visiteurs uniques', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'public', 'js', 'admin.js'), 'utf8');
  assert.match(js, /unique_visitors/);
  const analytics = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'lib', 'analytics.js'),
    'utf8'
  );
  assert.match(analytics, /boxplus_pageviews/);
  assert.match(analytics, /useRemoteAnalytics/);
});
