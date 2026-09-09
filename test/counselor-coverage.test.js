'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guideWelcome } = require('../storefront/lib/counselor-ai');
const CASES = require('./counselor-coverage.cases');

async function runCase(c) {
  const persona = c.persona || 'chloe';
  const messages = Array.isArray(c.messages) ? c.messages : [];
  return guideWelcome({ freeText: c.q, messages, persona });
}

function flagsFor(c, result) {
  const reply = result.reply || '';
  const flags = [];
  if (c.expectSource && result.source !== c.expectSource) {
    const alias =
      c.expectSource === 'redirect-planning' && result.source === 'knowledge-planning';
    if (!alias) flags.push(`SOURCE ${result.source} != ${c.expectSource}`);
  }
  for (const re of c.must || []) {
    if (!re.test(reply)) flags.push(`MANQUE ${re}`);
  }
  for (const re of c.mustNot || []) {
    if (re.test(reply)) flags.push(`INTERDIT ${re}`);
  }
  for (const re of c.failIf || []) {
    if (re.test(reply)) flags.push(`INTERDIT ${re}`);
  }
  return flags;
}

for (const c of CASES) {
  test(c.id, async () => {
    const result = await runCase(c);
    const flags = flagsFor(c, result);
    assert.equal(flags.length, 0, `${c.id} [${result.source}] ${flags.join(' ; ')} | ${result.reply}`);
  });
}

for (const q of CASES.PROBES || []) {
  test(`probe: ${q}`, async () => {
    const result = await guideWelcome({ freeText: q, messages: [], persona: 'chloe' });
    assert.notEqual(result.source, 'template', `menu générique sur « ${q} » → ${result.reply}`);
    assert.doesNotMatch(result.reply || '', /dis-moi juste ce que tu cherches/i);
  });
}
