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

const gants = findProduct('58-871-gants-club-line-competition-metal-boxe.html');
assert.ok(gants);
assert.equal(gants.prestashop_id, 58);
assert.equal(gants.slug, 'gants-club-line-competition-metal-boxe');
assert.equal(findProduct('gants-club-line-competition-metal-boxe').id, gants.id);
assert.ok(xml.includes('</urlset>'));
assert.ok(FALLBACK_SITEMAP.includes('<urlset'));
assert.ok(FALLBACK_SITEMAP.includes(`${SITE_URL}/`));
console.log('sitemap.test.js ok', SITE_URL);
