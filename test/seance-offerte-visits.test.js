'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  classifyVisitSrc,
  summarizeVisitRows,
  summarizeInscriptionRows,
  conversionPct,
} = require('../storefront/lib/seance-offerte-visits');

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

test('l’admin affiche clics vs inscriptions', () => {
  const adminJs = fs.readFileSync(path.join(__dirname, '../storefront/public/js/admin.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../storefront/public/admin/index.html'), 'utf8');
  assert.match(adminJs, /e-mail David/);
  assert.match(adminJs, /d\.email/);
  assert.match(adminJs, /fluxKpiClicks/);
  assert.match(adminJs, /inscriptions/);
  assert.match(adminHtml, /\?src=email/);
  assert.match(adminHtml, /Clics sur le lien/);
  assert.match(adminHtml, /Inscrits à la séance/);
  assert.match(adminHtml, /Bleu = total des visites/);
  assert.match(adminHtml, /Rouge = Flyer QR/);
  assert.match(adminHtml, /Vert = E-mail David/);
});

test('compte les inscriptions séance à part des clics', () => {
  const clicks = summarizeVisitRows([
    { src: 'email', created_at: '2026-09-14T10:00:00.000Z' },
    { src: 'email', created_at: '2026-09-14T11:00:00.000Z' },
    { src: 'flyer', created_at: '2026-09-14T12:00:00.000Z' },
  ]);
  const inscriptions = summarizeInscriptionRows([
    {
      created_at: '2026-09-14T12:30:00.000Z',
      product_id: 'seance-essai-offerte',
      product_name: 'SEANCE D ESSAI GRATUITE WEB',
      source: 'seance-offerte-web',
      payment: { amount: 0, status: 'paid' },
      utm: { source: 'email' },
    },
    {
      created_at: '2026-09-14T13:00:00.000Z',
      product_id: 'seance-essai',
      product_name: "Séance d'essai 10 €",
      payment: { amount: 10, status: 'paid' },
      utm: { source: 'email' },
    },
  ]);
  assert.equal(clicks.total, 3);
  assert.equal(clicks.email, 2);
  assert.equal(inscriptions.total, 1);
  assert.equal(inscriptions.email, 1);
  assert.equal(conversionPct(clicks.total, inscriptions.total), 33.3);
});
