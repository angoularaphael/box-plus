'use strict';

/**
 * CORS des endpoints publics consommés par le site vitrine WordPress.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALLOWED_ORIGINS,
  parseAllowedOrigins,
  isAllowedOrigin,
  corsMiddleware,
} = require('../storefront/lib/cors');

function fakeRes() {
  return {
    headers: {},
    statusSent: null,
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    sendStatus(code) {
      this.statusSent = code;
      return this;
    },
  };
}

function run(mw, { method = 'POST', origin } = {}) {
  const req = { method, headers: origin ? { origin } : {} };
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test('la liste par défaut couvre boxingcenter.fr et aventure', () => {
  const allowed = parseAllowedOrigins(undefined);
  assert.equal(isAllowedOrigin('https://boxingcenter.fr', allowed), true);
  assert.equal(isAllowedOrigin('https://www.boxingcenter.fr', allowed), true);
  assert.equal(isAllowedOrigin('https://aventure.boxingcenter.fr', allowed), true);
  assert.equal(isAllowedOrigin('https://balma-bc.vercel.app', allowed), true);
  assert.ok(DEFAULT_ALLOWED_ORIGINS.includes('boxingcenter.fr'));
});

test('une origine inconnue ne reçoit aucun en-tête CORS', () => {
  const { res, nextCalled } = run(corsMiddleware(), { origin: 'https://exemple-malveillant.fr' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(nextCalled, true);
});

test('une origine autorisée reçoit les en-têtes et passe au handler', () => {
  const { res, nextCalled } = run(corsMiddleware(), { origin: 'https://boxingcenter.fr' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://boxingcenter.fr');
  assert.equal(res.headers.Vary, 'Origin');
  assert.equal(res.headers['Access-Control-Allow-Headers'], 'Content-Type');
  assert.equal(nextCalled, true);
});

test('le préflight OPTIONS répond 204 au lieu de tomber en 404', () => {
  const { res, nextCalled } = run(corsMiddleware(), {
    method: 'OPTIONS',
    origin: 'https://boxingcenter.fr',
  });
  assert.equal(res.statusSent, 204);
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET,POST,OPTIONS');
  assert.equal(nextCalled, false);
});

test('les credentials ne sont jamais autorisés', () => {
  const { res } = run(corsMiddleware(), { origin: 'https://boxingcenter.fr' });
  assert.equal(res.headers['Access-Control-Allow-Credentials'], undefined);
});

test('la liste est surchargeable', () => {
  const mw = corsMiddleware({ origins: 'https://autre.example' });
  assert.equal(
    run(mw, { origin: 'https://autre.example' }).res.headers['Access-Control-Allow-Origin'],
    'https://autre.example'
  );
  assert.equal(
    run(mw, { origin: 'https://boxingcenter.fr' }).res.headers['Access-Control-Allow-Origin'],
    undefined
  );
});

test('une requête sans origine (curl, serveur) reste inchangée', () => {
  const { res, nextCalled } = run(corsMiddleware(), {});
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(nextCalled, true);
});
