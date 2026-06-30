/**
 * Entrée Vercel — Express boutique Boxing Center (sans Playwright).
 */
const { logError } = require('../lib/logger');
const { createApp } = require('../storefront/server');

let app;

module.exports = (req, res) => {
  try {
    if (!app) app = createApp();
    return app(req, res);
  } catch (err) {
    logError('Vercel init crash', { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: false,
          error: 'server_init_failed',
          message: err.message,
        })
      );
    }
  }
};
