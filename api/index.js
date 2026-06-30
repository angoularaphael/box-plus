/**
 * Entrée Vercel — Express boutique Boxing Center (sans Playwright).
 */
let app;

module.exports = (req, res) => {
  try {
    if (!app) {
      const { createApp } = require('../storefront/server');
      app = createApp();
    }
    return app(req, res);
  } catch (err) {
    console.error('Vercel init crash', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: false,
          error: 'server_init_failed',
          message: err.message,
          stack: process.env.VERCEL ? undefined : err.stack,
        })
      );
    }
  }
};
