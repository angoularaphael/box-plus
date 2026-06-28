#!/usr/bin/env node
/**
 * Sync live Deciplus → boutique + validation
 * Usage: node storefront/scripts/sync-and-test.js
 */
require('dotenv').config();

const { launchBrowser, login, saveSession } = require('../../bot/auth');
const { fetchDeciplusCatalog } = require('../../bot/catalog');
const {
  deciplusToStorefront,
  saveSyncedCatalog,
  validateSync,
  compareWithStatic,
} = require('../lib/deciplus-sync');
const { findProductInCatalog } = require('../../bot/catalog');

async function main() {
  console.log('=== Sync Deciplus → Boutique ===\n');

  let browser;
  let context;
  let page;
  try {
    ({ browser, context, page } = await launchBrowser());
    await login(page);
    await saveSession(context);

    const raw = await fetchDeciplusCatalog(page, { force: true });
    console.log(`Deciplus API : ${raw.length} produits actifs\n`);

    const products = deciplusToStorefront(raw);
    const validation = validateSync(products);
    const cmp = compareWithStatic(products);

    saveSyncedCatalog(products, {
      deciplus_count: raw.length,
      validation,
    });

    console.log(`Boutique   : ${products.length} produits`);
    console.log(`Sync OK    : ${validation.ok ? 'OUI' : 'NON'}`);
    if (validation.missing.length) {
      console.log(`Manquants  : ${validation.missing.join(', ')}`);
    }
    if (cmp.onlyStatic.length) {
      console.log(`\nStatic seulement (normal si essai): ${cmp.onlyStatic.slice(0, 5).join(', ')}`);
    }

    console.log('\n--- Échantillon (nom Deciplus → Stripe) ---');
    for (const name of ['OFFRE A 29€', 'OFFRE PROMO 12 MOIS', 'COMPTANT 3 MOIS', 'Badge']) {
      const p = products.find((x) => x.name === name || x.name.includes(name.split(' ')[0]));
      if (p) {
        console.log(`  ${p.name} | Stripe ${p.price_label} | Deciplus ${p.deciplus_price} €`);
      }
    }

    console.log('\n--- Test résolution bot (findProductInCatalog) ---');
    const tests = [
      { product_name: 'OFFRE A 29€', payment: { amount: 29 } },
      { product_name: 'OFFRE PROMO 12 MOIS', payment: { amount: 259 } },
      { product_name: 'COMPTANT 3 MOIS', payment: { amount: 150 } },
    ];
    let botOk = 0;
    for (const order of tests) {
      const match = findProductInCatalog(raw, order);
      if (match) {
        console.log(`  OK  "${order.product_name}" → #${match.id} ${match.title}`);
        botOk += 1;
      } else {
        console.log(`  FAIL "${order.product_name}"`);
      }
    }

    if (!validation.ok || botOk < tests.length) {
      process.exitCode = 1;
      console.log('\n❌ Sync ou tests bot incomplets');
    } else {
      console.log('\n✅ Sync Deciplus + tests bot OK');
    }
  } catch (err) {
    console.error('Erreur:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

main();
