#!/usr/bin/env node
/**
 * Remet un job en file (après fix bot) — supprime l'entrée processed.
 * Usage: node scripts/requeue-job.js STORE-xxx ou DEMO-xxx
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { QUEUE_DIR } = require('../lib/queue');

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: node scripts/requeue-job.js <order_id>');
  process.exit(1);
}

const processedFile = path.join(QUEUE_DIR, 'processed-orders.json');
const data = JSON.parse(fs.readFileSync(processedFile, 'utf8'));
if (data.orders[jobId]) {
  delete data.orders[jobId];
  fs.writeFileSync(processedFile, JSON.stringify(data, null, 2));
  console.log(`Processed supprimé: ${jobId}`);
}

const safe = jobId.replace(/[^a-zA-Z0-9_-]+/g, '__');
const jobFile = path.join(QUEUE_DIR, `${safe}.json`);
if (fs.existsSync(jobFile)) {
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  job.status = 'pending';
  job.attempts = 0;
  delete job.last_error;
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  console.log(`Job remis en pending: ${jobFile}`);
} else {
  console.log(`Fichier job introuvable: ${jobFile}`);
  console.log('Relancez une commande demo avec un nouveau client (email/tél uniques).');
}
