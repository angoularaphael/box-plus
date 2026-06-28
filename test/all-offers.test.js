/**
 * Tests bout en bout pour chaque offre du catalogue live.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.BOXPLUS_QUEUE_DIR = path.join(os.tmpdir(), `boxplus-offers-q-${Date.now()}`);
process.env.BOXPLUS_LOG_DIR = path.join(os.tmpdir(), `boxplus-offers-log-${Date.now()}`);

const { getStoreProducts } = require('../storefront/lib/deciplus-sync');
const { findProduct } = require('../storefront/server');
const { buildOrderPayload, validateCheckoutForm } = require('../storefront/lib/orders');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const {
  resolveProductConfig,
  buildDeciplusProductSearch,
  isTrialOrder,
} = require('../bot/catalog');

const { uniqueTestCustomer, VALID_TEST_IBAN } = require('../lib/test-fixtures');

const SAMPLE = uniqueTestCustomer('offres-unit');

function sampleFormFor(product) {
  const form = { ...SAMPLE };
  if (product.requires_iban) {
    form.iban = VALID_TEST_IBAN;
  }
  return form;
}

function toBotCatalog(storeProducts) {
  return storeProducts
    .filter((p) => p.deciplus_id)
    .map((p) => ({
      id: p.deciplus_id,
      title: p.name,
      type: p.type || 'abo',
      categoryId: p.type === 'seances' ? 'decipass' : p.type || 'abo',
      categoryTitle: p.category,
      price: Number(p.deciplus_price ?? p.price_cents / 100),
      reference: p.reference || null,
    }));
}

function loadAllOffers() {
  const catalog = getStoreProducts();
  assert.ok(catalog.products?.length, 'catalogue live requis (data/storefront/catalog-live.json)');
  return catalog.products;
}

test('catalogue — toutes les offres sont chargées', () => {
  const products = loadAllOffers();
  assert.ok(products.length >= 15, `au moins 15 offres attendues, got ${products.length}`);
});

test('chaque offre — checkout, validation BOXPLUS et résolution Deciplus', () => {
  const products = loadAllOffers();
  const botCatalog = toBotCatalog(products);
  const failures = [];

  for (const product of products) {
    const label = `${product.id} · ${product.name}`;

    try {
      assert.ok(findProduct(product.id), `[findProduct] ${label}`);
      if (product.legacy_id) {
        assert.ok(findProduct(product.legacy_id), `[legacy_id] ${product.legacy_id}`);
      }

      const form = sampleFormFor(product);
      const formErrors = validateCheckoutForm(form, product);
      assert.equal(formErrors.length, 0, `[validateCheckoutForm] ${label}: ${formErrors.join(', ')}`);

      const payload = buildOrderPayload(
        { ...form, order_id: `TEST-${product.id}`, payment_method: 'demo' },
        product
      );
      assert.equal(payload.product_name, product.name, `[buildOrderPayload] name ${label}`);
      assert.equal(payload.payment.amount, product.price_cents / 100, `[buildOrderPayload] amount ${label}`);

      const order = normalizeOrder(payload);
      const orderErrors = validateOrder(order);
      assert.equal(orderErrors.length, 0, `[validateOrder] ${label}: ${orderErrors.join(', ')}`);

      if (isTrialOrder(order) || product.price_cents === 0) {
        const cfg = resolveProductConfig(order, botCatalog);
        assert.equal(cfg.sale_type, 'none', `[resolveProductConfig essai] ${label}`);
      } else {
        assert.ok(product.deciplus_id, `[deciplus_id] ${label}`);
        const cfg = resolveProductConfig(order, botCatalog);
        assert.ok(cfg.deciplus_product_id, `[resolveProductConfig] id ${label}`);
        assert.equal(String(cfg.deciplus_product_id), String(product.deciplus_id), `[match id] ${label}`);
        assert.ok(cfg.deciplus_product_search, `[search] ${label}`);
        const search = buildDeciplusProductSearch(product.name, product.deciplus_id);
        assert.ok(search.length >= 2, `[buildDeciplusProductSearch] ${label}: "${search}"`);
        assert.ok(search.length <= 40, `[search length] ${label}`);
      }
    } catch (err) {
      failures.push({ product: label, error: err.message });
    }
  }

  if (failures.length) {
    const report = failures.map((f) => `  ✗ ${f.product}\n    ${f.error}`).join('\n');
    assert.fail(`${failures.length}/${products.length} offre(s) en échec:\n${report}`);
  }
});

test('offres clés — recherche Deciplus adaptée', () => {
  const cases = [
    ['Cours illimités - Training camp - 49.99€/4sem', 99, '49.99'],
    ['58€/ 4 semaines TRAINING CAMP', 94, '58'],
    ['ASSOCIATION SPORTIVE BOXING CENTER', 80, 'ASSOCIATION'],
    ['OFFRE A 29€', 104, 'OFFRE A 29'],
    ['COMPTANT 12 MOIS', 22, 'COMPTANT 12 MOIS'],
    ['OFFRE PROMO 34.99€ ETUDIANTS', 103, '34.99'],
    ['Badge', 84, 'Badge'],
  ];

  for (const [name, id, expectedPart] of cases) {
    const search = buildDeciplusProductSearch(name, id);
    assert.ok(
      search.toLowerCase().includes(expectedPart.toLowerCase()) || search === expectedPart,
      `"${name}" → "${search}" (attendu contient "${expectedPart}")`
    );
  }
});

test('intégration API demo — toutes les offres (si boutique :3040)', async () => {
  const products = loadAllOffers();
  const base = process.env.STORE_TEST_URL || 'http://localhost:3040';
  let reachable = false;

  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(2000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }

  if (!reachable) {
    console.log('  (skip API live — boutique non démarrée sur :3040)');
    return;
  }

  const failures = [];

  for (const product of products) {
    const body = {
      product_id: product.id,
      ...uniqueTestCustomer(`demo-${product.id}`),
    };
    if (product.requires_iban) body.iban = VALID_TEST_IBAN;

    try {
      const res = await fetch(`${base}/api/checkout/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const err = data.errors?.join(', ') || data.error || res.status;
        failures.push({ id: product.id, name: product.name, error: err });
      }
    } catch (err) {
      failures.push({ id: product.id, name: product.name, error: err.message });
    }
  }

  if (failures.length) {
    const report = failures.map((f) => `  ✗ ${f.id} ${f.name}: ${f.error}`).join('\n');
    assert.fail(`API demo ${failures.length}/${products.length} échec(s):\n${report}`);
  }
});
