#!/usr/bin/env node
'use strict';

/**
 * Pose un maximum de questions aux conseillers (couche déterministe locale).
 *   node scripts/test-counselor-coverage.js
 *
 * Option --live : tape l'API production (lent, consomme le quota IA).
 */

const CASES = require('../test/counselor-coverage.cases');

async function localAsk(c) {
  const { guideWelcome } = require('../storefront/lib/counselor-ai');
  return guideWelcome({
    freeText: c.q,
    messages: Array.isArray(c.messages) ? c.messages : [],
    persona: c.persona || 'chloe',
  });
}

async function liveAsk(c) {
  const body = JSON.stringify({
    free_text: c.q,
    persona: c.persona || 'chloe',
    messages: Array.isArray(c.messages) ? c.messages : [],
  });
  const res = await fetch('https://boutique.boxingcenter.fr/api/membership/welcome-counsel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://boxingcenter.fr',
    },
    body,
  });
  return res.json();
}

function flagsFor(c, result) {
  const reply = result.reply || '';
  const flags = [];
  if (c.expectSource && result.source !== c.expectSource) {
    flags.push(`SOURCE ${result.source} != ${c.expectSource}`);
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

async function main() {
  const live = process.argv.includes('--live');
  const ask = live ? liveAsk : localAsk;
  let ko = 0;
  for (let i = 0; i < CASES.length; i += 1) {
    const c = CASES[i];
    const result = await ask(c);
    const flags = flagsFor(c, result);
    const status = flags.length ? 'KO' : 'OK';
    if (flags.length) ko += 1;
    console.log(`${status} ${i + 1}/${CASES.length} ${c.id} [${result.source || '?'}] ${flags.join(' ; ')}`);
    if (flags.length) console.log('  Q:', c.q, '\n  R:', (result.reply || '').slice(0, 280));
    if (live) await new Promise((r) => setTimeout(r, 4000));
  }
  const probes = CASES.PROBES || [];
  for (let i = 0; i < probes.length; i += 1) {
    const q = probes[i];
    const result = await ask({ q });
    const menu = result.source === 'template' || /dis-moi juste ce que tu cherches/i.test(result.reply || '');
    const status = menu ? 'KO' : 'OK';
    if (menu) ko += 1;
    console.log(`${status} probe ${i + 1}/${probes.length} [${result.source || '?'}] ${q}`);
    if (menu) console.log('  R:', (result.reply || '').slice(0, 280));
    if (live) await new Promise((r) => setTimeout(r, 4000));
  }
  console.log(`\nTOTAL ${CASES.length + probes.length} KO ${ko}`);
  process.exit(ko ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
