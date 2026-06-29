const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');

const CATALOG_FILE = path.join(ROOT, 'data', 'storefront', 'materiel-catalog.json');
const {
  validateCartLines,
  validateCustomerForm,
  buildStripeLineItems,
  createMaterielOrder,
  markMaterielPaid,
  ORDERS_DIR,
} = require('../storefront/lib/materiel-cart');
const { getMaterielProducts, findMaterielProduct } = require('../storefront/lib/merch');
const { buildMaterielConfirmationHtml } = require('../storefront/lib/mailer');

test('materiel catalog importé depuis prestashop', () => {
  assert.ok(fs.existsSync(CATALOG_FILE));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  assert.ok(catalog.count >= 40);
  assert.ok(catalog.products.length >= 40);
  assert.ok(catalog.products.every((p) => p.id.startsWith('mat-')));
  assert.ok(catalog.products.filter((p) => p.image).length >= 40);
});

test('getMaterielProducts filtre par catégorie', () => {
  const all = getMaterielProducts({ activeOnly: true });
  assert.ok(all.length >= 40);
  const gants = getMaterielProducts({ category: 'gants', activeOnly: true });
  assert.ok(gants.length >= 1);
  gants.forEach((p) => assert.equal(p.category, 'gants'));
});

test('findMaterielProduct par id', () => {
  const products = getMaterielProducts({ activeOnly: true });
  const first = products[0];
  const found = findMaterielProduct(first.id);
  assert.equal(found.id, first.id);
  assert.equal(found.sale_type, 'materiel');
});

test('validateCartLines refuse panier vide', () => {
  const { errors } = validateCartLines([]);
  assert.ok(errors.includes('Panier vide'));
});

test('validateCartLines résout produit et calcule total', () => {
  const product = getMaterielProducts({ activeOnly: true })[0];
  const variantId = product.default_variant_id || product.combinations?.[0]?.id;
  const { errors, items, total_cents } = validateCartLines([
    { product_id: product.id, variant_id: variantId, qty: 2 },
  ]);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
  assert.ok(total_cents > 0);
});

test('buildStripeLineItems multi-produits', () => {
  const lines = buildStripeLineItems([
    {
      name: 'Gants',
      variant_label: '12 oz',
      unit_cents: 2499,
      qty: 1,
      product_id: 'mat-83',
      variant_id: 1833,
    },
    {
      name: 'Bandes',
      variant_label: '',
      unit_cents: 670,
      qty: 2,
      product_id: 'mat-37',
      variant_id: 1333,
    },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].quantity, 1);
  assert.equal(lines[0].price_data.unit_amount, 2499);
  assert.equal(lines[1].quantity, 2);
});

test('validateCustomerForm exige coordonnées et retrait', () => {
  const errors = validateCustomerForm({});
  assert.ok(errors.some((e) => e.includes('Prénom')));
  assert.ok(errors.some((e) => e.includes('retrait')));
  assert.equal(
    validateCustomerForm({
      first_name: 'Jean',
      last_name: 'Dupont',
      email: 'jean@example.com',
      phone: '0612345678',
      pickup_gym: 'Minimes',
    }).length,
    0
  );
});

test('commande matériel mark paid et email html', () => {
  const prevDir = process.env.BOXPLUS_MATERIEL_ORDERS_DIR;
  process.env.BOXPLUS_MATERIEL_ORDERS_DIR = path.join(ROOT, 'data', 'storefront', 'materiel-orders-test');
  fs.mkdirSync(process.env.BOXPLUS_MATERIEL_ORDERS_DIR, { recursive: true });

  const order = createMaterielOrder({
    customer: {
      first_name: 'Jean',
      last_name: 'Dupont',
      email: 'jean@example.com',
      phone: '0612345678',
      pickup_gym: 'Minimes',
    },
    pickup_gym: 'Minimes',
    items: [
      {
        product_id: 'mat-37',
        variant_id: 1333,
        name: 'Bandes',
        variant_label: '2,50m',
        qty: 1,
        unit_cents: 670,
        line_total_cents: 670,
      },
    ],
    total_cents: 670,
  });

  const paid = markMaterielPaid(order.order_id, { method: 'demo' });
  assert.equal(paid.payment.status, 'paid');

  const html = buildMaterielConfirmationHtml(paid);
  assert.ok(html.includes('Bandes'));
  assert.ok(html.includes('Minimes'));
  assert.ok(html.includes(paid.order_id));

  if (prevDir) process.env.BOXPLUS_MATERIEL_ORDERS_DIR = prevDir;
  else delete process.env.BOXPLUS_MATERIEL_ORDERS_DIR;
});
