#!/usr/bin/env node
/**
 * Confirme PUT /staff/v1/member/:id/photo avec une image ≥ résolution mini.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');

async function makeJpeg(page, w, h) {
  await page.setContent(`<!doctype html><canvas id="c" width="${w}" height="${h}"></canvas>
    <script>
      const c=document.getElementById('c'); const x=c.getContext('2d');
      x.fillStyle='#1a5cff'; x.fillRect(0,0,${w},${h});
      x.fillStyle='#fff'; x.font='bold 28px sans-serif';
      x.fillText('BOXPLUS', 40, ${Math.floor(h / 2)});
    </script>`);
  return page.locator('#c').screenshot({ type: 'jpeg', quality: 85 });
}

async function main() {
  const memberId = process.argv[2] || '20899';
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: STORAGE_FILE, locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.goto(process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await login(page).catch(() => {});
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth') || '{}').token);
  const headers = {
    'x-access-token': token,
    'Deciplus-Client-Type': 'manager',
    'Content-Type': 'application/json',
  };

  const sizes = [
    [64, 64],
    [100, 100],
    [128, 128],
    [150, 150],
    [200, 200],
    [320, 320],
  ];
  let winner = null;
  for (const [w, h] of sizes) {
    const buf = await makeJpeg(page, w, h);
    const photo = `data:image/jpeg;base64,${buf.toString('base64')}`;
    const res = await ctx.request.fetch(`https://api.deciplus.pro/staff/v1/member/${memberId}/photo`, {
      method: 'PUT',
      headers,
      data: { photo },
    });
    const status = res.status();
    const text = await res.text();
    console.log(`${w}x${h}`, status, text.slice(0, 160));
    if (status >= 200 && status < 300) {
      winner = { w, h, status, text: text.slice(0, 300) };
      break;
    }
  }

  const get = await ctx.request.get(`https://api.deciplus.pro/staff/v1/member/${memberId}`, {
    headers: { 'x-access-token': token, 'Deciplus-Client-Type': 'manager' },
  });
  const member = await get.json();
  console.log('member.photo', member.response?.photo ? String(member.response.photo).slice(0, 120) : null);
  console.log('winner', winner);

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'photo-api-ok.json'),
    JSON.stringify({ memberId, winner, photo: member.response?.photo || null }, null, 2)
  );

  await browser.close();
  process.exit(winner ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
