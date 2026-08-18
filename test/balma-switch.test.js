const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { normalizeOrder, validateOrder, getJobId } = require('../lib/normalize');
const { isOpsOrder } = require('../lib/bot-forward');
const {
  shouldGiftBadgeComptant,
  validateBalmaSwitchPayload,
  inscriptionUrl,
  isAventureHost,
} = require('../lib/balma');
const { parseFrDates, productSearchFromLabel } = require('../bot/migrate-gym');
const { BALMA_WA, fill } = require('../lib/campaign-templates');
const { robotsTxt } = require('../storefront/lib/seo');

test('balma_switch — action, job_id, validation nom/prénom', () => {
  const order = normalizeOrder({
    action: 'balma_switch',
    order_id: 'BALMA-1',
    first_name: 'Lea',
    last_name: 'Martin',
  });
  assert.equal(order.action, 'balma_switch');
  assert.equal(order.gym, 'minimes');
  assert.equal(getJobId(order), 'BALMA-1#balma_switch');
  assert.deepEqual(validateOrder(order), []);
  assert.equal(isOpsOrder(order), true);
});

test('balma_switch — sans nom → erreurs', () => {
  const order = normalizeOrder({ action: 'balma_switch', order_id: 'BALMA-2' });
  const errors = validateOrder(order);
  assert.ok(errors.includes('prénom manquant'));
  assert.ok(errors.includes('nom manquant'));
});

test('isOpsOrder — sale balma_retour n’est pas ops', () => {
  assert.equal(isOpsOrder({ action: 'sale', source: 'balma_retour' }), false);
});

test('badge comptant uniquement source=balma_retour + offre 29', () => {
  assert.equal(
    shouldGiftBadgeComptant({ source: 'balma_retour' }, { id: 'offre-duo' }),
    true
  );
  assert.equal(
    shouldGiftBadgeComptant({ source: 'balma_retour' }, { id: 'offre-saison' }),
    false
  );
  assert.equal(
    shouldGiftBadgeComptant({ source: 'storefront-payplug' }, { id: 'offre-duo' }),
    false
  );
});

test('formulaire aventure — refuse comptant', () => {
  const bad = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    offer: '29',
    prelevement: false,
  });
  assert.ok(bad.errors.length);
  assert.match(bad.errors[0], /prélèvement|comptant|club/i);

  const ok = validateBalmaSwitchPayload({
    prenom: 'Lea',
    nom: 'Martin',
    offer: '259',
    prelevement: true,
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.offer, 'offre-saison');
});

test('redirect inscription 29/259 avec source et préfill', () => {
  const url = inscriptionUrl({
    productId: 'offre-duo',
    firstName: 'Léa',
    lastName: 'Martin',
    boutiqueBase: 'https://boutique.boxingcenter.fr',
  });
  assert.match(url, /product=offre-duo/);
  assert.match(url, /source=balma_retour/);
  assert.match(url, /prenom=/);
  assert.match(url, /nom=Martin/);
});

test('parseFrDates + productSearchFromLabel', () => {
  const d = parseFrDates('OFFRE A 29€ du 01/09/2025 au 29/09/2025');
  assert.equal(d.start, '01/09/2025');
  assert.equal(d.end, '29/09/2025');
  assert.ok(productSearchFromLabel('OFFRE A 29€ du 01/09/2025').includes('OFFRE A 29'));
});

test('robots.txt Disallow /aventure', () => {
  const txt = robotsTxt();
  assert.match(txt, /Disallow: \/aventure/);
});

test('isAventureHost', () => {
  assert.equal(isAventureHost({ headers: { host: 'aventure.boxingcenter.fr' } }), true);
  assert.equal(isAventureHost({ headers: { host: 'boutique.boxingcenter.fr' } }), false);
});

test('12 variantes WhatsApp {prenom}', () => {
  assert.equal(BALMA_WA.length, 12);
  for (const tpl of BALMA_WA) {
    assert.match(tpl, /\{prenom\}/);
    const filled = fill(tpl, { prenom: 'Léa', lien: 'https://aventure.boxingcenter.fr' });
    assert.doesNotMatch(filled, /\{prenom\}/);
    assert.match(filled, /Léa/);
  }
});

test('selectors migration + impayés présents', () => {
  const sel = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'deciplus-selectors.json'), 'utf8')
  );
  assert.ok(sel.member_migrate?.icon);
  assert.ok(sel.member_migrate?.confirm);
  assert.ok(sel.member_unpaid?.delete);
});

test('page aventure noindex', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'aventure.html'),
    'utf8'
  );
  assert.match(html, /noindex/);
});
