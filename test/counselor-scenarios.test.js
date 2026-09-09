'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guideWelcome } = require('../storefront/lib/counselor-ai');
const { similarityScore } = require('../storefront/lib/welcome-faq');
const SCENARIOS = require('./counselor-scenarios');

const NO_MENU =
  /dis-moi juste ce que tu cherches|Offres, salles, essai|partir sur quoi en premier|Balance ta question/i;

for (const scenario of SCENARIOS) {
  test(scenario.id, async () => {
    const persona = scenario.persona || 'chloe';
    const messages = [];
    for (let i = 0; i < scenario.steps.length; i += 1) {
      const step = scenario.steps[i];
      if (step.seedBot) messages.push({ role: 'assistant', content: step.seedBot });
      const lastBot = [...messages].reverse().find((m) => m.role === 'assistant');
      messages.push({ role: 'user', content: step.q });
      const result = await guideWelcome({ freeText: step.q, messages: messages.slice(), persona });
      const reply = result.reply || '';
      const where = `${scenario.id} T${i + 1} « ${step.q} » [${result.source}] ${reply}`;
      if (step.expectSource) {
        const alias =
          step.expectSource === 'redirect-planning' && result.source === 'knowledge-planning';
        if (!alias) {
          assert.equal(result.source, step.expectSource, where);
        }
      }
      for (const re of step.must || []) assert.match(reply, re, where);
      for (const re of step.mustNot || []) assert.doesNotMatch(reply, re, where);
      for (const re of step.failIf || []) assert.doesNotMatch(reply, re, where);
      if (step.notClone === true && lastBot) {
        assert.ok(
          similarityScore(reply, lastBot.content) < 0.72,
          `clone T${i + 1}: ${where}`
        );
      }
      if ((step.must || []).length) {
        assert.doesNotMatch(reply, NO_MENU, where);
        assert.notEqual(result.source, 'template', where);
      }
      messages.push({ role: 'assistant', content: reply });
    }
  });
}
