/**
 * Sitemap boutique — XML valide, domaine canonique, jamais vide.
 */
const assert = require('assert');
const path = require('path');
const { buildSitemapXml, SITE_URL, FALLBACK_SITEMAP, findProduct } = require('../storefront/lib/seo');

const xml = buildSitemapXml(path.join(__dirname, '..', 'storefront', 'public'));

assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
assert.ok(xml.includes(`<loc>${SITE_URL}/</loc>`));
assert.ok(xml.includes(`${SITE_URL}/abonnements`));
assert.ok(xml.includes(`${SITE_URL}/seance-essai`));
assert.ok(xml.includes(`${SITE_URL}/offre/259`));
assert.ok(xml.includes(`${SITE_URL}/llms.txt`));
assert.ok(!/box-plus\.vercel\.app/i.test(xml));

const blade = findProduct('gants-boxe-blade-noir-blanc');
assert.ok(blade);
assert.equal(blade.id, 'mat-blade-gold');
assert.equal(findProduct('gants-boxe-blade-gold-blanc-noir').id, blade.id);
assert.ok(xml.includes('/materiel/produit/gants-boxe-blade-noir-blanc'));
assert.ok(xml.includes('</urlset>'));
assert.ok(FALLBACK_SITEMAP.includes('<urlset'));
assert.ok(FALLBACK_SITEMAP.includes(`${SITE_URL}/`));
console.log('sitemap.test.js ok', SITE_URL);
