#!/usr/bin/env node
require('dotenv').config();

const { enqueue, listPending } = require('../lib/queue');
const { processOneJob } = require('../bot/index');

const ts = Date.now();
const orderId = `LOCAL-BADGE-${ts}`;
const phone = `06${String(ts).slice(-8)}`;

const order = {
  order_id: orderId,
  product_name: '44,99€/4 semaines Sans Engagement',
  gym: 'minimes',
  customer: {
    first_name: 'Test',
    last_name: `Badge${String(ts).slice(-4)}`,
    email: `badge-${ts}@boxplus-test.local`,
    phone,
    birthdate: '1990-01-01',
    gender: 'M',
    address: '1 rue Test Automatique',
    postal_code: '31000',
    city: 'Toulouse',
  },
  payment: {
    amount: 44.99,
    status: 'paid',
    method: 'card',
    iban: 'FR7630001007941234567890185',
  },
};

(async () => {
  console.log('Enqueue', orderId);
  enqueue(order);
  const job = listPending().find((j) => j.order_id === orderId);
  if (!job) throw new Error('Job not in queue');
  const result = await processOneJob(job);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result?.result?.status === 'success' ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
