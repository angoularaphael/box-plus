const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('prem-eu2-ops: pas de GIT_ENV fige avant loadEnvFile', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'deploy', 'prem-eu2-ops', 'index.js'),
    'utf8'
  );
  assert.ok(!/\bconst GIT_ENV\s*=/.test(src), 'GIT_ENV constant supprime (env fige au boot)');
  assert.ok(/\bchildEnv\s*\(/.test(src), 'childEnv() doit construire env au moment du run');
});

test('enfant herite des vars chargees apres snapshot process.env', () => {
  const key = '__BOXPLUS_BOOTSTRAP_ENV_TEST__';
  delete process.env[key];
  const frozen = { ...process.env };
  process.env[key] = 'from-container-env';
  assert.equal(frozen[key], undefined);
  assert.equal({ ...process.env }[key], 'from-container-env');
  delete process.env[key];
});
