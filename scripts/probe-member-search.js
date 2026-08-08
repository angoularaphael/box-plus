#!/usr/bin/env node
/**
 * Diagnostique la recherche membre Deciplus (tel / email / nom).
 * Usage: node scripts/probe-member-search.js --phone 06... --email x@y --last Nom --first Prenom
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');

const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const {
  searchMember,
  searchMemberByName,
  findMemberByIdentity,
  navigateToMembers,
} = require('../bot/member');
const { getGymConfig } = require('../lib/normalize');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || '') : fallback;
}

(async () => {
  const session = path.join(__dirname, '..', 'data', 'session', 'storage-state.json');
  if (!fs.existsSync(session)) {
    console.error('Session manquante');
    process.exit(1);
  }

  const phone = arg('phone');
  const email = arg('email');
  const last = arg('last');
  const first = arg('first');
  const birth = arg('birth', '1990-01-01');
  const gym = arg('gym', 'minimes');
  const siteLabel = getGymConfig(gym).deciplus_label || 'Minimes';

  if (!phone && !email && !last) {
    console.error('Fournir --phone et/ou --email et/ou --last');
    process.exit(1);
  }

  await runWithSession('probe-search', async (page) => {
    await login(page, { siteLabel });
    await navigateToMembers(page);
    console.log('URL après navigate membres:', page.url());

    if (phone) {
      const r = await searchMember(page, phone);
      console.log('search phone:', r);
    }
    if (email) {
      const r = await searchMember(page, email);
      console.log('search email:', r);
    }
    if (last) {
      const r = await searchMemberByName(page, last, first);
      console.log('search name:', r);
    }

    if (phone && last) {
      const match = await findMemberByIdentity(page, {
        phone,
        email,
        last_name: last,
        first_name: first,
        birthdate: birth,
      });
      console.log('findMemberByIdentity (birth=', birth, '):', match);

      const bad = await findMemberByIdentity(page, {
        phone,
        email,
        last_name: last,
        first_name: first,
        birthdate: '2000-01-01',
      });
      console.log('findMemberByIdentity (birth WRONG):', bad);
    }

    // Dump liens idj visibles
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /idj/i.test(h)).slice(0, 20)
    );
    console.log('Liens idj page:', hrefs);
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const fh = await frame
        .evaluate(() =>
          [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /idj/i.test(h)).slice(0, 10)
        )
        .catch(() => []);
      if (fh.length) console.log('Liens idj frame', frame.url(), fh);
    }
  });

  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
