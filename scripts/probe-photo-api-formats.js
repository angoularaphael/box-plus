#!/usr/bin/env node
/**
 * Probe API Deciplus PUT/POST member photo formats.
 * Usage: node scripts/probe-photo-api-formats.js [memberId]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');

async function main() {
  const memberId = process.argv[2] || '20899';
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
    'base64'
  );
  const tmp = path.join(__dirname, '..', 'data', 'tmp-probe-photo.jpg');
  fs.writeFileSync(tmp, jpeg);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: STORAGE_FILE, locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.goto(process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await login(page).catch(() => {});
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth') || '{}').token);
  if (!token) throw new Error('no token');
  console.log('token ok', token.slice(0, 12) + '…');

  const headers = {
    'x-access-token': token,
    'Deciplus-Client-Type': 'manager',
  };

  const attempts = [];

  async function tryReq(label, opts) {
    const res = await ctx.request.fetch(opts.url, opts);
    const status = res.status();
    const text = await res.text().catch(() => '');
    const row = { label, status, text: text.slice(0, 300) };
    attempts.push(row);
    console.log(label, status, text.slice(0, 180));
    return row;
  }

  const url = `https://api.deciplus.pro/staff/v1/member/${memberId}/photo`;
  const urlPic = `https://api.deciplus.pro/staff/v1/member/${memberId}/picture`;

  // GET first to see current
  await tryReq('GET photo', { url, method: 'GET', headers });
  await tryReq('GET member', {
    url: `https://api.deciplus.pro/staff/v1/member/${memberId}`,
    method: 'GET',
    headers,
  });

  // multipart field name variants
  for (const field of ['photo', 'file', 'picture', 'image', 'upload', 'memberPhoto']) {
    await tryReq(`PUT multipart ${field}`, {
      url,
      method: 'PUT',
      headers,
      multipart: {
        [field]: {
          name: 'probe.jpg',
          mimeType: 'image/jpeg',
          buffer: jpeg,
        },
      },
    });
  }

  // POST multipart
  for (const field of ['photo', 'file', 'picture']) {
    await tryReq(`POST multipart ${field}`, {
      url,
      method: 'POST',
      headers,
      multipart: {
        [field]: {
          name: 'probe.jpg',
          mimeType: 'image/jpeg',
          buffer: jpeg,
        },
      },
    });
  }

  // raw body image/jpeg
  await tryReq('PUT raw jpeg', {
    url,
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'image/jpeg' },
    data: jpeg,
  });

  // JSON variants
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  for (const body of [
    { photo: dataUrl },
    { picture: dataUrl },
    { image: dataUrl },
    { photo: jpeg.toString('base64') },
    { data: dataUrl },
    { file: dataUrl },
  ]) {
    await tryReq(`PUT json ${Object.keys(body)[0]}`, {
      url,
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: body,
    });
  }

  // PATCH member with photo field
  await tryReq('PATCH member photo', {
    url: `https://api.deciplus.pro/staff/v1/member/${memberId}`,
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: { photo: dataUrl },
  });
  await tryReq('PUT member photo', {
    url: `https://api.deciplus.pro/staff/v1/member/${memberId}`,
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: { photo: dataUrl },
  });

  // Legacy PHP endpoints on club host
  const base = process.env.DECIPLUS_URL || 'https://boxingcenter.deciplus.pro/';
  for (const rel of [
    `photo.php?idj=${memberId}`,
    `upload_photo.php?idj=${memberId}`,
    `photomembre.php?idj=${memberId}`,
    `get_photo.php?idj=${memberId}`,
    `ajax_photo.php?idj=${memberId}`,
  ]) {
    await tryReq(`GET legacy ${rel}`, {
      url: new URL(rel, base).href,
      method: 'GET',
      headers,
    });
  }

  // multipart to legacy
  await tryReq('POST legacy photo.php', {
    url: new URL(`photo.php?idj=${memberId}`, base).href,
    method: 'POST',
    multipart: {
      photo: { name: 'probe.jpg', mimeType: 'image/jpeg', buffer: jpeg },
      idj: memberId,
    },
  });

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'photo-api-probe.json'),
    JSON.stringify(attempts, null, 2)
  );

  // Check member after best attempt
  const get = await ctx.request.get(`https://api.deciplus.pro/staff/v1/member/${memberId}`, { headers });
  const member = await get.json();
  console.log('final photo field:', member.response?.photo || member.photo || null);

  await browser.close();
  try { fs.unlinkSync(tmp); } catch { /* */ }

  const ok = attempts.some((a) => a.status >= 200 && a.status < 300 && /PUT|POST|PATCH/.test(a.label));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
