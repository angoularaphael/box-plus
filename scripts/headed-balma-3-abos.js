#!/usr/bin/env node
/**
 * Crée 3 clients Balma en prélèvement : étudiant 34,99 / adulte 38,99 / 29,99.
 *
 *   node scripts/headed-balma-3-abos.js
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '80';
process.env.BOT_DELAY_SCALE = process.env.BOT_DELAY_SCALE || '0.8';
process.env.BALMA_AUTOMIGRATE_ON_SALE = '0';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { processSaleJob } = require('../bot/index');
const { openMemberCheck } = require('../bot/wallet');
const { normalizeOrder, validateOrder } = require('../lib/normalize');
const { VALID_TEST_IBAN } = require('../lib/test-fixtures');

const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS || 10000);
const OUT = path.join(__dirname, '..', 'data', `balma-3-abos-${Date.now()}.json`);

function customer(stamp, first, lastPrefix, birthdate) {
  const tail = String(stamp).slice(-5);
  return {
    first_name: first,
    last_name: `${lastPrefix}${tail}`,
    email: `${lastPrefix.toLowerCase()}.${tail}@boxplus-test.local`,
    phone: `06${String(stamp).slice(-8).padStart(8, '0')}`,
    birthdate,
    gender: 'M',
    address: '8 rue Theron de Montauge',
    postal_code: '31130',
    city: 'Balma',
    country: 'FR',
  };
}

function scenarios(stamp) {
  return [
    {
      title: '1/3 — Étudiant 34,99 € prélèvement',
      order: {
        order_id: `DEMO-BALMA-ETU-${stamp}`,
        product_id: 'offre-promo-etudiant',
        product_name: 'OFFRE PROMO 34.99€ ETUDIANTS',
        deciplus_product_search: '34.99',
        gym: 'balma',
        customer: customer(stamp, 'TestEtu', 'Balma', '2004-03-12'),
        payment: {
          status: 'paid',
          amount: 34.99,
          method: 'card',
          iban: VALID_TEST_IBAN,
          billing_plan: 'rib',
        },
      },
    },
    {
      title: '2/3 — Adulte 38,99 € prélèvement',
      order: {
        order_id: `DEMO-BALMA-ADU-${stamp + 1}`,
        product_id: 'offre-promo-adulte',
        product_name: 'OFFRE PROMO 38.99€ ADULTE',
        deciplus_product_search: '38.99',
        gym: 'balma',
        customer: customer(stamp + 1, 'TestAdu', 'Balma', '1991-08-10'),
        payment: {
          status: 'paid',
          amount: 38.99,
          method: 'card',
          iban: VALID_TEST_IBAN,
          billing_plan: 'rib',
        },
      },
    },
    {
      title: '3/3 — 29,99 € prélèvement',
      order: {
        order_id: `DEMO-BALMA-29-${stamp + 2}`,
        product_id: 'offre-duo',
        product_name: 'OFFRE A 29€',
        deciplus_product_search: 'OFFRE DUO 29',
        gym: 'balma',
        customer: customer(stamp + 2, 'TestDuo', 'Balma', '1991-08-10'),
        payment: {
          status: 'paid',
          amount: 29,
          method: 'card',
          iban: VALID_TEST_IBAN,
          billing_plan: 'rib',
        },
      },
    },
  ];
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session Deciplus manquante — npm run session:export');
    process.exit(1);
  }

  const stamp = Date.now();
  const recap = { at: new Date().toISOString(), results: [] };
  console.log('\n=== 3 clients Balma — étudiant / adulte / 29,99 (prélèvement) ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: Number(process.env.DECIPLUS_SLOW_MO || 80),
  });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await login(page, { siteLabel: 'Balma' });
    console.log('Login Deciplus OK — salle Balma\n');

    for (const run of scenarios(stamp)) {
      const order = normalizeOrder(run.order);
      const errors = validateOrder(order);
      if (errors.length) throw new Error(`${run.title}: ${errors.join(', ')}`);

      console.log('────────────────────────────────────────');
      console.log(run.title);
      console.log(`${order.customer.first_name} ${order.customer.last_name}`);
      console.log('────────────────────────────────────────');

      let result;
      try {
        result = await processSaleJob(page, order, {});
      } catch (err) {
        result = { status: 'error', error: err.message };
        console.error(run.title, err.message);
      }

      const memberId = result.deciplus_member_id || null;
      console.log('Résultat:', {
        status: result.status,
        member: memberId,
        error: result.error || null,
      });

      if (memberId) {
        await openMemberCheck(page, memberId).catch(() => {});
        await page.waitForTimeout(PAUSE_MS);
      }

      recap.results.push({
        title: run.title,
        name: `${order.customer.first_name} ${order.customer.last_name}`,
        member: memberId,
        status: result.status,
        error: result.error || null,
      });
    }
  } finally {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(recap, null, 2));
    console.log('\nRecap', OUT);
    for (const r of recap.results) {
      console.log(`- ${r.title}: fiche ${r.member || '—'} · ${r.status}${r.error ? ` · ${r.error}` : ''}`);
    }
    console.log('\nChrome reste ouvert 15s');
    await page.waitForTimeout(15000).catch(() => {});
    await browser.close().catch(() => {});
  }

  const failed = recap.results.filter((r) => r.status !== 'success');
  if (failed.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
