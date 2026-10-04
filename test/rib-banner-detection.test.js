'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BANNER_RE =
  /veuillez\s+enregistrer\s+le\s+rib|enregistrer\s+le\s+rib\s+du\s+membre/i;

describe('RIB banner detection anti-regression', () => {
  it('detecte le bandeau rouge Deciplus', () => {
    assert.equal(BANNER_RE.test('---- VEUILLEZ ENREGISTRER LE RIB DU MEMBRE ----'), true);
    assert.equal(BANNER_RE.test('Alerte : Veuillez enregistrer le RIB du membre'), true);
  });

  it('ignore les faux positifs menus / html / boutons', () => {
    assert.equal(BANNER_RE.test('Saisir le mandat SEPA'), false);
    assert.equal(BANNER_RE.test('Enregistrer le RIB'), false);
    assert.equal(BANNER_RE.test('<a href="rib.php">enregistrer le rib</a>'), false);
    assert.equal(BANNER_RE.test('onclick="enregistrerLeRib()"'), false);
    assert.equal(BANNER_RE.test('Modifier le mandat SEPA'), false);
  });

  it('wallet.js detecte Rib-nok via #icon-list sans confondre Alerte Paiement (impaye)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../bot/wallet.js'), 'utf8');
    assert.match(src, /#icon-list/);
    assert.match(src, /alt="Rib-nok"/);
    assert.match(src, /payments-mode-wrapper/);
    assert.match(src, /veuillez\\s\+enregistrer\\s\+le\\s\+rib/);
    assert.doesNotMatch(src, /page\.content\(\)/);
    // Impaye Deciplus utilise aussi title="Alerte Paiement" — ne pas le traiter comme Rib-nok
    assert.doesNotMatch(
      src,
      /header\.querySelector\(\s*[\s\S]{0,120}\[title="Alerte Paiement"\]/
    );
  });

  it('wallet.js exige Rib-ok explicite pour valider le RIB', () => {
    const src = fs.readFileSync(path.join(__dirname, '../bot/wallet.js'), 'utf8');
    assert.match(src, /async function ficheRibCleared/);
    assert.match(src, /alt="Rib-ok"/);
    assert.match(src, /#icon-list Rib-ok introuvable/);
  });

  it('wallet.js n utilise plus page.content ni regex trop large', () => {
    const src = fs.readFileSync(path.join(__dirname, '../bot/wallet.js'), 'utf8');
    assert.match(src, /veuillez\\s\+enregistrer\\s\+le\\s\+rib/);
    assert.match(src, /#icon-list/);
    assert.doesNotMatch(src, /page\.content\(\)/);
    assert.doesNotMatch(
      src,
      /return \/veuillez\\s\+enregistrer\\s\+le\\s\+rib\|enregistrer\\s\+le\\s\+rib\\s\+du\\s\+membre\|enregistrer le rib\/i/
    );
  });
});
