#!/usr/bin/env node
/**
 * Lance l'enregistreur pour un scénario nommé.
 * Usage: node analyzer/run-scenario.js 02-create-member
 */
const { spawn } = require('child_process');
const path = require('path');

const scenario = process.argv[2];
if (!scenario) {
  console.error('Usage: node analyzer/run-scenario.js <scenario-name>');
  console.error('Ex: node analyzer/run-scenario.js 02-create-member');
  process.exit(1);
}

const env = { ...process.env, ANALYZER_SCENARIO: scenario };
const child = spawn('node', ['analyzer/record-session.js'], {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
