/**
 * Deep probe: API member + geocode save + compare rib blocker.
 * Usage: node scripts/probe-sepa-deep.js [memberId]
 */
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const memberId = process.argv[2] || '21015';
const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
const API = 'https://api.deciplus.pro/staff/v1';

async function waitMemberCtx(page) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if ((await frame.locator('input[name="adr1"]').count()) > 0) return frame;
    }
    if ((await page.locator('input[name="adr1"]').count()) > 0) return page;
    await page.waitForTimeout(400);
  }
  throw new Error('member form not found');
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Capture token from network if possible
  let token = null;
  page.on('request', (req) => {
    const h = req.headers();
    if (h['x-access-token']) token = h['x-access-token'];
  });

  await page.goto(new URL('nextgen/', base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Try get token from localStorage / cookies
  const tok = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const out = { keys, token: null };
    for (const k of keys) {
      const v = localStorage.getItem(k) || '';
      if (/token|access/i.test(k) || /eyJ/.test(v)) out.token = v.slice(0, 200);
      if (/eyJ/.test(v) && v.length > 40) out.token = v;
    }
    return out;
  });
  console.log('LS token keys', tok.keys);
  if (tok.token) token = tok.token;
  if (token) console.log('token prefix', String(token).slice(0, 40));

  // API GET member with browser request context
  if (token) {
    for (const client of ['manager', 'manager_legacy', 'nextgen']) {
      const res = await context.request.get(`${API}/member/${memberId}`, {
        headers: {
          'x-access-token': token,
          'Deciplus-Client-Type': client,
        },
      });
      console.log(`API GET member client=${client} status=${res.status()}`);
      if (res.ok()) {
        const body = await res.json();
        const m = body.response || body;
        console.log('API member address fields:', JSON.stringify({
          id: m.id || m.idj || m.memberId,
          adr1: m.adr1 || m.address,
          adr2: m.adr2,
          postalCode: m.postalCode || m.postal_code || m.codepostal,
          city: m.city || m.ville,
          country: m.country || m.pays,
          latitude: m.latitude || m.lat,
          longitude: m.longitude || m.lng || m.lon,
          zoneId: m.zoneId || m.idz,
          keys: Object.keys(m).filter((k) => /adr|post|city|ville|pays|country|lat|lon|geo|address/i.test(k)),
        }, null, 2));
        // dump all keys briefly
        console.log('all keys', Object.keys(m).sort().join(', '));
      } else {
        console.log('body', (await res.text()).slice(0, 200));
      }
    }
  } else {
    console.log('No token found — skip API');
  }

  // Open member, set lat/long, try geocode UI
  await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const ctx = await waitMemberCtx(page);

  const before = await ctx.evaluate(() => {
    const v = (n) => document.querySelector(`[name="${n}"]`)?.value ?? null;
    // list ALL input names
    const names = [...document.querySelectorAll('input,select,textarea')].map((el) => el.name).filter(Boolean);
    return {
      adr1: v('adr1'), codepostal: v('codepostal'), ville: v('ville'), pays: v('pays'),
      latitude: v('latitude'), longitude: v('longitude'),
      names: names.filter((n) => /adr|ville|postal|pays|lat|long|geo|idz/i.test(n)),
      allNamesSample: names.slice(0, 80),
    };
  });
  console.log('\nBEFORE', before);

  // Fill lat/long if present
  await ctx.evaluate(() => {
    const set = (n, val) => {
      const el = document.querySelector(`[name="${n}"]`);
      if (!el) return false;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    return {
      lat: set('latitude', '43.6355'),
      lng: set('longitude', '1.4332'),
      pays: set('pays', 'France'),
    };
  });

  // Click any geocode-looking control
  const geoClicked = await ctx.evaluate(() => {
    const els = [...document.querySelectorAll('a,button,input,img')];
    for (const el of els) {
      const t = ((el.title || '') + (el.alt || '') + (el.value || '') + (el.className || '') + (el.id || '') + (el.getAttribute('onclick') || '')).toLowerCase();
      if (/g[eé]olocal|localiser|geocode|gmap|getlat|setlat|carte/.test(t)) {
        el.click();
        return t.slice(0, 100);
      }
    }
    return null;
  });
  console.log('geoClicked', geoClicked);
  await page.waitForTimeout(1500);

  await ctx.evaluate(() => {
    const form = document.querySelector('form[name="db1_form"]');
    if (!form) return;
    const submit = form.querySelector('input[name="alde_submit"]');
    if (submit) submit.value = 'valider';
    const demandeMaj = form.querySelector('input[name="demande_maj"]');
    if (demandeMaj) demandeMaj.value = '1';
  });
  const saveBtn = ctx.locator('input[type="submit"][value="Mettre à jour"], input[type="submit"][value="Valider"]').first();
  await saveBtn.click({ force: true });
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.goto(new URL(`joueurs.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const ctx2 = await waitMemberCtx(page);
  const after = await ctx2.evaluate(() => {
    const v = (n) => document.querySelector(`[name="${n}"]`)?.value ?? null;
    return { adr1: v('adr1'), codepostal: v('codepostal'), ville: v('ville'), pays: v('pays'), latitude: v('latitude'), longitude: v('longitude') };
  });
  console.log('\nAFTER SAVE', after);

  // RIB blocker?
  await page.goto(new URL(`rib.php?idj=${memberId}`, base).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  const rib = await page.evaluate(() => ({
    blocker: /adresse postale est obligatoire/i.test(document.body.innerText),
    adr_line1: document.querySelector('[name="adr_line1"]')?.value,
    adr_town: document.querySelector('[name="adr_town"]')?.value,
    adr_postcode: document.querySelector('[name="adr_postcode"]')?.value,
    adr_country: document.querySelector('[name="adr_country"]')?.value,
    submitDisabled: document.querySelector('input[type="submit"]')?.disabled,
  }));
  console.log('\nRIB', rib);

  // Also dump view-source snippet searching for condition comments
  const html = await page.content();
  const i = html.indexOf("adresse postale est obligatoire");
  console.log('\nHTML context:\n', html.slice(Math.max(0, i - 400), i + 200));

  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
