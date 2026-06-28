const { getStoreProducts } = require('../storefront/lib/deciplus-sync');
const { buildDeciplusProductSearch } = require('../bot/catalog');

const VALID_IBAN = 'FR7630001007941234567890185';
const base = process.env.STORE_TEST_URL || 'http://localhost:3040';

const SAMPLE = {
  first_name: 'Test',
  last_name: 'Offre',
  email: 'test-offres@example.com',
  phone: '0612345678',
  birthdate: '1990-01-01',
  gender: 'M',
  gym: 'minimes',
};

async function main() {
  const products = getStoreProducts().products || [];
  console.log(`Offres: ${products.length} · API: ${base}\n`);
  console.log('ID'.padEnd(16) + 'PRIX'.padEnd(12) + 'IBAN'.padEnd(6) + 'RECHERCHE'.padEnd(22) + 'API');
  console.log('-'.repeat(70));

  let ok = 0;
  let fail = 0;

  for (const p of products) {
    const body = { product_id: p.id, ...SAMPLE };
    if (p.requires_iban) body.iban = VALID_IBAN;

    let api = '—';
    try {
      const res = await fetch(`${base}/api/checkout/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      api = data.ok ? 'OK' : (data.error || data.errors?.join(', ') || 'ERR');
      if (data.ok) ok += 1;
      else fail += 1;
    } catch (err) {
      api = 'DOWN';
      fail += 1;
    }

    const search = p.deciplus_id
      ? buildDeciplusProductSearch(p.name, p.deciplus_id)
      : 'essai';
    const line = [
      String(p.id).padEnd(16),
      String(p.price_label || '').padEnd(12),
      (p.requires_iban ? 'oui' : 'non').padEnd(6),
      String(search).slice(0, 20).padEnd(22),
      api,
    ].join('');
    console.log(line);
  }

  console.log('-'.repeat(70));
  console.log(`Résultat API: ${ok} OK, ${fail} échec(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
