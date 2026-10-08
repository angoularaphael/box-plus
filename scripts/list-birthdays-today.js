#!/usr/bin/env node
'use strict';
/**
 * Liste les fiches Deciplus dont l'anniversaire est aujourd'hui (Europe/Paris).
 * Meme parcours que le bot ops. N'envoie aucun mail.
 *
 *   node scripts/list-birthdays-today.js
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { login, getAccessToken, gotoDeciplus } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const {
  collectBirthdayMembers,
  zoneIds,
} = require('../bot/birthday-wishes');
const { parisNow } = require('../storefront/lib/birthday-wishes');

const OUT = path.join(__dirname, '..', 'data', `birthdays-today-${Date.now()}.json`);

(async () => {
  const now = new Date();
  const today = parisNow(now);
  const report = {
    date: today.dateKey,
    zones: zoneIds(),
    scanned: 0,
    count: 0,
    members: [],
  };
  await runWithSession('list-birthdays-today', async (page) => {
    await gotoDeciplus(page, 'nextgen/home').catch(() => {});
    let token = await getAccessToken(page);
    if (!token) {
      await login(page, { siteLabel: 'Minimes' });
      token = await getAccessToken(page);
    }
    if (!token) throw new Error('Token Deciplus introuvable');
    const headers = {
      'x-access-token': token,
      'Deciplus-Client-Type': 'manager',
      Accept: 'application/json',
    };
    const members = await collectBirthdayMembers(page, headers, now);
    report.scanned = members._scanned || 0;
    report.members = members.map((m) => ({
      member_id: m.member_id,
      first_name: m.first_name,
      last_name: m.last_name,
      birthdate: m.birthdate,
      email: m.email || null,
      zone: m.zone,
      gym: m.gym_label || null,
    }));
    report.count = report.members.length;
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        date: report.date,
        zones: report.zones,
        scanned: report.scanned,
        count: report.count,
        members: report.members,
      },
      null,
      2
    )
  );
  await closeBrowser().catch(() => {});
})().catch(async (err) => {
  console.error(JSON.stringify({ error: err.message }));
  await closeBrowser().catch(() => {});
  process.exit(1);
});
