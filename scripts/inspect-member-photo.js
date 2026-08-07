#!/usr/bin/env node
/**
 * Inspect + test upload photo membre Deciplus.
 * Usage: node scripts/inspect-member-photo.js [memberId]
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { openMemberCheck, openMemberDetail } = require('../bot/wallet');
const { uploadMemberPhoto } = require('../bot/member');

const OUT = path.join(__dirname, '..', 'data', 'photo-inspect.json');

async function dumpPhotoUi(page) {
  const main = await page.evaluate(() => {
    const files = [...document.querySelectorAll('input[type=file]')].map((el) => ({
      name: el.name,
      id: el.id,
      className: el.className,
      accept: el.accept,
      display: getComputedStyle(el).display,
    }));
    const photoEls = [...document.querySelectorAll(
      '#photomembre, .uploadPicture, .takePicture, .fileInput, .user-photo, [class*=photo], img[src*=photo], a[href*=photo]'
    )].slice(0, 40).map((el) => ({
      tag: el.tagName,
      id: el.id,
      className: el.className,
      href: el.getAttribute?.('href') || null,
      src: (el.getAttribute?.('src') || '').slice(0, 120),
      title: el.getAttribute?.('title') || el.title || null,
      text: (el.innerText || '').slice(0, 40),
    }));
    return { url: location.href, files, photoEls, bodyHasPhoto: /photo/i.test(document.body?.innerText || '') };
  });

  const frames = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const fi = await frame.evaluate(() => ({
        url: location.href,
        files: [...document.querySelectorAll('input[type=file]')].map((el) => ({
          name: el.name,
          id: el.id,
          className: el.className,
          accept: el.accept,
        })),
        photoEls: [...document.querySelectorAll(
          '#photomembre, .uploadPicture, .takePicture, .fileInput, .user-photo, img[id*=photo], a[href*=get_photo], input[type=file]'
        )].slice(0, 30).map((el) => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          href: el.getAttribute?.('href') || null,
          src: (el.getAttribute?.('src') || '').slice(0, 100),
          onclick: (el.getAttribute?.('onclick') || '').slice(0, 80),
        })),
        htmlSnippet: (document.body?.innerHTML || '').match(/photo[^<]{0,80}|fileInput|uploadPicture|photomembre|get_photo|webcam|appareil/gi)?.slice(0, 20) || [],
      }));
      frames.push(fi);
    } catch {
      /* cross-origin */
    }
  }
  return { main, frames };
}

async function tryApiUpload(page, memberId, photoPath) {
  const token = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('auth') || '{}').token || null;
    } catch {
      return null;
    }
  });
  if (!token) return { ok: false, reason: 'no_token' };

  const buf = fs.readFileSync(photoPath);
  const results = [];
  const endpoints = [
    { method: 'POST', url: `https://api.deciplus.pro/staff/v1/member/${memberId}/picture` },
    { method: 'PUT', url: `https://api.deciplus.pro/staff/v1/member/${memberId}/picture` },
    { method: 'POST', url: `https://api.deciplus.pro/staff/v1/member/${memberId}/photo` },
    { method: 'PUT', url: `https://api.deciplus.pro/staff/v1/member/${memberId}/photo` },
    { method: 'POST', url: `https://api.deciplus.pro/staff/v1/members/${memberId}/picture` },
  ];

  for (const ep of endpoints) {
    // multipart
    const res = await page.context().request.fetch(ep.url, {
      method: ep.method,
      headers: {
        'x-access-token': token,
        'Deciplus-Client-Type': 'manager',
      },
      multipart: {
        file: {
          name: path.basename(photoPath),
          mimeType: 'image/jpeg',
          buffer: buf,
        },
        picture: {
          name: path.basename(photoPath),
          mimeType: 'image/jpeg',
          buffer: buf,
        },
      },
    }).catch((err) => ({ status: () => 0, text: async () => err.message }));
    const status = typeof res.status === 'function' ? res.status() : res.status;
    const text = await res.text?.().then((t) => t.slice(0, 200)).catch(() => '');
    results.push({ ...ep, mode: 'multipart', status, text });
    if (status >= 200 && status < 300) return { ok: true, results, winner: ep };
  }

  // JSON base64 attempts
  const b64 = buf.toString('base64');
  for (const ep of endpoints.slice(0, 2)) {
    const res = await page.context().request.fetch(ep.url, {
      method: ep.method,
      headers: {
        'x-access-token': token,
        'Deciplus-Client-Type': 'manager',
        'Content-Type': 'application/json',
      },
      data: { picture: `data:image/jpeg;base64,${b64}`, photo: `data:image/jpeg;base64,${b64}` },
    }).catch((err) => ({ status: () => 0, text: async () => err.message }));
    const status = typeof res.status === 'function' ? res.status() : res.status;
    const text = await res.text?.().then((t) => t.slice(0, 200)).catch(() => '');
    results.push({ ...ep, mode: 'json-b64', status, text });
    if (status >= 200 && status < 300) return { ok: true, results, winner: ep };
  }

  return { ok: false, results };
}

