const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { clientFieldsFromOrder } = require('../storefront/lib/client-sync');
const { normalizeFeaturedIds } = require('../storefront/lib/merch');

describe('client sync', () => {
  it('mappe une inscription vers portet_clients', () => {
    const fields = clientFieldsFromOrder({
      order_id: 'BC-123',
      customer_short: {
        first_name: 'Jean',
        last_name: 'Dupont',
        email: 'jean@test.fr',
        phone: '0612345678',
      },
      customer_full: { gym: 'minimes' },
      product_snapshot: { display_name: 'Etudiants 36,99€' },
    });
    assert.equal(fields.prenom, 'Jean');
    assert.equal(fields.nom, 'Dupont');
    assert.equal(fields.email, 'jean@test.fr');
    assert.equal(fields.telephone, '0612345678');
    assert.equal(fields.salle, 'Les Minimes');
    assert.equal(fields.source, 'boxplus');
  });

  it('ignore les noms qui ressemblent à un email', () => {
    const fields = clientFieldsFromOrder({
      customer_short: {
        first_name: 'debota@test.com',
        last_name: 'debota@test.com',
        email: 'debota@test.com',
        phone: '0666666666',
      },
    });
    assert.equal(fields.prenom, null);
    assert.equal(fields.nom, null);
    assert.equal(fields.email, 'debota@test.com');
  });
});

describe('featured ids', () => {
  it('normalise legacy_id vers id produit', () => {
    const ids = normalizeFeaturedIds(['offre-promo-adulte', 'seance-essai']);
    assert.ok(ids.includes('seance-essai'));
    assert.ok(ids.some((id) => id.startsWith('dp-') || id === 'offre-promo-adulte'));
  });
});
