const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { clientFieldsFromOrder } = require('../storefront/lib/client-sync');
const { normalizeFeaturedIds } = require('../storefront/lib/merch');

describe('client sync', () => {
  it('mappe une inscription vers portet_clients avec toutes les infos', () => {
    const fields = clientFieldsFromOrder({
      order_id: 'BC-123',
      customer_short: {
        first_name: 'Jean',
        last_name: 'Dupont',
        email: 'jean@test.fr',
        phone: '0612345678',
      },
      customer_full: {
        gym: 'minimes',
        birth_date: '1990-05-15',
        address: '12 rue Exemple',
        postal_code: '31000',
        city: 'Toulouse',
        emergency_contact: 'Marie 0611111111',
        medical_info: 'Aucune',
      },
      product_snapshot: { display_name: 'Etudiants 36,99€' },
    });
    assert.equal(fields.prenom, 'Jean');
    assert.equal(fields.nom, 'Dupont');
    assert.equal(fields.email, 'jean@test.fr');
    assert.equal(fields.telephone, '0612345678');
    assert.equal(fields.salle, 'Les Minimes');
    assert.equal(fields.source, 'boxplus');
    assert.equal(fields.date_naissance, '1990-05-15');
    assert.equal(fields.adresse, '12 rue Exemple');
    assert.equal(fields.code_postal, '31000');
    assert.equal(fields.ville, 'Toulouse');
    assert.equal(fields.contact_urgence, 'Marie 0611111111');
    assert.equal(fields.offre, 'Etudiants 36,99€');
  });

  it('mappe birthdate depuis customer_short si customer_full absent', () => {
    const fields = clientFieldsFromOrder({
      customer_short: {
        first_name: 'A',
        last_name: 'B',
        email: 'a@test.fr',
        phone: '0612345678',
        birthdate: '1992-03-10',
      },
      product_snapshot: { name: 'Offre test' },
    });
    assert.equal(fields.date_naissance, '1992-03-10');
  });

  it('propose un fallback sans colonnes optionnelles', () => {
    const { buildRowVariants } = require('../storefront/lib/client-sync');
    const variants = buildRowVariants({
      prenom: 'Jean',
      nom: 'Dupont',
      email: 'jean@test.fr',
      telephone: '0612345678',
      salle: 'Les Minimes',
      offre: 'Matériel',
    });
    assert.equal(variants.length, 3);
    assert.equal(variants[0].offre, 'Matériel');
    assert.equal(variants[1].offre, undefined);
    assert.equal(variants[2].source, 'manual');
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
  it('normalise les ids du merch correctement', () => {
    const ids = normalizeFeaturedIds(['44-99-4-semaines', 'comptant-12-mois', 'seance-essai']);
    assert.ok(ids.length <= 3);
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
  });
});
