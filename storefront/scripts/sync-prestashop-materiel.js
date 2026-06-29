/**
 * Sync stock/prix matériel depuis l'API PrestaShop live
 */
const { createPrestaShopClientFromEnv } = require('../../lib/prestashop-client');
const { loadMaterielCatalog, saveMaterielCatalog } = require('../lib/merch');

const MATERIEL_CATEGORY_IDS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];

function parsePriceCents(value) {
  if (typeof value === 'number') return Math.round(value * 100);
  const n = parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

async function syncMaterielFromPrestaShop() {
  const client = createPrestaShopClientFromEnv();
  if (!client) {
    throw new Error('PRESTASHOP_URL et PRESTASHOP_API_KEY requis');
  }

  const catalog = loadMaterielCatalog();
  const byPsId = new Map((catalog.products || []).map((p) => [p.prestashop_id, p]));
  let updated = 0;

  for (const catId of MATERIEL_CATEGORY_IDS) {
    let products;
    try {
      products = await client.listResource('products', {
        filter: { id_category_default: `[=${catId}]` },
        display: '[id,price,active]',
        limit: 100,
      });
    } catch {
      continue;
    }

    for (const row of products) {
      const psId = Number(row.id);
      const local = byPsId.get(psId);
      if (!local) continue;

      let stockTotal = 0;
      try {
        const stocks = await client.listResource('stock_availables', {
          filter: { id_product: `[=${psId}]` },
          display: '[id,quantity,id_product_attribute]',
          limit: 100,
        });
        stockTotal = stocks.reduce((s, st) => s + Number(st.quantity || 0), 0);
        for (const combo of local.combinations || []) {
          const match = stocks.find(
            (st) => String(st.id_product_attribute) === String(combo.prestashop_attribute_id || combo.id)
          );
          if (match) {
            combo.stock = Number(match.quantity || 0);
          }
        }
      } catch {
        /* stock sync optional */
      }

      const priceCents = parsePriceCents(row.price);
      if (priceCents > 0) {
        local.price_cents = priceCents;
        local.price_label = `${(priceCents / 100).toFixed(2).replace('.', ',')} €`;
      }
      if (stockTotal > 0) local.stock = stockTotal;
      local.active = String(row.active) !== '0';
      updated += 1;
    }
  }

  catalog.synced_at = new Date().toISOString();
  catalog.source = 'prestashop-api';
  saveMaterielCatalog(catalog);

  return { updated, count: catalog.products.length, synced_at: catalog.synced_at };
}

if (require.main === module) {
  syncMaterielFromPrestaShop()
    .then((r) => {
      console.log('Sync matériel OK', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { syncMaterielFromPrestaShop };
