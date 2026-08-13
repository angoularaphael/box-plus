/**
 * robots.txt isolé — Google le lit avant le sitemap.
 */
'use strict';

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  try {
    const { robotsTxt } = require('../storefront/lib/seo');
    res.statusCode = 200;
    res.end(robotsTxt());
  } catch (err) {
    console.error('[robots]', err);
    res.statusCode = 200;
    res.end(
      'User-agent: *\nAllow: /\nSitemap: https://boutique.boxingcenter.fr/sitemap.xml\n'
    );
  }
};
