'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classifyVisitSrc, summarizeVisitRows } = require('../storefront/lib/seance-offerte-visits');

test('src=email est une source distincte du flyer', () => {
  assert.equal(classifyVisitSrc('email'), 'email');
  assert.equal(classifyVisitSrc('flyer'), 'flyer');
  assert.equal(classifyVisitSrc('direct'), 'other');
});

test('le backoffice compte les visites e-mail à part', () => {
  const summary = summarizeVisitRows([
    { src: 'email', created_at: '2026-09-14T10:00:00.000Z' },
    { src: 'email', created_at: '2026-09-14T11:00:00.000Z' },
    { src: 'flyer', created_at: '2026-09-14T12:00:00.000Z' },
    { src: 'direct', created_at: '2026-09-14T13:00:00.000Z' },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.email, 2);
  assert.equal(summary.flyer, 1);
  assert.equal(summary.other, 1);
  assert.equal(summary.days[0].email, 2);
  assert.deepEqual(summary.other_sources, [{ name: 'Accès direct', count: 1 }]);
});

test('l’admin affiche le compteur e-mail et le lien ?src=email', () => {
  const adminJs = fs.readFileSync(path.join(__dirname, '../storefront/public/js/admin.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../storefront/public/admin/index.html'), 'utf8');
  assert.match(adminJs, /e-mail David/);
  assert.match(adminJs, /d\.email/);
  assert.match(adminHtml, /\?src=email/);
  assert.match(adminHtml, /Bleu = total des visites/);
  assert.match(adminHtml, /Rouge = Flyer QR/);
  assert.match(adminHtml, /Vert = E-mail David/);
});
