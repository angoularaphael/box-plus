/**
 * Try lat/long save + forced RIB submit to learn Deciplus validation.
 * Usage: node scripts/probe-latlong-rib.js [memberId]
 */
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const memberId = process.argv[2] || '21015';
const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');

async function waitCtx(page) {
  for (let i = 0; i < 50; i += 1) {
    for (const frame of page.frames()) {
      try {
        if ((await frame.locator('input[name="adr1"]').count()) > 0) return frame;
      } catch {
        /* detached */
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error('member form not found');
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  let ctx = await waitCtx(page);

  const info = await ctx.evaluate(() => {
    const pays = document.querySelector('[name="pays"]');
    const lat = document.querySelector('[name="latitude"]');
    const lng = document.querySelector('[name="longitude"]');
    const rows = [...document.querySelectorAll('tr')]
      .filter((tr) => /adresse|ville|postal|pays|lat|long|g[eé]o/i.test(tr.innerText))
      .map((tr) => tr.innerText.replace(/\s+/g, ' ').trim().slice(0, 140));
    return {
      paysTag: pays && pays.tagName,
      paysValue: pays && pays.value,
      paysOuter: pays && pays.outerHTML.slice(0, 220),
      latOuter: lat && lat.outerHTML.slice(0, 220),
      lngOuter: lng && lng.outerHTML.slice(0, 220),
      rows,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await ctx.evaluate(() => {
    for (const [n, v] of [
      ['latitude', '43.6355'],
      ['longitude', '1.4332'],
      ['pays', 'France'],
      ['adr1', '12 rue de Fenouillet'],
      ['codepostal', '31200'],
      ['ville', 'TOULOUSE'],
    ]) {
      const el = document.querySelector(`[name="${n}"]`);
      if (el) {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const form = document.querySelector('form[name="db1_form"]');
    const submit = form && form.querySelector('input[name="alde_submit"]');
    if (submit) submit.value = 'valider';
    const demandeMaj = form && form.querySelector('input[name="demande_maj"]');
    if (demandeMaj) demandeMaj.value = '1';
  });

  await ctx
    .locator('input[type="submit"][value="Mettre à jour"], input[type="submit"][value="Valider"]')
    .first()
    .click({ force: true });
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  ctx = await waitCtx(page);
  const after = await ctx.evaluate(() => ({
    adr1: document.querySelector('[name="adr1"]')?.value,
    codepostal: document.querySelector('[name="codepostal"]')?.value,
    ville: document.querySelector('[name="ville"]')?.value,
    pays: document.querySelector('[name="pays"]')?.value,
    latitude: document.querySelector('[name="latitude"]')?.value,
    longitude: document.querySelector('[name="longitude"]')?.value,
  }));
  console.log('AFTER', after);

  await page.goto(new URL(`rib.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  let rib = await page.evaluate(() => ({
    blocker: /adresse postale est obligatoire/i.test(document.body.innerText),
    submitDisabled: !!document.querySelector('input[type="submit"]')?.disabled,
    messageText: document.querySelector('.message')?.innerText,
    adr_line1: document.querySelector('[name="adr_line1"]')?.value,
    adr_postcode: document.querySelector('[name="adr_postcode"]')?.value,
  }));
  console.log('RIB after lat/long', rib);

  if (rib.blocker) {
    console.log('Trying forced unlock + submit...');
    await page.evaluate(() => {
      document.querySelectorAll('input,button').forEach((el) => {
        el.disabled = false;
        el.readOnly = false;
      });
      const iban = document.querySelector('[name="iban"]');
      if (iban) iban.value = 'FR76 3000 1007 9412 3456 7890 185';
      const submit = document.querySelector('input[name="alde_submit"]');
      if (submit) submit.value = 'valider';
      const cb = document.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = true;
      // remove message row
      document.querySelectorAll('.message').forEach((el) => el.remove());
    });
    await page.locator('input[type="submit"]').first().click({ force: true }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    console.log('After forced submit URL', page.url());
    console.log(
      'Body snippet:\n',
      await page.evaluate(() => (document.body?.innerText || '').slice(0, 1200))
    );

    // re-open rib to see if IBAN saved
    await page.goto(new URL(`rib.php?idj=${memberId}`, base).href, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(1500);
    rib = await page.evaluate(() => ({
      blocker: /adresse postale est obligatoire/i.test(document.body.innerText),
      iban: document.querySelector('[name="iban"]')?.value,
      rum: document.querySelector('[name="rum"]')?.value,
      date_mandat: document.querySelector('[name="date_mandat"]')?.value,
    }));
    console.log('RIB reopened', rib);
  }

  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
