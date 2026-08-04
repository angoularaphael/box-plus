#!/usr/bin/env node
/**
 * Inspect + test local : membre + adresse + RIB (navigateur visible).
 * Usage: node scripts/local-member-rib-test.js [memberId]
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { setMemberIban } = require('../bot/wallet');
const { findOrCreateMember } = require('../bot/member');
const { getGymConfig } = require('../lib/normalize');
const { login, STORAGE_FILE } = require('../bot/auth');

const OUT = path.join(__dirname, '..', 'data', 'local-rib-inspect.json');

async function dumpForm(page, label) {
  const info = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input, select, textarea')].slice(0, 80).map((el) => ({
      tag: el.tagName,
      name: el.name || el.id,
      type: el.type,
      value: String(el.value || '').slice(0, 40),
      visible: !!(el.offsetParent || el.getClientRects().length),
    }));
    const frames = [...document.querySelectorAll('iframe')].map((f) => f.src || f.id || f.name);
    return {
      url: location.href,
      title: document.title,
      hasDb1: !!document.querySelector('form[name="db1_form"]'),
      hasAdr1: !!document.querySelector('input[name="adr1"]'),
      bodySnippet: (document.body?.innerText || '').slice(0, 400),
      frames,
      inputs,
    };
  });

  // Aussi dump frames
  const frameInfos = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const fi = await frame.evaluate(() => ({
        url: location.href,
        hasDb1: !!document.querySelector('form[name="db1_form"]'),
        hasAdr1: !!document.querySelector('input[name="adr1"]'),
        inputs: [...document.querySelectorAll('input[name], select[name]')].slice(0, 40).map((el) => el.name),
      }));
      frameInfos.push(fi);
    } catch {
      /* cross-origin */
    }
  }
  return { label, ...info, frameInfos };
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session manquante — lance npm run session:export');
    process.exit(1);
  }

  const existingId = process.argv[2] || null;
  const stamp = Date.now();
  const customer = {
    first_name: 'TestLocal',
    last_name: `Rib${String(stamp).slice(-6)}`,
    email: `test-local-rib-${stamp}@boxplus-test.local`,
    phone: '0612345678',
    birthdate: '1990-01-15',
    gender: 'M',
    address: '12 rue de Fenouillet',
    postal_code: '31200',
    city: 'Toulouse',
    country: 'FR',
  };
  const order = {
    order_id: `LOCAL-RIB-${stamp}`,
    source: 'local-test',
    customer,
    product_name: 'Etudiants 36,99€',
    gym: 'minimes',
    utm: { source: 'local', medium: 'test', campaign: 'rib' },
    payment: { status: 'paid', amount: 36.99, iban: 'FR7630001007941234567890185', billing_plan: 'rib' },
  };
  const gymConfig = getGymConfig('minimes');
  const iban = 'FR7630001007941234567890185';

  console.log('\n=== Test local membre + RIB (navigateur visible) ===');
  console.log('Customer:', customer.email, customer.last_name);

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const dumps = [];
  try {
    await login(page, { siteLabel: 'Minimes' });
    console.log('Login OK —', page.url());

    let memberId = existingId;
    if (!memberId) {
      const result = await findOrCreateMember(page, order, gymConfig);
      console.log('findOrCreateMember →', result);
      memberId = result.member_id;
      if (!memberId) throw new Error('Pas de member_id après création');
    } else {
      console.log('Réutilise member_id', memberId);
    }

    // Inspect joueurs.php
    const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
    await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    dumps.push(await dumpForm(page, 'joueurs-direct'));

    // Essai via legacy wrapper
    await page.goto(
      new URL(`nextgen/legacy?path=${encodeURIComponent(`/joueurs.php?idj=${memberId}`)}`, base).href,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    await page.waitForTimeout(2500);
    dumps.push(await dumpForm(page, 'joueurs-legacy'));

    fs.writeFileSync(OUT, JSON.stringify({ memberId, dumps }, null, 2));
    console.log('Dump →', OUT);

    console.log('\n--- setMemberIban ---');
    await setMemberIban(page, memberId, iban, customer, gymConfig);
    console.log('✅ RIB OK pour membre', memberId);

    await context.storageState({ path: STORAGE_FILE });
    console.log('Session sauvegardée');
  } catch (err) {
    console.error('❌ ÉCHEC:', err.message);
    fs.writeFileSync(
      OUT,
      JSON.stringify({ error: err.message, dumps, url: page.url() }, null, 2)
    );
    console.log('Dump partiel →', OUT);
    await page.waitForTimeout(5000);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
