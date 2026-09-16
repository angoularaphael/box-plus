#!/usr/bin/env node
/**
 * Probe live/test : tente de créer un paiement Scalapay minimal puis l’abandonne.
 * Usage :
 *   PAYPLUG_SECRET_KEY=sk_… node scripts/probe-payplug-scalapay.js
 *   PAYPLUG_TEST_SECRET_KEY=sk_test_… node scripts/probe-payplug-scalapay.js
 *
 * Ne marque rien comme payé. N’écrit pas en base boutique.
 */
'use strict';

const API_BASE = 'https://api.payplug.com/v1';
const API_VERSION = process.env.PAYPLUG_API_VERSION || '2019-08-06';

async function main() {
  const key =
    process.env.PAYPLUG_SECRET_KEY ||
    process.env.PAYPLUG_TEST_SECRET_KEY ||
    '';
  if (!key) {
    console.error('Manque PAYPLUG_SECRET_KEY ou PAYPLUG_TEST_SECRET_KEY');
    process.exit(2);
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const expectedDelivery = tomorrow.toISOString().slice(0, 10);

  const payload = {
    amount: 500,
    currency: 'EUR',
    payment_method: 'scalapay',
    payment_context: {
      cart: [
        {
          delivery_label: 'Boxing Center',
          delivery_type: 'storepickup',
          brand: 'Boxing Center',
          merchant_item_id: 'probe-scalapay',
          name: 'Probe Scalapay',
          expected_delivery_date: expectedDelivery,
          total_amount: 500,
          price: 500,
          quantity: 1,
        },
      ],
    },
    billing: {
      title: 'mr',
      first_name: 'Probe',
      last_name: 'Scalapay',
      email: 'probe-scalapay@boxingcenter.fr',
      address1: '1 rue du Probe',
      postcode: '31000',
      city: 'Toulouse',
      country: 'FR',
      mobile_phone_number: '+33612345678',
      language: 'fr',
    },
    shipping: {
      title: 'mr',
      first_name: 'Probe',
      last_name: 'Scalapay',
      email: 'probe-scalapay@boxingcenter.fr',
      address1: '1 rue du Probe',
      postcode: '31000',
      city: 'Toulouse',
      country: 'FR',
      language: 'fr',
      mobile_phone_number: '+33612345678',
      delivery_type: 'BILLING',
      company_name: 'Boxing Center',
    },
    hosted_payment: {
      return_url: 'https://boutique.boxingcenter.fr/panier?probe=1',
      cancel_url: 'https://boutique.boxingcenter.fr/panier?probe=cancel',
    },
    metadata: { probe: 'scalapay', order_type: 'materiel' },
  };

  const res = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'PayPlug-Version': API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    console.log('SCALAPAY_API_STATUS=unavailable');
    console.log('http', res.status);
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log('SCALAPAY_API_STATUS=ok');
  console.log('payment_id', body.id);
  console.log('payment_url', body.hosted_payment?.payment_url || null);
  console.log('is_paid', body.is_paid);

  if (body.id) {
    const abort = await fetch(`${API_BASE}/payments/${encodeURIComponent(body.id)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${key}`,
        'PayPlug-Version': API_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ aborted: true }),
    });
    console.log('aborted', abort.ok ? 'yes' : `no (${abort.status})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
