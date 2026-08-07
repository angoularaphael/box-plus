/**
 * Probe why Deciplus still blocks SEPA despite address fields being filled.
 * Usage: node scripts/probe-sepa-address.js [memberId]
 */
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const memberId = process.argv[2] || '21015';
const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');

async function memberFrame(page) {
  for (const frame of page.frames()) {
    if ((frame.url() || '').includes('joueurs.php') && (await frame.locator('input[name="adr1"]').count()) > 0) {
      return frame;
    }
  }
  if ((await page.locator('input[name="adr1"]').count()) > 0) return page;
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // --- API member dump ---
  const cookies = await context.cookies();
  console.log('cookies count', cookies.length);

  // Open member
  await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  const ctx = await memberFrame(page);

  const memberFields = await ctx.evaluate(() => {
    const names = [
      'adr1', 'adr2', 'codepostal', 'ville', 'pays', 'latitude', 'longitude',
      'idz', 'idj', 'alde_mode', 'alde_id', 'demande_maj',
    ];
    const out = {};
    for (const n of names) {
      const el = document.querySelector(`[name="${n}"]`);
      out[n] = el ? { tag: el.tagName, type: el.type || '', value: el.value || '', options: el.tagName === 'SELECT' ? [...el.options].map((o) => ({ v: o.value, t: o.text, sel: o.selected })) : undefined } : null;
    }
    // geocode / map buttons
    const geo = [...document.querySelectorAll('a,button,input,img,span')].filter((el) => {
      const t = ((el.title || '') + (el.alt || '') + (el.value || '') + (el.textContent || '') + (el.className || '') + (el.id || '')).toLowerCase();
      return /g[eé]o|localis|carte|map|lat|long|position|gmap|osm/.test(t);
    }).slice(0, 30).map((el) => ({
      tag: el.tagName,
      id: el.id,
      className: String(el.className).slice(0, 80),
      title: el.title,
      alt: el.alt,
      value: el.value,
      href: el.href || '',
      onclick: (el.getAttribute('onclick') || '').slice(0, 120),
      text: (el.textContent || '').trim().slice(0, 60),
    }));
    return { fields: out, geo, htmlHasLat: document.documentElement.innerHTML.includes('latitude') };
  });
  console.log('\n=== MEMBER FIELDS ===');
  console.log(JSON.stringify(memberFields, null, 2));

  // Try set lat/long if empty and save
  const latEl = ctx.locator('input[name="latitude"]').first();
  const lngEl = ctx.locator('input[name="longitude"]').first();
  const hasLat = (await latEl.count()) > 0;
  console.log('\nhas latitude input', hasLat);

  if (hasLat) {
    const lat = await latEl.inputValue().catch(() => '');
    const lng = await lngEl.inputValue().catch(() => '');
    console.log('current lat/lng', { lat, lng });
    if (!lat || !lng) {
      // Toulouse Fenouillet approx
      await latEl.fill('43.6355', { force: true }).catch(() => {});
      await lngEl.fill('1.4332', { force: true }).catch(() => {});
      console.log('filled lat/lng manually');
      await ctx.evaluate(() => {
        const form = document.querySelector('form[name="db1_form"]');
        if (!form) return;
        const submit = form.querySelector('input[name="alde_submit"]');
        if (submit) submit.value = 'valider';
      }).catch(() => {});
      const btn = ctx.locator('input[type="submit"][value="Mettre à jour"], input[type="submit"][value="Valider"]').first();
      if ((await btn.count()) > 0) {
        await btn.click({ force: true });
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
        console.log('saved member after lat/lng');
      }
    }
  }

  // Re-open member and check lat/lng
  await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  const ctx2 = await memberFrame(page);
  const after = await ctx2.evaluate(() => ({
    adr1: document.querySelector('[name="adr1"]')?.value,
    codepostal: document.querySelector('[name="codepostal"]')?.value,
    ville: document.querySelector('[name="ville"]')?.value,
    pays: document.querySelector('[name="pays"]')?.value,
    latitude: document.querySelector('[name="latitude"]')?.value,
    longitude: document.querySelector('[name="longitude"]')?.value,
  }));
  console.log('\n=== AFTER GEO SAVE ===', after);

  // Open RIB and check blocker + scripts
  await page.goto(new URL(`rib.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2000);

  const rib = await page.evaluate(() => {
    const blocker = /adresse postale est obligatoire/i.test(document.body.innerText);
    const scripts = [...document.scripts].map((s) => (s.src || '').slice(0, 120)).filter(Boolean);
    const inlineHints = [...document.scripts]
      .map((s) => s.textContent || '')
      .filter((t) => /adresse|postal|iban|mandat|obligatoire|latitude|geocod/i.test(t))
      .map((t) => t.slice(0, 500));
    const hidden = [...document.querySelectorAll('input[type="hidden"]')].map((el) => ({
      name: el.name,
      value: (el.value || '').slice(0, 80),
    }));
    const disabled = [...document.querySelectorAll('input,select,textarea,button')].filter((el) => el.disabled).map((el) => ({
      name: el.name,
      tag: el.tagName,
      type: el.type,
    }));
    // look for PHP/JS flag in HTML comments or data attrs
    const html = document.documentElement.innerHTML;
    const idx = html.toLowerCase().indexOf('adresse postale');
    const around = idx >= 0 ? html.slice(Math.max(0, idx - 200), idx + 300) : '';
    return { blocker, scripts, inlineHints, hidden, disabled: disabled.slice(0, 40), around };
  });
  console.log('\n=== RIB ===');
  console.log(JSON.stringify(rib, null, 2));

  await page.waitForTimeout(3000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
