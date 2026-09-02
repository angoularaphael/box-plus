/**
 * Essai 10€ + packs coaching → vente Deciplus « Achat Carte » comptant (pas Badge).
 */
const assert = require('assert');
const {
  isTrialOrder,
  isCarteMerchOrder,
  isCartePrestationOrder,
  isCartePrestationConfig,
  isBadgeProductConfig,
  isDeciplusBadgeLabel,
  resolvePrestationHint,
  prestationForbidsBadge,
  pickBestCatalogTile,
  buildProductConfig,
} = require('../lib/catalog-sale');
const { isBadgeSale } = require('../bot/sale');
const { resolveProductConfig, findProductInCatalog } = require('../bot/catalog');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { normalizeOrder } = require('../lib/normalize');
const { productNeedsAutoBadge } = require('../lib/billing-plan');

const essaiMatched = {
  id: 77,
  title: "SEANCE D'ESSAI",
  price: 10,
  type: 'abo',
  categoryId: 'abo',
};

const catalogWithTrap = [
  { id: 12, title: 'Badge', price: 34.99, type: 'decipass' },
  { id: 88, title: '44,99€/4 semaines Sans Engagement', price: 44.99, type: 'abo' },
  { id: 77, title: "SEANCE D'ESSAI", price: 10, type: 'abo' },
  { id: 201, title: 'COACHING PRIVE 1 SEANCE', price: 55, type: 'abo' },
  { id: 205, title: 'COACHING PRIVE 5 SEANCES', price: 250, type: 'abo' },
  { id: 210, title: 'COACHING PRIVE 10 SEANCES', price: 450, type: 'abo' },
];

function paidEssaiOrder(overrides = {}) {
  return {
    product_id: 'seance-essai',
    product_name: "SEANCE D'ESSAI",
    sale_type: 'carte',
    deciplus_product_search: 'essai',
    payment: { amount: 10, method: 'payplug', status: 'paid' },
    ...overrides,
  };
}

