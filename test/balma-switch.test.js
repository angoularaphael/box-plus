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
  listBalmaPrelevementOffers,
} = require('../lib/balma');
const { parseFrDates, productSearchFromLabel } = require('../bot/migrate-gym');
const { findProductInCatalog } = require('../bot/catalog');
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
    birthdate: '1991-08-10',
    offer: '29',
    prelevement: false,
  });
  assert.ok(bad.errors.length);
  assert.match(bad.errors[0], /prélèvement|comptant|club/i);

  const ok = validateBalmaSwitchPayload({
    prenom: 'Lea',
    nom: 'Martin',
    birthdate: '1991-08-10',
    offer: 'offre-duo',
    prelevement: true,
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.offer, 'offre-duo');
  assert.equal(ok.birthdate, '1991-08-10');

  const saison = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    birthdate: '1991-08-10',
    offer: '259',
    prelevement: true,
  });
  assert.ok(saison.errors.some((e) => /prélèvement/i.test(e)));
});

test('formulaire aventure — date de naissance requise', () => {
  const missing = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    offer: '29',
    prelevement: true,
  });
  assert.ok(missing.errors.some((e) => /naissance/i.test(e)));
});

test('redirect inscription 29/259 avec source et préfill', () => {
  const url = inscriptionUrl({
    productId: 'offre-duo',
    firstName: 'Léa',
    lastName: 'Martin',
    birthdate: '1991-08-10',
    boutiqueBase: 'https://boutique.boxingcenter.fr',
  });
  assert.match(url, /product=offre-duo/);
  assert.match(url, /source=balma_retour/);
  assert.match(url, /prenom=/);
  assert.match(url, /nom=Martin/);
  assert.match(url, /birthdate=1991-08-10/);
});

test('parseFrDates + productSearchFromLabel', () => {
  const d = parseFrDates('OFFRE A 29€ du 01/09/2025 au 29/09/2025');
  assert.equal(d.start, '01/09/2025');
  assert.equal(d.end, '29/09/2025');
  assert.ok(productSearchFromLabel('OFFRE A 29€ du 01/09/2025').includes('OFFRE A 29'));
  const cleaned = productSearchFromLabel(
    'OFFRE DUO 29€ CONTRAT N°C2026-042313 vendu le 18/08/2026'
  );
  assert.match(cleaned, /OFFRE DUO 29/i);
  assert.doesNotMatch(cleaned, /CONTRAT/i);
});

test('catalogue — étudiant 34,99 ne matche pas DUO 29', () => {
  const catalog = [
    { id: 12, title: 'Badge', price: 34.99, type: 'decipass' },
    { id: 104, title: 'OFFRE DUO 29€', price: 29, type: 'abo', categoryId: 'abo' },
    { id: 87, title: 'OFFRE PROMO 34.99€ ETUDIANTS', price: 34.99, type: 'abo', categoryId: 'abo' },
    { id: 88, title: 'OFFRE PROMO 38.99€ ADULTE', price: 38.99, type: 'abo', categoryId: 'abo' },
  ];
  const etu = findProductInCatalog(catalog, {
    product_name: 'OFFRE PROMO 34.99€ ETUDIANTS',
    deciplus_product_search: 'ETUDIANTS 34.99',
    payment: { amount: 34.99 },
  });
  assert.equal(etu?.id, 87);
  const adu = findProductInCatalog(catalog, {
    product_name: 'OFFRE PROMO 38.99€ ADULTE',
    deciplus_product_search: 'ADULTE 38.99',
    payment: { amount: 38.99 },
  });
  assert.equal(adu?.id, 88);
});

test('catalogue — OFFRE A 29 matche OFFRE DUO 29€', () => {
  const matched = findProductInCatalog(
    [
      { id: 12, title: 'Badge', price: 34.99, type: 'decipass' },
      { id: 104, title: 'OFFRE DUO 29€', price: 29, type: 'abo', categoryId: 'abo' },
    ],
    {
      product_name: 'OFFRE A 29',
      deciplus_product_search: 'OFFRE A 29',
      payment: { amount: 29 },
    }
  );
  assert.equal(matched?.id, 104);
});

test('offres aventure — prélèvement uniquement, pas 259', () => {
  const offers = listBalmaPrelevementOffers();
  assert.ok(offers.length >= 1);
  assert.ok(offers.every((o) => !/259|saison|comptant/i.test(`${o.id} ${o.name} ${o.price_label}`)));
  assert.ok(
    offers.some((o) => o.id === 'offre-duo' || o.product_id === 'offre-duo' || /29/.test(o.price_label || ''))
  );
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

test('boutique ne sert plus /aventure', () => {
  const htmlPath = path.join(__dirname, '..', 'storefront', 'public', 'aventure.html');
  assert.equal(fs.existsSync(htmlPath), false);
  const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');
  assert.match(vercel, /aventure\.boxingcenter\.fr/);
});
