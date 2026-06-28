const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.env.BOXPLUS_QUEUE_DIR = path.join(os.tmpdir(), `boxplus-queue-test-${Date.now()}`);
process.env.BOXPLUS_LOG_DIR = path.join(os.tmpdir(), `boxplus-logs-test-${Date.now()}`);

const { normalizeOrder, validateOrder, validateCancelOrder, getJobId, getGymConfig } = require('../lib/normalize');
const { resolveProductConfig, buildProductConfig, isTrialOrder, resolveBadgeProductConfig, findBadgeProduct } = require('../bot/catalog');
const { enqueue, isProcessed, markProcessed, listPending, STATUS } = require('../lib/queue');

const MOCK_CATALOG = [
  { id: 42, title: 'OFFRE A 29€', type: 'abo', categoryId: 'abo', price: 29 },
  { id: 10, title: 'Badge', type: 'decipass', categoryId: 'decipass', price: 34.99 },
  { id: 99, title: 'OFFRE PROMO 12 MOIS', type: 'abo', categoryId: 'abo', price: 295 },
];

test('normalizeOrder mappe les champs PrestaShop', () => {
  const order = normalizeOrder({
    order_id: 'PS-100',
    product_name: 'OFFRE A 29€',
    gym: 'minimes',
    customer: {
      prenom: 'Jean',
      nom: 'Dupont',
      email: 'Jean@Example.com',
      telephone: '0612345678',
      sexe: 'homme',
    },
    payment: { montant: 29, statut: 'paid', moyen: 'card', iban: 'FR7630001007941234567890185' },
    utm: { utm_source: 'facebook' },
  });

  assert.equal(order.order_id, 'PS-100');
  assert.equal(order.product_name, 'OFFRE A 29€');
  assert.equal(order.customer.first_name, 'Jean');
  assert.equal(order.customer.email, 'jean@example.com');
  assert.equal(order.customer.phone, '+33612345678');
  assert.equal(order.customer.gender, 'M');
  assert.equal(order.payment.amount, 29);
  assert.equal(order.utm.source, 'facebook');
});

test('normalizeOrder accepte salle (alias PrestaShop) → slug gym', () => {
  const order = normalizeOrder({
    order_id: 'PS-101',
    product_name: 'OFFRE A 29€',
    salle: 'Ramonville',
    customer: { first_name: 'A', last_name: 'B', email: 'a@b.fr', phone: '0600000000' },
    payment: { amount: 29, status: 'paid', iban: 'FR7630001007941234567890185' },
  });
  assert.equal(order.gym, 'ramonville');
  assert.equal(getGymConfig(order.gym).deciplus_label, 'Ramonville');
});

test('validateOrder détecte les champs manquants', () => {
  const bad = normalizeOrder({ product_name: 'OFFRE A 29€' });
  const errors = validateOrder(bad);
  assert.ok(errors.includes('order_id manquant'));
  assert.ok(errors.includes('prénom manquant'));
});

test('enqueue respecte idempotence', () => {
  const payload = normalizeOrder({
    order_id: 'PS-IDEM-1',
    product_name: 'OFFRE A 29€',
    gym: 'minimes',
    customer: { first_name: 'A', last_name: 'B', email: 'a@b.fr', phone: '0600000000' },
    payment: { amount: 29, status: 'paid', iban: 'FR7630001007941234567890185' },
  });

  const first = enqueue(payload);
  assert.equal(first.queued, true);

  markProcessed('PS-IDEM-1', { status: STATUS.SUCCESS });

  const second = enqueue(payload);
  assert.equal(second.queued, false);
  assert.equal(second.reason, 'already_processed');
  assert.equal(isProcessed('PS-IDEM-1'), true);
});

test('résolution automatique produit Deciplus', () => {
  const order = normalizeOrder({
    order_id: 'PS-200',
    product_name: 'OFFRE A 29€',
    payment: { amount: 29, status: 'paid', iban: 'FR7630001007941234567890185' },
    customer: { first_name: 'A', last_name: 'B', email: 'a@b.fr', phone: '0600000000' },
  });

  const product = resolveProductConfig(order, MOCK_CATALOG);
  assert.equal(product.deciplus_product_name, 'OFFRE A 29€');
  assert.equal(product.sale_type, 'abonnement');
  assert.equal(product.requires_iban, true);
  assert.equal(product.paiement_comptant, false);
  assert.equal(product.auto_badge, true);

  const badgeCfg = resolveBadgeProductConfig(MOCK_CATALOG);
  assert.equal(badgeCfg.deciplus_product_name, 'Badge');
  assert.equal(badgeCfg.sale_type, 'carte');
  assert.equal(findBadgeProduct(MOCK_CATALOG).id, 10);

  const badgeOrder = normalizeOrder({
    order_id: 'PS-201',
    product_name: 'Badge',
    payment: { amount: 34.99, status: 'paid', iban: 'FR7630001007941234567890185' },
    customer: { first_name: 'A', last_name: 'B', email: 'a@b.fr', phone: '0600000000' },
  });
  const badge = resolveProductConfig(badgeOrder, MOCK_CATALOG);
  assert.equal(badge.sale_type, 'carte');

  const trial = buildProductConfig(
    normalizeOrder({ product_name: 'Séance essai', payment: { amount: 0 } }),
    null
  );
  assert.equal(trial.sale_type, 'none');
  assert.equal(isTrialOrder(normalizeOrder({ product_name: 'essai gratuit', payment: { amount: 0 } })), true);

  const gym = getGymConfig('st-cyprien');
  assert.equal(gym.deciplus_label, 'St-Cyprien');
});

test('annulation — job_id et validation', () => {
  const cancel = normalizeOrder({
    action: 'cancel',
    order_id: 'PS-500',
    customer: { first_name: 'Ann', last_name: 'Ul', email: 'ann@example.com', phone: '0600000000' },
    payment: { status: 'cancelled', amount: 29 },
  });

  assert.equal(cancel.action, 'cancel');
  assert.equal(getJobId(cancel), 'PS-500#cancel');
  assert.deepEqual(validateCancelOrder(cancel), []);

  const bad = normalizeOrder({ action: 'cancel', order_id: 'PS-501' });
  const errors = validateCancelOrder(bad);
  assert.ok(errors.includes('deciplus_member_id ou email/téléphone requis pour annulation'));
});

test('generate-report extrait endpoints', () => {
  const sampleSession = {
    id: 'test-session',
    scenario: 'login',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    milestones: [{ name: 'login-success', ts: new Date().toISOString(), url: 'https://manager.deciplus.pro/' }],
    network: [
      {
        phase: 'response',
        method: 'POST',
        url: 'https://manager.deciplus.pro/api/members',
        status: 200,
        body: '{"id":123}',
        body_json: { id: 123 },
      },
    ],
    dom_events: [{ event: 'click', selector: 'button#submit' }],
    pages: [],
    screenshots: [],
  };

  const outDir = path.join(ROOT, 'analyzer', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const sampleFile = path.join(outDir, 'session-sample-test.har.json');
  fs.writeFileSync(sampleFile, JSON.stringify(sampleSession, null, 2));

  const { execSync } = require('child_process');
  execSync(`node analyzer/generate-report.js session-sample-test.har.json`, {
    cwd: ROOT,
    stdio: 'pipe',
  });

  assert.ok(fs.existsSync(path.join(outDir, 'deciplus-api-map.md')));
  assert.ok(fs.existsSync(path.join(outDir, 'deciplus-selectors.json')));
});