async function main() {
  if (!fs.existsSync(STORAGE_FILE)) {
    console.error('Session manquante — lance npm run session:export');
    process.exit(1);
  }

  const memberId = process.argv[2] || process.env.PHOTO_TEST_MEMBER_ID || '20899';
  const tmpPhoto = path.join(__dirname, '..', 'data', 'tmp-test-photo.jpg');
  // Minimal valid JPEG
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
    'base64'
  );
  fs.mkdirSync(path.dirname(tmpPhoto), { recursive: true });
  fs.writeFileSync(tmpPhoto, jpeg);

  const headless = process.env.DECIPLUS_HEADLESS !== 'false';
  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 50 });
  const context = await browser.newContext({ storageState: STORAGE_FILE, locale: 'fr-FR' });
  const page = await context.newPage();

  try {
    await login(page).catch(() => {});
    console.log('Open check', memberId);
    await openMemberCheck(page, memberId);
    await page.waitForTimeout(2000);
    const dumpCheck = await dumpPhotoUi(page);

    console.log('Open detail joueurs', memberId);
    await openMemberDetail(page, memberId);
    await page.waitForTimeout(2000);
    const dumpDetail = await dumpPhotoUi(page);

    console.log('Try API upload…');
    const api = await tryApiUpload(page, memberId, tmpPhoto);

    console.log('Try RPA uploadMemberPhoto…');
    await openMemberCheck(page, memberId);
    await page.waitForTimeout(1500);
    const rpa = await uploadMemberPhoto(page, tmpPhoto, null);

    // If failed, try detail form
    let rpa2 = null;
    if (!rpa.ok) {
      await openMemberDetail(page, memberId);
      await page.waitForTimeout(1500);
      rpa2 = await uploadMemberPhoto(page, tmpPhoto, null);
    }

    // Verify via API get member photo field
    let memberAfter = null;
    try {
      const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth') || '{}').token);
      const get = await context.request.get(`https://api.deciplus.pro/staff/v1/member/${memberId}`, {
        headers: { 'x-access-token': token, 'Deciplus-Client-Type': 'manager' },
      });
      const json = await get.json();
      memberAfter = {
        photo: json.response?.photo || json.photo || null,
        id: json.response?.id || json.id,
      };
    } catch (err) {
      memberAfter = { error: err.message };
    }

    const out = {
      memberId,
      dumpCheck,
      dumpDetail,
      api,
      rpa,
      rpa2,
      memberAfter,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('Wrote', OUT);
    console.log(JSON.stringify({
      apiOk: api.ok,
      apiWinner: api.winner,
      apiStatuses: (api.results || []).map((r) => `${r.method} ${r.url.split('/').slice(-2).join('/')} ${r.mode} => ${r.status}`),
      rpa,
      rpa2,
      photo: memberAfter?.photo ? String(memberAfter.photo).slice(0, 80) : null,
    }, null, 2));

    process.exit(api.ok || rpa.ok || rpa2?.ok ? 0 : 2);
  } finally {
    await browser.close();
    try { fs.unlinkSync(tmpPhoto); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
