#!/usr/bin/env node
'use strict';

/**
 * Envoie un job essai gratuit (sans vente) vers le bot Deciplus.
 * Usage: node scripts/test-essai-deciplus.js
 */

require('dotenv').config();
const path = require('path');
const { forwardJobToBot } = require('../lib/bot-forward');
const catalogSale = require(path.join(__dirname, '../../boxi-deci-bot/lib/catalog-sale'));
const { isTrialOrder, buildProductConfig } = catalogSale;

async function main() {
  const stamp = Date.now();
  const order = {
    order_id: `TEST-ESSAI-${stamp}`,
    action: 'sale',
    product_id: 'seance-essai',
    product_name: "Séance d'essai gratuite",
    deciplus_product_search: 'essai',
    sale_type: 'none',
    requires_iban: false,
    gym: 'minimes',
    customer: {
      first_name: 'TestEssai',
      last_name: `Boxplus${String(stamp).slice(-6)}`,
      email: `test.essai.${stamp}@example.com`,
      // Téléphone unique — évite de « matcher » un autre membre Deciplus
      phone: `06${String(stamp).slice(-8)}`,
      birthdate: '1995-06-15',
      gender: 'M',
      address: '12 rue de la Boxe',
      postal_code: '31000',
      city: 'Toulouse',
      country: 'FR',
    },
    payment: {
      amount: 0,
      method: 'free',
      status: 'paid',
      date: new Date().toISOString(),
    },
    source: 'storefront-free-test',
  };

  const cfg = buildProductConfig(order, null);
  console.log('isTrialOrder', isTrialOrder(order));
  console.log('productConfig', {
    sale_type: cfg.sale_type,
    create_sale: cfg.create_sale,
    requires_payment: cfg.requires_payment,
  });

  if (!process.env.BOXPLUS_BOT_URL) {
    console.error('BOXPLUS_BOT_URL manquant — job non envoyé');
    process.exit(1);
  }

  console.log('Envoi vers', process.env.BOXPLUS_BOT_URL);
  const result = await forwardJobToBot(order);
  console.log('Résultat bot:', JSON.stringify(result, null, 2));
  console.log(`\nCherche ensuite dans Deciplus: ${order.customer.last_name} / ${order.customer.email}`);
  console.log('Attendu: fiche membre créée, AUCUNE vente.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
