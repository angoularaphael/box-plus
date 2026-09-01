/**
 * Sitemap boutique — XML valide, domaine canonique, jamais vide.
 */
const assert = require('assert');
const path = require('path');
const { buildSitemapXml, SITE_URL, FALLBACK_SITEMAP, findProduct } = require('../storefront/lib/seo');
const { LANDINGS, renderLanding, landingJsonLd } = require('../storefront/lib/seo-landings');

const xml = buildSitemapXml(path.join(__dirname, '..', 'storefront', 'public'));

assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
assert.ok(xml.includes(`<loc>${SITE_URL}/</loc>`));
assert.ok(xml.includes(`${SITE_URL}/abonnements`));
assert.ok(xml.includes(`${SITE_URL}/seance-essai`));
assert.ok(xml.includes(`${SITE_URL}/offre/259`));
assert.ok(xml.includes(`${SITE_URL}/boxe-anglaise-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/boxe-thai-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/kick-boxing-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/mma-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/grappling-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/boxe-femme-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/boxe-enfant-toulouse`));
assert.ok(xml.includes(`${SITE_URL}/cross-training-toulouse`));
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
for (const [route, page] of Object.entries(LANDINGS)) {
  const html = renderLanding(route);
  assert.ok(html.includes(`<title>${page.title}</title>`));
  assert.ok(html.includes(`<h1>${page.name} à Toulouse</h1>`));
  assert.ok(html.includes('href="/seance-essai"'));
  assert.equal(landingJsonLd(route, SITE_URL)['@graph'][0].url, `${SITE_URL}${route}`);
}
console.log('sitemap.test.js ok', SITE_URL);
