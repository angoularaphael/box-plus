'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchInProgress, missingFicheReason } = require('../storefront/lib/admin-stats');
const { mapBotStatus } = require('../lib/bot-sync');

test('dispatchInProgress ignore un envoi déjà traité sans file', () => {
  const now = Date.parse('2026-09-05T09:00:00.000Z');
  assert.equal(
    dispatchInProgress(
      {
        dispatched_at: '2026-09-05T08:55:37.150Z',
        dispatch_result: { queued: false, reason: 'already_processed', forwarded: true },
      },
      now
    ),
    false
  );
});

test('dispatchInProgress reste vrai quand le job est en file (< 2 min)', () => {
  const now = Date.parse('2026-09-05T09:00:00.000Z');
  assert.equal(
    dispatchInProgress(
      {
        dispatched_at: '2026-09-05T08:59:00.000Z',
        dispatch_result: { queued: true, forwarded: true },
      },
      now
    ),
    true
  );
});

test('dispatchInProgress expire après 2 min sans retour bot', () => {
  const now = Date.parse('2026-09-05T09:05:00.000Z');
  assert.equal(
    dispatchInProgress(
      {
        dispatched_at: '2026-09-05T09:00:00.000Z',
        dispatch_result: { queued: true, forwarded: true },
      },
      now
    ),
    false
  );
});

test('missingFicheReason — erreur bot ou déjà traité côté bot', () => {
  assert.equal(
    missingFicheReason({ bot_status: 'manual_review', bot_error: 'échec membre' }),
    'bot_error'
  );
  assert.equal(
    missingFicheReason({ bot_status: 'failover' }),
    'bot_error'
  );
  assert.equal(
    missingFicheReason({ dispatch_result: { reason: 'already_processed' } }),
    'envoye_sans_retour'
  );
  // Envoi vieux sans IDs mais < 12 relances = encore en attente, pas « bloqué »
  assert.equal(
    missingFicheReason({
      dispatched_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      sale_reconcile_attempts: 3,
    }),
    'envoye_sans_retour'
  );
  assert.equal(
    missingFicheReason({
      dispatched_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      sale_reconcile_attempts: 12,
    }),
    'envoye_bloque'
  );
});

test('mapBotStatus normalise success', () => {
  assert.equal(mapBotStatus({ status: 'success' }), 'success');
  assert.equal(mapBotStatus({ status: 'MANUAL_REVIEW' }), 'manual_review');
});
