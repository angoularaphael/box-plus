#!/usr/bin/env node
/**
 * Génère les livrables phase 1 à partir d'un fichier session *.har.json
 * Usage: npm run analyze:report -- session-xxx.har.json
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir, loadJson } = require('../lib/utils');

const OUTPUT_DIR = path.resolve(
  process.env.ANALYZER_OUTPUT_DIR || path.join(ROOT, 'analyzer', 'output')
);

function loadSessionFile(arg) {
  const name = arg || fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.har.json')).sort().pop();
  if (!name) throw new Error('Aucune session .har.json trouvée dans analyzer/output');
  const file = path.isAbsolute(name) ? name : path.join(OUTPUT_DIR, name);
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function extractApiEndpoints(network) {
  const map = new Map();
  for (const entry of network) {
    if (entry.phase !== 'response') continue;
    const url = entry.url || '';
    if (!url.includes('deciplus') && !url.startsWith('http')) continue;
    if (url.match(/\.(png|jpg|jpeg|gif|svg|woff|woff2|css|ico)(\?|$)/i)) continue;

    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }

    const key = `${entry.method || 'GET'} ${pathname}`;
    if (!map.has(key)) {
      map.set(key, {
        method: entry.method || 'GET',
        path: pathname,
        statuses: new Set(),
        sample_urls: new Set(),
        sample_bodies: [],
        count: 0,
      });
    }
    const item = map.get(key);
    item.count += 1;
    item.statuses.add(entry.status);
    item.sample_urls.add(url);
    if (entry.body_json && item.sample_bodies.length < 3) {
      item.sample_bodies.push(entry.body_json);
    }
  }
  return [...map.values()]
    .map((v) => ({
      ...v,
      statuses: [...v.statuses],
      sample_urls: [...v.sample_urls].slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count);
}

function extractSelectors(domEvents) {
  const byEvent = {};
  for (const ev of domEvents) {
    const key = ev.event || 'unknown';
    if (!byEvent[key]) byEvent[key] = {};
    const sel = ev.selector;
    if (!sel) continue;
    byEvent[key][sel] = (byEvent[key][sel] || 0) + 1;
  }

  const top = {};
  for (const [event, counts] of Object.entries(byEvent)) {
    top[event] = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([selector, count]) => ({ selector, count }));
  }
  return top;
}

function redactPostData(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/passwd=[^&]*/gi, 'passwd=[REDACTED]')
    .replace(/password=[^&]*/gi, 'password=[REDACTED]')
    .replace(/token=[^&]*/gi, 'token=[REDACTED]')
    .replace(/validationCode=[^&]*/gi, 'validationCode=[REDACTED]');
}

function buildApiMapMarkdown(session, endpoints) {
  const lines = [
    '# Deciplus — Cartographie API (générée)',
    '',
    `Session: \`${session.id}\``,
    `Scénario: ${session.scenario}`,
    `Début: ${session.started_at}`,
    `Fin: ${session.ended_at || '—'}`,
    '',
    '## Endpoints détectés',
    '',
    '| Méthode | Path | Occurrences | Status |',
    '|---------|------|-------------|--------|',
  ];

  for (const ep of endpoints.slice(0, 50)) {
    lines.push(`| ${ep.method} | \`${ep.path}\` | ${ep.count} | ${ep.statuses.join(', ')} |`);
  }

  lines.push('', '## Milestones enregistrés', '');
  for (const m of session.milestones || []) {
    lines.push(`- **${m.name}** — ${m.ts} — ${m.url || ''}`);
  }

  lines.push('', '## Requêtes POST/PUT significatives', '');
  const writes = (session.network || []).filter(
    (n) => n.phase === 'request' && ['POST', 'PUT', 'PATCH'].includes(n.method) && n.post_data
  );
  for (const req of writes.slice(0, 20)) {
    lines.push(`### ${req.method} ${req.url}`, '');
    lines.push('```');
    lines.push(String(redactPostData(req.post_data)).slice(0, 1500));
    lines.push('```', '');
  }

  return lines.join('\n');
}

function buildWorkflowsMarkdown(session) {
  const lines = [
    '# Deciplus — Workflows (généré)',
    '',
    'Procédure humaine vs traces machine pour la session enregistrée.',
    '',
    '## Parcours pages',
    '',
  ];
  for (const p of session.pages || []) {
    lines.push(`- ${p.ts} → ${p.url}`);
  }

  lines.push('', '## Milestones → actions', '');
  for (const m of session.milestones || []) {
    lines.push(`### ${m.name}`, `- URL: ${m.url || '—'}`, `- Horodatage: ${m.ts}`, '');
  }

  lines.push('## Champs formulaire détectés (change events)', '');
  const changes = (session.dom_events || []).filter((e) => e.event === 'change');
  const fields = [...new Set(changes.map((c) => c.selector))];
  for (const f of fields.slice(0, 40)) {
    lines.push(`- \`${f}\``);
  }

  return lines.join('\n');
}

function main() {
  const arg = process.argv[2];
  const { file, data: session } = loadSessionFile(arg);
  ensureDir(OUTPUT_DIR);

  const endpoints = extractApiEndpoints(session.network || []);
  const selectors = extractSelectors(session.dom_events || []);

  const apiMap = buildApiMapMarkdown(session, endpoints);
  const workflows = buildWorkflowsMarkdown(session);

  const selectorsFile = {
    session_id: session.id,
    scenario: session.scenario,
    generated_at: new Date().toISOString(),
    selectors,
    milestones: session.milestones || [],
  };

  const productDraft = loadJson('config/product-mapping.json');
  const gymDraft = loadJson('config/gym-mapping.json');

  fs.writeFileSync(path.join(OUTPUT_DIR, 'deciplus-api-map.md'), apiMap, 'utf8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'deciplus-workflows.md'), workflows, 'utf8');
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'deciplus-selectors.json'),
    JSON.stringify(selectorsFile, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'product-mapping-draft.json'),
    JSON.stringify(productDraft, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'gym-mapping-draft.json'),
    JSON.stringify(gymDraft, null, 2),
    'utf8'
  );

  console.log(`✅ Rapport généré depuis: ${file}`);
  console.log('   - analyzer/output/deciplus-api-map.md');
  console.log('   - analyzer/output/deciplus-workflows.md');
  console.log('   - analyzer/output/deciplus-selectors.json');
  console.log(`   Endpoints uniques: ${endpoints.length}`);
}

main();
