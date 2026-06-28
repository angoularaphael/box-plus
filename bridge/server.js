#!/usr/bin/env node
/**
 * Phase 3 — Serveur bridge PrestaShop → file d'attente → bot Deciplus
 */
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const { enqueue, getQueueStats, STATUS } = require('../lib/queue');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { logInfo, logError } = require('../lib/logger');
const { runLoop, processOneJob } = require('../bot/index');
const { listPending } = require('../lib/queue');

const PORT = Number(process.env.BRIDGE_PORT || 3030);
const HOST = process.env.BRIDGE_HOST || '0.0.0.0';
const SECRET = process.env.BRIDGE_SECRET || '';

function verifySignature(req) {
  if (!SECRET) return true;
  const sig = req.headers['x-boxplus-signature'] || req.headers['x-prestashop-signature'];
  if (!sig || typeof sig !== 'string') return false;
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'boxplus-bridge', stats: getQueueStats() });
  });

  app.get('/queue', (_req, res) => {
    const stats = getQueueStats();
    res.json(stats);
  });

  app.post('/bridge/webhook', (req, res) => {
    try {
      if (!verifySignature(req)) {
        logError('Webhook signature invalide');
        return res.status(401).json({ ok: false, error: 'invalid_signature' });
      }

      const order = normalizeOrder(req.body);
      const errors = validateOrder(order);
      if (errors.length) {
        return res.status(400).json({ ok: false, errors });
      }

      const result = enqueue(order);
      logInfo('Webhook PrestaShop reçu', {
        order_id: order.order_id,
        action: order.action,
        queued: result.queued,
      });

      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      logError('Erreur webhook', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/bridge/process-one', async (_req, res) => {
    const pending = listPending();
    if (!pending.length) {
      return res.json({ ok: true, processed: false, message: 'file vide' });
    }
    const result = await processOneJob(pending[0]);
    res.json({ ok: true, processed: true, result });
  });

  app.post('/bridge/enqueue-test', (req, res) => {
    const order = normalizeOrder(req.body);
    const result = enqueue(order);
    res.json({ ok: true, ...result });
  });

  return app;
}

async function main() {
  const app = createApp();

  app.listen(PORT, HOST, () => {
    logInfo(`Bridge BOXPLUS écoute sur http://${HOST}:${PORT}`);
    logInfo('Endpoints: POST /bridge/webhook, GET /health, GET /queue');
  });

  if (String(process.env.BRIDGE_AUTO_BOT || 'true').toLowerCase() === 'true') {
    runLoop(false).catch((err) => logError('Bot loop crashed', { error: err.message }));
  }
}

if (require.main === module) {
  main();
}

module.exports = { createApp, verifySignature };
