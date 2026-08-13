/**
 * Sitemap isolé du gros serveur Express.
 * Googlebot timeout / cold start de createApp() → « Impossible de récupérer ».
 */
'use strict';

const path = require('path');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  if (req.method === 'HEAD') {
    res.statusCode = 200;
    return res.end();
  }
  try {
    const { buildSitemapXml, FALLBACK_SITEMAP } = require('../storefront/lib/seo');
    const publicDir = path.join(__dirname, '..', 'storefront', 'public');
    res.statusCode = 200;
    res.end(buildSitemapXml(publicDir));
  } catch (err) {
    console.error('[sitemap]', err);
    let fallback =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      '<url><loc>https://boutique.boxingcenter.fr/</loc></url></urlset>\n';
    try {
      fallback = require('../storefront/lib/seo').FALLBACK_SITEMAP;
    } catch (_) { /* keep hardcoded fallback */ }
    res.statusCode = 200;
    res.end(fallback);
  }
};
