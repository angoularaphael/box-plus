'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.BOXPLUS_QUEUE_DIR = path.join(os.tmpdir(), `boxplus-fifo-${Date.now()}`);

const { enqueue, listPending, compareJobsFifo } = require('../lib/queue');
const { normalizeOrder } = require('../lib/normalize');

function sale(id, createdAt, paidAt) {
  return normalizeOrder({
    order_id: id,
    created_at: createdAt,
    product_name: 'OFFRE A 29€',
    gym: 'minimes',
    customer: {
      first_name: 'Fifo',
      last_name: id,
      email: `${id}@test.fr`,
      phone: '0600000000',
      birthdate: '1990-01-01',
    },
    payment: {
      amount: 29,
      status: 'paid',
      paid_at: paidAt || createdAt,
      iban: 'FR7630001007941234567890185',
    },
  });
}

test('file FIFO : le plus ancien est traité en premier même s’il arrive en dernier', () => {
  enqueue(sale('BC-NEW', '2026-09-07T18:00:00.000Z'));
  enqueue(sale('BC-OLD', '2026-09-07T10:00:00.000Z'));
  enqueue(sale('BC-MID', '2026-09-07T14:00:00.000Z'));
  const pending = listPending();
  assert.deepEqual(
    pending.map((j) => j.order_id),
    ['BC-OLD', 'BC-MID', 'BC-NEW']
  );
});

test('force_requeue garde la date d’origine — pas renvoyé en fin de file', () => {
  const first = enqueue(sale('BC-KEEP', '2026-09-01T08:00:00.000Z'));
  assert.equal(first.queued, true);
  const again = enqueue({
    ...sale('BC-KEEP', '2026-09-01T08:00:00.000Z'),
    force_requeue: true,
    force_sale_retry: true,
  });
  assert.equal(again.queued, true);
  enqueue(sale('BC-LATER', '2026-09-07T20:00:00.000Z'));
  const pending = listPending();
  const keep = pending.find((j) => j.order_id === 'BC-KEEP');
  const later = pending.find((j) => j.order_id === 'BC-LATER');
  assert.equal(keep.created_at, '2026-09-01T08:00:00.000Z');
  assert.ok(pending.indexOf(keep) < pending.indexOf(later));
});

test('compareJobsFifo : paid_at plus ancien gagne', () => {
  const older = { order_id: 'A', payment: { paid_at: '2026-09-01T00:00:00.000Z' } };
  const newer = { order_id: 'B', payment: { paid_at: '2026-09-07T00:00:00.000Z' } };
  assert.ok(compareJobsFifo(older, newer) < 0);
  assert.ok(compareJobsFifo(newer, older) > 0);
});
