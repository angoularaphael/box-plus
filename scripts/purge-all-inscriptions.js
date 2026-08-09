#!/usr/bin/env node
'use strict';

/**
 * Supprime toutes les inscriptions lifecycle (local + Supabase si remote).
 * Usage: node scripts/purge-all-inscriptions.js --execute
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { ORDERS_DIR, listAllOrdersAsync, deleteOrderAsync } = require('../storefront/lib/order-lifecycle');

async function main() {
  const execute = process.argv.includes('--execute');
  const orders = await listAllOrdersAsync();
  console.log(`Inscriptions trouvées: ${orders.length}`);
  console.log(`Dossier local: ${ORDERS_DIR}`);

  if (!orders.length) {
    console.log('Rien à supprimer.');
    return;
  }

  for (const o of orders.slice(0, 20)) {
    console.log(` - ${o.order_id} | ${o.customer_short?.email || o.customer_full?.email || '—'} | step=${o.step}`);
  }
  if (orders.length > 20) console.log(` … +${orders.length - 20} autres`);

  if (!execute) {
    console.log('\nDry-run. Relance avec --execute pour supprimer.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const o of orders) {
    try {
      await deleteOrderAsync(o.order_id);
      ok += 1;
      console.log(`OK delete ${o.order_id}`);
    } catch (err) {
      fail += 1;
      console.error(`FAIL ${o.order_id}: ${err.message}`);
    }
  }

  // Nettoyage fichiers orphelins éventuels
  if (fs.existsSync(ORDERS_DIR)) {
    for (const f of fs.readdirSync(ORDERS_DIR).filter((x) => x.endsWith('.json'))) {
      try {
        fs.unlinkSync(path.join(ORDERS_DIR, f));
        console.log(`OK unlink ${f}`);
      } catch {
        /* ignore */
      }
    }
  }

  console.log(`\nTerminé: ${ok} supprimée(s), ${fail} échec(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