function run() {
  const paid = paidEssaiOrder();
  assert.strictEqual(isTrialOrder(paid), false, 'paid essai must NOT be free trial');
  assert.strictEqual(isCarteMerchOrder(paid), true, 'paid essai is carte merch');
  assert.strictEqual(isCartePrestationOrder(paid), true, 'paid essai is prestation carte');
  assert.strictEqual(isDeciplusBadgeLabel('Badge'), true);
  assert.strictEqual(isDeciplusBadgeLabel("Achat Carte — SEANCE D'ESSAI"), false);
  assert.strictEqual(isDeciplusBadgeLabel('COACHING PRIVE 1 SEANCE'), false);

  const free = {
    product_name: "SEANCE D'ESSAI",
    sale_type: 'none',
    payment: { amount: 0, status: 'paid' },
  };
  assert.strictEqual(isTrialOrder(free), true, '0€ essai is free trial');

  const cfgNoMatch = buildProductConfig(paid, null);
  assert.strictEqual(cfgNoMatch.sale_type, 'carte', 'unmatched paid essai → carte');
  assert.strictEqual(cfgNoMatch.create_sale, true);
  assert.strictEqual(cfgNoMatch.paiement_comptant, true);
  assert.strictEqual(cfgNoMatch.requires_iban, false);
  assert.strictEqual(cfgNoMatch.auto_badge, false);
  assert.match(String(cfgNoMatch.deciplus_product_search), /essai/i);
  assert.match(String(cfgNoMatch.label), /essai/i);
  assert.strictEqual(isBadgeSale(cfgNoMatch), false, 'essai n’est pas une vente Badge');
  assert.strictEqual(isCartePrestationConfig(cfgNoMatch), true);
  assert.strictEqual(prestationForbidsBadge(cfgNoMatch), true);
  assert.strictEqual(prestationForbidsBadge(paid), true);

  const cfgMatched = buildProductConfig(paid, essaiMatched);
  assert.strictEqual(cfgMatched.sale_type, 'carte', 'matched essai typed abo → still carte');
  assert.strictEqual(cfgMatched.paiement_comptant, true);
  assert.strictEqual(cfgMatched.auto_badge, false);
  assert.strictEqual(isBadgeSale(cfgMatched), false);

  const badgeTrap = {
    id: 12,
    title: 'Badge',
    price: 34.99,
    type: 'decipass',
    categoryId: 'decipass',
  };
  const cfgNotBadge = buildProductConfig(paid, badgeTrap);
  assert.match(String(cfgNotBadge.label), /essai/i, 'ne pas garder le titre Badge');
  assert.strictEqual(isBadgeSale(cfgNotBadge), false, 'essai ne devient pas Badge même si le catalogue a matché Badge');
  assert.strictEqual(isBadgeProductConfig({ ...cfgNotBadge, label: 'Badge', product_id: 'seance-essai' }), false);
  assert.strictEqual(cfgNotBadge.auto_badge, false);

  const wrongAbo = buildProductConfig(paid, {
    id: 88,
    title: '44,99€/4 semaines Sans Engagement',
    price: 44.99,
    type: 'abo',
  });
  assert.match(String(wrongAbo.label), /essai/i, 'ne pas vendre un abo 4 sem. pour un essai');
  assert.strictEqual(isBadgeSale(wrongAbo), false);

  for (const [id, amount, title, search] of [
    ['coaching-1', 55, 'COACHING PRIVE 1 SEANCE', /COACHING PRIVE 1/i],
    ['coaching-5', 250, 'COACHING PRIVE 5 SEANCES', /COACHING PRIVE 5/i],
    ['coaching-10', 450, 'COACHING PRIVE 10 SEANCES', /COACHING PRIVE 10/i],
  ]) {
    const order = {
      product_id: id,
      product_name: title,
      sale_type: 'carte',
      deciplus_product_search: resolvePrestationHint({ product_id: id }).search,
      payment: { amount, method: 'payplug', status: 'paid' },
    };
    assert.strictEqual(isTrialOrder(order), false, `${id} not trial`);
    assert.strictEqual(isCartePrestationOrder(order), true, `${id} prestation`);
    const cfg = buildProductConfig(order, {
      id: 12,
      title: 'Badge',
      price: 34.99,
      type: 'decipass',
    });
    assert.strictEqual(cfg.sale_type, 'carte', `${id} → carte`);
    assert.strictEqual(cfg.paiement_comptant, true, `${id} comptant`);
    assert.strictEqual(cfg.auto_badge, false, `${id} no auto_badge`);
    assert.strictEqual(isBadgeSale(cfg), false, `${id} pas modale Badge`);
    assert.match(String(cfg.label), /coaching/i, `${id} label coaching`);
    assert.match(String(cfg.deciplus_product_search), search, `${id} search spécifique`);
  }

  assert.strictEqual(
    isBadgeSale({ label: 'Badge', sale_type: 'carte', deciplus_product_name: 'Badge' }),
    true,
    'produit Badge reste isBadgeSale'
  );

  const duo = buildProductConfig(
    {
      product_id: 'offre-duo',
      product_name: 'Offre Duo 29',
      sale_type: 'abonnement',
      payment: { amount: 29, method: 'payplug', billing_plan: 'rib' },
    },
    { id: 104, title: 'OFFRE DUO', price: 29 }
  );
  assert.strictEqual(duo.sale_type, 'abonnement', 'duo stays abonnement');
  assert.strictEqual(duo.paiement_comptant, false, 'duo not comptant');

  const matched = findProductInCatalog(catalogWithTrap, paid);
  assert.ok(matched);
  assert.match(String(matched.title), /essai/i);
  assert.ok(!isDeciplusBadgeLabel(matched.title), 'findProductInCatalog ne doit pas renvoyer Badge pour un essai');
  const resolved = resolveProductConfig(paid, catalogWithTrap);
  assert.strictEqual(isBadgeSale(resolved), false);
  assert.strictEqual(resolved.sale_type, 'carte');
  assert.match(String(resolved.label), /essai/i);

  for (const id of ['coaching-1', 'coaching-5', 'coaching-10']) {
    const hint = resolvePrestationHint({ product_id: id });
    const order = {
      product_id: id,
      product_name: hint.label,
      sale_type: 'carte',
      deciplus_product_search: hint.search,
      payment: { amount: hint.amount, method: 'payplug', status: 'paid' },
    };
    const cfg = resolveProductConfig(order, catalogWithTrap);
    assert.strictEqual(cfg.sale_type, 'carte', `${id} resolve carte`);
    assert.strictEqual(isBadgeSale(cfg), false, `${id} resolve pas Badge`);
    assert.match(String(cfg.label), /coaching/i, `${id} resolve label`);
  }

  const essaiProduct = findEnrichedProduct('seance-essai');
  assert.ok(essaiProduct);
  assert.equal(essaiProduct.sale_type, 'carte');
  assert.equal(essaiProduct.auto_badge, false, 'essai merch auto_badge false');
  assert.equal(productNeedsAutoBadge(essaiProduct), false, 'essai ne déclenche pas le Badge');
  assert.match(String(essaiProduct.deciplus_product_search), /essai/i);
  const fakeLifecycle = {
    order_id: 'BC-TEST-ESSAI',
    customer_short: {
      first_name: 'A',
      last_name: 'B',
      email: 'a@b.c',
      phone: '0612345678',
      birthdate: '1990-01-01',
    },
    customer_full: { gym: 'minimes', gender: 'M', address: '1 rue', postal_code: '31000', city: 'Toulouse' },
    payment: { status: 'paid', method: 'payplug', amount: 10 },
    documents: {},
  };
  const payload = buildOrderFromLifecycle(fakeLifecycle, essaiProduct);
  assert.equal(payload.sale_type, 'carte', 'dispatch essai = Achat Carte');
  assert.match(String(payload.deciplus_product_search || ''), /essai/i);
  const norm = normalizeOrder(payload);
  assert.strictEqual(isCartePrestationOrder(norm), true);
  const fromDispatch = resolveProductConfig(norm, catalogWithTrap);
  assert.strictEqual(isBadgeSale(fromDispatch), false, 'payload boutique → pas Badge');
  assert.strictEqual(fromDispatch.sale_type, 'carte');

  for (const id of ['coaching-1', 'coaching-5', 'coaching-10']) {
    const p = findEnrichedProduct(id);
    assert.ok(p, id);
    assert.equal(p.sale_type, 'carte', `${id} merch sale_type carte`);
    assert.equal(p.auto_badge, false, `${id} merch auto_badge false`);
    assert.equal(productNeedsAutoBadge(p), false, `${id} ne déclenche pas le Badge`);
    assert.match(String(p.deciplus_product_search), /COACHING PRIVE/i, `${id} search pack`);
    const coachPayload = buildOrderFromLifecycle(
      { ...fakeLifecycle, order_id: `BC-TEST-${id}`, payment: { status: 'paid', method: 'payplug', amount: p.price_cents / 100 } },
      p
    );
    assert.equal(coachPayload.sale_type, 'carte', `${id} dispatch carte`);
    const coachCfg = resolveProductConfig(normalizeOrder(coachPayload), catalogWithTrap);
    assert.strictEqual(isBadgeSale(coachCfg), false, `${id} dispatch pas Badge`);
    assert.match(String(coachCfg.label), /coaching/i, `${id} dispatch label`);
  }

  const cartesPrepayeesGrid = [
    "SEANCE D'ESSAI\n10,00€",
    'Coaching privé 1...\n55,00€',
    'Coaching privé 5...\n250,00€',
    'Coaching privé 1...\n450,00€',
    'Badge\n34,99€',
  ];
  const essaiPick = pickBestCatalogTile(
    cartesPrepayeesGrid,
    buildProductConfig(paid, essaiMatched)
  );
  assert.match(String(essaiPick.text), /essai/i, 'grille Cartes prépayées → SEANCE D\'ESSAI');
  assert.ok(!/badge/i.test(String(essaiPick.text)), 'essai ne clique pas Badge');

  const coachingPicks = [
    ['coaching-1', /55,00/],
    ['coaching-5', /250,00/],
    ['coaching-10', /450,00/],
  ];
  for (const [id, price] of coachingPicks) {
    const hint = resolvePrestationHint({ product_id: id });
    const cfg = buildProductConfig(
      {
        product_id: id,
        product_name: hint.label,
        sale_type: 'carte',
        deciplus_product_search: hint.search,
        payment: { amount: hint.amount, method: 'payplug', status: 'paid' },
      },
      null
    );
    const pick = pickBestCatalogTile(cartesPrepayeesGrid, cfg);
    assert.match(String(pick.text), /coaching/i, `${id} clique coaching`);
    assert.match(String(pick.text), price, `${id} départagé par le prix (titres tronqués)`);
    assert.ok(!/badge/i.test(String(pick.text)), `${id} ne clique pas Badge`);
    assert.ok(!/essai/i.test(String(pick.text)), `${id} ne clique pas essai`);
  }

  const aboGrid = [
    'OFFRE PROMO 12MOIS 259,00€',
    'OFFRE PROMO 12MOIS — 4× sans frais 259,00€',
    'OFFRE PROMO 12MOIS 1 ACTIF, 3 EN ATTENTE 64,75€',
    '259€ EN 4X PRELEVEMENT 259,00€',
    'Offre 259€ / 4 fois 259,00€',
  ];
  const cash259 = pickBestCatalogTile(aboGrid, {
    deciplus_product_name: 'OFFRE PROMO 12 MOIS',
    amount: 259,
    paiement_comptant: true,
  });
  assert.match(String(cash259.text), /OFFRE PROMO 12MOIS 259/i);
  assert.ok(!/4×|4x|4 fois/i.test(String(cash259.text)), 'comptant ne prend pas la tuile 4×');

  console.log('ok — essai/coaching Achat Carte (pas Badge), grille Cartes prépayées');
}

run();
