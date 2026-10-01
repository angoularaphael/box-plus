const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ribAddressFields } = require('../bot/wallet');

const gym = { label: 'St-Cyprien', address: '11 Rue Sainte-Lucie, 31300 Toulouse' };

describe('ribAddressFields', () => {
  it('keeps a real city', () => {
    const addr = ribAddressFields(
      { address: '8 passage de l allier', postal_code: '31170', city: 'Tournefeuille' },
      gym
    );
    assert.equal(addr.city, 'Tournefeuille');
    assert.equal(addr.postal_code, '31170');
  });

  it('RIB deja saisi n est pas ignore si Valider est bloque', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/wallet.js'), 'utf8');
    assert.match(src, /RIB visible mais mandat non enregistré — adresse \+ Valider/);
    assert.match(src, /async function ribMandateNeedsSave/);
    assert.match(src, /existingMeta\.rum && ibanAlready && !needsSave/);
    assert.match(src, /memberAsksToRegisterRib/);
    assert.match(src, /if \(blocked \|\| validerOff\) return true/);
    assert.match(src, /after\.rum && !stillAsks/);
    assert.match(src, /RUM présent mais fiche demande encore le RIB/);
    assert.match(src, /la fiche demande encore d enregistrer le RIB/);
  });

  it('empreinte carte PayPlug sans PAN', () => {
    const { cardFingerprintFromPayplug } = require('../storefront/lib/payplug');
    assert.equal(cardFingerprintFromPayplug(null), null);
    const fp = cardFingerprintFromPayplug({
      card: { last4: '4242', brand: 'visa', exp_month: 12, exp_year: 2030, country: 'FR' },
    });
    assert.deepEqual(fp, {
      card_last4: '4242',
      card_brand: 'visa',
      card_exp_month: 12,
      card_exp_year: 2030,
      card_country: 'FR',
    });
  });

  it('falls back to gym when city is the postal code', () => {
    const addr = ribAddressFields(
      { address: '8 passage de l allier', postal_code: '31170', city: '31170' },
      gym
    );
    assert.equal(addr.city, 'Toulouse');
    assert.equal(addr.postal_code, '31300');
    assert.match(addr.address, /Sainte-Lucie/i);
  });
});
