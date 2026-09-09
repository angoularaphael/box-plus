#!/usr/bin/env node
'use strict';

/**
 * Enchaîne et ré-enchaîne des conversations visiteur (couche déterministe).
 *
 *   node scripts/test-counselor-scenarios.js
 *   node scripts/test-counselor-scenarios.js --chaos
 *
 * Vérifie chaque réponse, refuse les menus génériques, refuse de recopier
 * le message précédent, puis rejoue les mêmes questions dans d’autres ordres.
 */

const { guideWelcome } = require('../storefront/lib/counselor-ai');
const { similarityScore } = require('../storefront/lib/welcome-faq');
const SCENARIOS = require('../test/counselor-scenarios');

const NO_MENU =
  /dis-moi juste ce que tu cherches|Offres, salles, essai|partir sur quoi en premier|Balance ta question/i;

function flagsFor(step, result, lastBot) {
  const reply = result.reply || '';
  const flags = [];
  if (step.expectSource && result.source !== step.expectSource) {
    flags.push(`SOURCE ${result.source} != ${step.expectSource}`);
  }
  for (const re of step.must || []) {
    if (!re.test(reply)) flags.push(`MANQUE ${re}`);
  }
  for (const re of step.mustNot || []) {
    if (re.test(reply)) flags.push(`INTERDIT ${re}`);
  }
  for (const re of step.failIf || []) {
    if (re.test(reply)) flags.push(`INTERDIT ${re}`);
  }
  if (step.notClone === true && lastBot && similarityScore(reply, lastBot) >= 0.72) {
    flags.push('CLONE du message précédent');
  }
  if (result.source === 'template' && !/^(salut|bonjour|hello|coucou|ok|d['’]accord)\b/i.test(step.q)) {
    flags.push('MENU générique');
  }
  if (NO_MENU.test(reply) && (step.must || []).length) flags.push('MENU dans une réponse factuelle');
  return flags;
}

async function playScenario(scenario) {
  const persona = scenario.persona || 'chloe';
  const messages = [];
  const report = [];
  let ko = 0;
  for (let i = 0; i < scenario.steps.length; i += 1) {
    const step = scenario.steps[i];
    messages.push({ role: 'user', content: step.q });
    const lastBot = [...messages].reverse().find((m) => m.role === 'assistant');
    const result = await guideWelcome({ freeText: step.q, messages: messages.slice(), persona });
    const flags = flagsFor(step, result, lastBot ? lastBot.content : '');
    if (flags.length) ko += 1;
    report.push({
      turn: i + 1,
      q: step.q,
      source: result.source,
      reply: result.reply,
      flags,
    });
    messages.push({ role: 'assistant', content: result.reply || '' });
  }
  return { id: scenario.id, persona, ko, report };
}

async function chaos() {
  const qs = SCENARIOS.CHAOS_QUESTIONS || [];
  const personas = ['chloe', 'fabien', 'nassim'];
  const out = [];
  let ko = 0;
  for (const persona of personas) {
    for (let start = 0; start < qs.length; start += 1) {
      const messages = [];
      let lastBot = '';
      const chain = [];
      for (let k = 0; k < 4; k += 1) {
        const q = qs[(start + k) % qs.length];
        messages.push({ role: 'user', content: q });
        const result = await guideWelcome({ freeText: q, messages: messages.slice(), persona });
        const step = { q, mustNot: [NO_MENU] };
        const flags = flagsFor(step, result, lastBot);
        if (flags.length) ko += 1;
        chain.push({ q, source: result.source, flags, reply: (result.reply || '').slice(0, 160) });
        messages.push({ role: 'assistant', content: result.reply || '' });
        lastBot = result.reply || '';
      }
      out.push({ persona, start: qs[start], ko: chain.filter((c) => c.flags.length).length, chain });
    }
  }
  return { ko, out };
}

async function main() {
  const wantChaos = process.argv.includes('--chaos');
  let totalKo = 0;
  let turns = 0;
  for (const scenario of SCENARIOS) {
    const played = await playScenario(scenario);
    totalKo += played.ko;
    turns += played.report.length;
    const mark = played.ko ? 'KO' : 'OK';
    console.log(`${mark} ${scenario.id} (${played.persona}) ${played.ko} fail / ${played.report.length} tours`);
    for (const t of played.report) {
      if (!t.flags.length) continue;
      console.log(`  T${t.turn} [${t.source}] ${t.flags.join(' ; ')}`);
      console.log(`    Q: ${t.q}`);
      console.log(`    R: ${(t.reply || '').slice(0, 260)}`);
    }
  }
  if (wantChaos) {
    const c = await chaos();
    totalKo += c.ko;
    const failed = c.out.filter((x) => x.ko);
    console.log(`\nCHAOS ${c.out.length} chaînes × 4 tours — KO ${c.ko}`);
    for (const x of failed.slice(0, 40)) {
      console.log(`  ${x.persona} depuis « ${x.start} »`);
      for (const t of x.chain) {
        if (!t.flags.length) continue;
        console.log(`    [${t.source}] ${t.flags.join(' ; ')} | ${t.q} → ${t.reply}`);
      }
    }
  }
  console.log(`\nSCÉNARIOS ${SCENARIOS.length} TOURS ${turns} KO ${totalKo}`);
  process.exit(totalKo ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
