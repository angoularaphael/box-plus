import fs from 'node:fs';

const p = new URL('../storefront/server.js', import.meta.url);
let s = fs.readFileSync(p, 'utf8');

if (!s.includes("app.get('/checkout/app'")) {
  const needle = "  app.get('/api/config', (_req, res) => {";
  const insert = `  app.get('/checkout/app', async (req, res) => {
    try {
      const { bootstrapAppCheckout } = require('./lib/app-checkout-bootstrap');
      const result = await bootstrapAppCheckout(req.query, {
        findProduct,
        createDraftAsync,
        inscriptionRedirect,
      });
      if (!result.ok) {
        return res.status(result.status || 400).type('text/plain').send(result.error || 'erreur');
      }
      return res.redirect(302, result.redirect);
    } catch (err) {
      logError('Checkout app mobile', { error: err.message });
      return res.status(500).type('text/plain').send('checkout_indisponible');
    }
  });

`;
  if (!s.includes(needle)) throw new Error('needle checkout missing');
  s = s.replace(needle, insert + needle);
}

if (!s.includes('app-bridge-outbox')) {
  const needle2 = "  app.post('/api/internal/essai-followup', async (req, res) => {";
  const insert2 = `  app.get('/api/cron/app-bridge-outbox', async (req, res) => {
    if (!isAuthorizedCron(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const { replayAppBridgeOutbox } = require('./lib/app-checkout-bootstrap');
      const { listAllOrdersAsync, saveOrderAsync } = require('./lib/order-lifecycle');
      const result = await replayAppBridgeOutbox({ listAllOrdersAsync, saveOrderAsync });
      res.json(result);
    } catch (err) {
      logError('Cron outbox app bridge', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

`;
  if (!s.includes(needle2)) throw new Error('needle cron missing');
  s = s.replace(needle2, insert2 + needle2);
}

fs.writeFileSync(p, s);
console.log('patched', p.pathname);
