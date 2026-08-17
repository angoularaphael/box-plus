'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isMaintenanceBypass,
  maintenancePageHtml,
  DEFAULT_MESSAGE,
} = require('../storefront/lib/site-maintenance');

describe('maintenance boutique', () => {
  it('laisse passer admin, auth, assets et webhooks', () => {
    assert.equal(isMaintenanceBypass({ path: '/admin' }), true);
    assert.equal(isMaintenanceBypass({ path: '/admin/login' }), true);
    assert.equal(isMaintenanceBypass({ path: '/api/admin/maintenance' }), true);
    assert.equal(isMaintenanceBypass({ path: '/api/auth/login' }), true);
    assert.equal(isMaintenanceBypass({ path: '/css/maintenance.css' }), true);
    assert.equal(isMaintenanceBypass({ path: '/api/webhooks/payplug' }), true);
    assert.equal(isMaintenanceBypass({ path: '/api/cron/inscription-nudges' }), true);
  });

  it('bloque l’accueil et l’inscription', () => {
    assert.equal(isMaintenanceBypass({ path: '/' }), false);
    assert.equal(isMaintenanceBypass({ path: '/inscription' }), false);
    assert.equal(isMaintenanceBypass({ path: '/api/orders/draft' }), false);
  });

  it('page GONG / round suspendu', () => {
    const html = maintenancePageHtml({ message: DEFAULT_MESSAGE });
    assert.match(html, /GONG/);
    assert.match(html, /Round suspendu/);
    assert.match(html, /Boxing Center/);
  });
});
