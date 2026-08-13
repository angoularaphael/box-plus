/**
 * Essai 10€ + packs coaching → vente Deciplus « Achat carte » comptant (pas badge).
 */
const assert = require('assert');
const {
  isTrialOrder,
  isCarteMerchOrder,
  buildProductConfig,
} = require('../lib/catalog-sale');
const { isBadgeSale } = require('../bot/sale');

const essaiMatched = {
  id: 77,
  title: "SEANCE D'ESSAI",
  price: 10,
  type: 'abo',
  categoryId: 'abo',
};

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
  assert.strictEqual(isBadgeSale(cfgNoMatch), false, 'essai n’est pas une vente Badge');

  // Even if Deciplus catalog types the product as abo, keep Achat carte.
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
  assert.strictEqual(cfgNotBadge.label, "SEANCE D'ESSAI", 'ne pas garder le titre Badge');
  assert.strictEqual(isBadgeSale(cfgNotBadge), false, 'essai ne devient pas Badge même si le catalogue a matché Badge');
  assert.strictEqual(cfgNotBadge.auto_badge, false);

  for (const [id, amount, title] of [
    ['coaching-1', 55, 'COACHING PRIVE 1 SEANCE'],
    ['coaching-5', 250, 'COACHING PRIVE 5 SEANCES'],
    ['coaching-10', 450, 'COACHING PRIVE 10 SEANCES'],
  ]) {
    const order = {
      product_id: id,
      product_name: title,
      sale_type: 'carte',
      deciplus_product_search: 'coaching',
      payment: { amount, method: 'payplug', status: 'paid' },
    };
    assert.strictEqual(isTrialOrder(order), false, `${id} not trial`);
    const cfg = buildProductConfig(order, {
      id: 99,
      title,
      price: amount,
      type: 'abo',
      categoryId: 'abo',
    });
    assert.strictEqual(cfg.sale_type, 'carte', `${id} → carte`);
    assert.strictEqual(cfg.paiement_comptant, true, `${id} comptant`);
    assert.strictEqual(cfg.auto_badge, false, `${id} no auto_badge`);
    assert.strictEqual(isBadgeSale(cfg), false, `${id} pas modale Badge`);
  }

  assert.strictEqual(
    isBadgeSale({ label: 'Badge', sale_type: 'carte', deciplus_product_name: 'Badge' }),
    true,
    'produit Badge reste isBadgeSale'
  );

  // Regression: offre duo PayPlug rib stays abonnement (not forced carte).
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

  const { resolveProductConfig, findProductInCatalog } = require('../bot/catalog');
  const catalog = [
    { id: 12, title: 'Badge', price: 34.99, type: 'decipass' },
    { id: 88, title: '44,99€/4 semaines Sans Engagement', price: 44.99, type: 'abo' },
  ];
  const matched = findProductInCatalog(catalog, paid);
  assert.ok(!matched || !/\bbadge\b/i.test(matched.title), 'findProductInCatalog ne doit pas renvoyer Badge pour un essai');
  const resolved = resolveProductConfig(paid, catalog);
  assert.strictEqual(isBadgeSale(resolved), false);
  assert.strictEqual(resolved.sale_type, 'carte');
  assert.match(String(resolved.label), /essai/i);

  console.log('ok — essai/coaching carte comptant sans badge');
}

run();
