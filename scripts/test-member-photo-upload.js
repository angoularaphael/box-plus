#!/usr/bin/env node
/**
 * Test E2E : uploadMemberPhoto via API Deciplus (chemin + base64).
 * Usage: node scripts/test-member-photo-upload.js [memberId]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { uploadMemberPhoto, resolvePhotoFile } = require('../bot/member');

async function makeJpeg(page, w, h, label) {
  await page.setContent(`<!doctype html><canvas id="c" width="${w}" height="${h}"></canvas>
    <script>
      const c=document.getElementById('c'); const x=c.getContext('2d');
      x.fillStyle='#0b3d2e'; x.fillRect(0,0,${w},${h});
      x.fillStyle='#f5c518'; x.font='bold 22px sans-serif';
      x.fillText(${JSON.stringify(label)}, 24, ${Math.floor(h / 2)});
    </script>`);
  return page.locator('#c').screenshot({ type: 'jpeg', quality: 90 });
}

async function main() {
  const memberId = process.argv[2] || '20899';
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session manquante');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: STORAGE_FILE, locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.goto(process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await login(page).catch(() => {});

  const buf = await makeJpeg(page, 320, 320, `BOX+ ${Date.now() % 10000}`);
  const tmp = path.join(__dirname, '..', 'data', 'tmp-e2e-photo.jpg');
  fs.writeFileSync(tmp, buf);
  const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;

  // Unit-ish: resolvePhotoFile
  const resolved = await resolvePhotoFile(null, dataUrl);
  console.log('resolvePhotoFile', Boolean(resolved?.path), resolved?.cleanup);

  console.log('Upload via path…');
  const r1 = await uploadMemberPhoto(page, tmp, null, memberId);
  console.log('path result', r1);

  console.log('Upload via base64…');
  const r2 = await uploadMemberPhoto(page, null, dataUrl, memberId);
  console.log('base64 result', r2);

  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth') || '{}').token);
  const get = await ctx.request.get(`https://api.deciplus.pro/staff/v1/member/${memberId}`, {
    headers: { 'x-access-token': token, 'Deciplus-Client-Type': 'manager' },
  });
  const member = await get.json();
  const photo = member.response?.photo || null;
  console.log('member.photo', photo ? String(photo).slice(0, 100) : null);

  await browser.close();
  try { fs.unlinkSync(tmp); } catch { /* */ }
  if (resolved?.cleanup && resolved.path) {
    try { fs.unlinkSync(resolved.path); } catch { /* */ }
  }

  const ok = (r1.ok || r2.ok) && Boolean(photo);
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
