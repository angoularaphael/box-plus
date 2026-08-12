#!/usr/bin/env node
'use strict';

/**
 * Vérifie / envoie un job séance d'essai 10 € (achat carte Deciplus).
 * Usage: node scripts/test-essai-deciplus.js
 */

require('dotenv').config();
const path = require('path');
const { forwardJobToBot } = require('../lib/bot-forward');
const { isTrialOrder, buildProductConfig } = require('../lib/catalog-sale');

async function main() {
  const stamp = Date.now();
  const order = {
    order_id: `TEST-ESSAI-${stamp}`,
    action: 'sale',
    product_id: 'seance-essai',
    product_name: "SEANCE D'ESSAI",
    deciplus_product_search: 'essai',
    sale_type: 'carte',
    requires_iban: false,
    gym: 'minimes',
    customer: {
      first_name: 'TestEssai',
      last_name: `Boxplus${String(stamp).slice(-6)}`,
      email: `test.essai.${stamp}@example.com`,
      phone: `06${String(stamp).slice(-8)}`,
      birthdate: '1995-06-15',
      gender: 'M',
      address: '12 rue de la Boxe',
      postal_code: '31000',
      city: 'Toulouse',
      country: 'FR',
    },
    payment: {
      amount: 10,
      method: 'payplug',
      status: 'paid',
      date: new Date().toISOString(),
    },
    source: 'storefront-essai-10-test',
  };

  const cfg = buildProductConfig(order, null);
  console.log('isTrialOrder', isTrialOrder(order));
  console.log('productConfig', {
    sale_type: cfg.sale_type,
    create_sale: cfg.create_sale,
    requires_payment: cfg.requires_payment,
    paiement_comptant: cfg.paiement_comptant,
    amount: cfg.amount,
  });

  if (isTrialOrder(order) || cfg.sale_type !== 'carte') {
    console.error('Attendu: essai payant en vente carte — config incorrecte');
    process.exit(1);
  }

  if (!process.env.BOXPLUS_BOT_URL) {
    console.log('BOXPLUS_BOT_URL manquant — config locale OK, job non envoyé');
    process.exit(0);
  }

  console.log('Envoi vers', process.env.BOXPLUS_BOT_URL);
  const result = await forwardJobToBot(order);
  console.log('Résultat bot:', JSON.stringify(result, null, 2));
  console.log(`\nCherche ensuite dans Deciplus: ${order.customer.last_name} / ${order.customer.email}`);
  console.log('Attendu: fiche membre + vente carte SEANCE D\'ESSAI 10 € (Paiement Comptant).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
