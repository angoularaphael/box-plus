#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { guideWelcome } = require('../storefront/lib/counselor-ai');
const CASES = require('../test/counselor-precision-cases');

const VAGUE =
  /consulte[rz]?.{0,25}(?:planning|site)|voir le planning sans autre précision|cela dépend du cours|contacte[rz]?.{0,20}(?:salle|club)|toutes les informations sur (?:notre|le) site|quelle salle (?:te|vous) (?:va|arrange)/i;

function testPattern(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.test(String(text || ''));
}

function scoreReply(step, reply) {
  const found = step.must.filter((item) => testPattern(item.pattern, reply));
  const missing = step.must.filter((item) => !testPattern(item.pattern, reply));
  const forbidden = step.mustNot.filter((item) => testPattern(item.pattern, reply));
  const vague = testPattern(VAGUE, reply) || forbidden.some((item) => item.label === 'réponse vague');
  const invented = forbidden.filter(
    (item) => item.label !== 'réponse vague' && /faux|mauvais|invent|parasite|ancienne salle|ancien coach/i.test(item.label)
  );

  let score;
  if (invented.length || forbidden.some((item) => /mauvais jour|salle fausse|horaire inventé/i.test(item.label))) {
    score = 0;
  } else {
    const coverage = step.must.length ? found.length / step.must.length : 1;
    score = coverage === 1 ? 100 : coverage >= 0.75 ? 75 : coverage >= 0.5 ? 50 : coverage > 0 ? 25 : 0;
    if (forbidden.length) score = Math.min(score, 50);
    if (vague) score = Math.min(score, 25);
  }

  return {
    score,
    found: found.map((item) => item.label),
    missing: missing.map((item) => item.label),
    forbidden: forbidden.map((item) => item.label),
    vague,
    invented: invented.map((item) => item.label),
  };
}

async function runCampaign(cases = CASES) {
  const responses = [];
  for (const scenario of cases) {
    const messages = [];
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      messages.push({ role: 'user', content: step.q });
      const result = await guideWelcome({
        freeText: step.q,
        messages: messages.slice(),
        persona: scenario.persona,
      });
      const reply = result.reply || '';
      const evaluation = scoreReply(step, reply);
      responses.push({
        scenario: scenario.id,
        turn: index + 1,
        persona: scenario.persona,
        question: step.q,
        reply,
        source: result.source,
        ...evaluation,
      });
      messages.push({ role: 'assistant', content: reply });
    }
  }

  const scores = responses.map((item) => item.score);
  const summary = {
    responses: responses.length,
    perfect: scores.filter((score) => score === 100).length,
    partial: scores.filter((score) => score > 0 && score < 100).length,
    incorrect: scores.filter((score) => score === 0).length,
    invented: responses.filter((item) => item.invented.length).length,
    vague: responses.filter((item) => item.vague).length,
    average: scores.length
      ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
      : 0,
  };
  return { generated_at: new Date().toISOString(), summary, responses };
}

function outputPathArg() {
  const raw = process.argv.find((arg) => arg.startsWith('--json='));
  return raw ? raw.slice('--json='.length) : '';
}

async function main() {
  const report = await runCampaign();
  const show = process.argv.includes('--show');
  for (const row of report.responses) {
    const issues = [...row.missing.map((x) => `manque:${x}`), ...row.forbidden.map((x) => `interdit:${x}`)];
    console.log(
      `${String(row.score).padStart(3)}% ${row.scenario} T${row.turn} [${row.persona}/${row.source}]` +
        (issues.length ? ` — ${issues.join(', ')}` : '')
    );
    if (show || row.score < 100) {
      console.log(`  Q: ${row.question}`);
      console.log(`  R: ${row.reply}`);
    }
  }
  console.log(`\nPRECISION ${JSON.stringify(report.summary)}`);

  const target = outputPathArg();
  if (target) {
    const file = path.resolve(target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    console.log(`REPORT ${file}`);
  }
  if (process.argv.includes('--require-perfect') && report.summary.perfect !== report.summary.responses) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runCampaign, scoreReply, VAGUE };
