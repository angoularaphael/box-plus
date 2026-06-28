const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.BOXPLUS_QUEUE_DIR = path.join(os.tmpdir(), `boxplus-ps-test-${Date.now()}`);

const { extractGymFromTexts, matchGymSlug, extractIbanFromTexts } = require('../lib/gym-slugs');
const { mapPrestaShopOrder } = require('../lib/prestashop-map');
const {
  saveCheckoutForCart,
  getCheckoutForCart,
  removeCheckoutForCart,
} = require('../lib/prestashop-checkout-store');
const { normalizeOrder, getGymConfig } = require('../lib/normalize');

test('gym-slugs — détecte salle depuis message checkout', () => {
  assert.equal(matchGymSlug('ramonville'), 'ramonville');
  assert.equal(matchGymSlug('Salle: st-cyprien'), 'st-cyprien');
  assert.equal(extractGymFromTexts(['Message client', 'gym=portet']), 'portet');
});

test('gym-slugs — extrait IBAN du message', () => {
  const iban = extractIbanFromTexts(['Merci', 'Mon IBAN FR7630001007941234567890185']);
  assert.equal(iban, 'FR7630001007941234567890185');
});

test('prestashop-map — commande API → payload BOXPLUS', () => {
  const payload = mapPrestaShopOrder(
    {
      id: 42,
      id_cart: '99',
      id_customer: '7',
      id_address_delivery: '3',
      total_paid_tax_incl: '29.000000',
      payment: 'Stripe',
      date_add: '2026-06-28 10:00:00',
      current_state: '2',
      associations: {
        order_rows: {
          order_row: {
            product_name: 'OFFRE A 29€',
            product_reference: 'OFFRE29',
          },
        },
      },
    },
    {
      customer: { firstname: 'Jean', lastname: 'Dupont', email: 'jean@example.com' },
      address: {
        phone_mobile: '0612345678',
        address1: '1 rue Test',
        postcode: '31000',
        city: 'Toulouse',
        alias: 'Mon adresse',
      },
      messages: ['Salle: ramonville'],
      checkoutExtra: {
        gym: 'ramonville',
        iban: 'FR7630001007941234567890185',
        birthdate: '1990-01-01',
        gender: 'M',
      },
    }
  );

  assert.equal(payload.order_id, 'PS-42');
  assert.equal(payload.product_name, 'OFFRE A 29€');
  assert.equal(payload.gym, 'ramonville');
  assert.equal(payload.source, 'prestashop');
  assert.equal(payload.payment.iban, 'FR7630001007941234567890185');
  assert.equal(payload.customer.birthdate, '1990-01-01');
  assert.equal(payload.customer.gender, 'M');

  const order = normalizeOrder(payload);
  assert.equal(getGymConfig(order.gym).deciplus_label, 'Ramonville');
});

test('prestashop-checkout-store — enregistre salle par panier', () => {
  const storePath = require('../lib/prestashop-checkout-store').STORE_FILE;
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });

  saveCheckoutForCart('cart-1', { gym: 'balma', iban: 'FR7630001007941234567890185' });
  const saved = getCheckoutForCart('cart-1');
  assert.equal(saved.gym, 'balma');
  removeCheckoutForCart('cart-1');
  assert.equal(getCheckoutForCart('cart-1'), null);
});
