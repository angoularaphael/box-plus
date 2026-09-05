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

test('dispatchInProgress reste vrai quand le job est en file', () => {
  const now = Date.parse('2026-09-05T09:00:00.000Z');
  assert.equal(
    dispatchInProgress(
      {
        dispatched_at: '2026-09-05T08:55:37.150Z',
        dispatch_result: { queued: true, forwarded: true },
      },
      now
    ),
    true
  );
});

test('missingFicheReason — erreur bot ou déjà traité côté bot', () => {
  assert.equal(
    missingFicheReason({ bot_status: 'manual_review', bot_error: 'échec membre' }),
    'bot_error'
  );
  assert.equal(
    missingFicheReason({ dispatch_result: { reason: 'already_processed' } }),
    'envoye_sans_retour'
  );
});

test('mapBotStatus normalise success', () => {
  assert.equal(mapBotStatus({ status: 'success' }), 'success');
  assert.equal(mapBotStatus({ status: 'MANUAL_REVIEW' }), 'manual_review');
});
