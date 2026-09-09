'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CASES = require('./counselor-precision-cases');
const { runCampaign } = require('../scripts/audit-counselor-precision');

test('campagne naturelle — chaque réponse reste exacte, complète et contextualisée', async (t) => {
  const report = await runCampaign(CASES);

  for (const row of report.responses) {
    await t.test(`${row.scenario} T${row.turn} — ${row.question}`, () => {
      assert.equal(
        row.score,
        100,
        [
          `Réponse notée ${row.score}% (${row.source})`,
          `Manques: ${row.missing.join(', ') || 'aucun'}`,
          `Interdits: ${row.forbidden.join(', ') || 'aucun'}`,
          `Réponse: ${row.reply}`,
        ].join('\n')
      );
      assert.equal(row.vague, false, row.reply);
      assert.deepEqual(row.invented, [], row.reply);
    });
  }

  assert.deepEqual(report.summary, {
    responses: 49,
    perfect: 49,
    partial: 0,
    incorrect: 0,
    invented: 0,
    vague: 0,
    average: 100,
  });
});
