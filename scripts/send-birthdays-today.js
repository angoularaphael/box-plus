#!/usr/bin/env node
'use strict';
/**
 * Envoie les mails d'anniversaire du jour (Brevo). Pas de SMS.
 *
 *   node scripts/send-birthdays-today.js
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.BOT_ROLE = process.env.BOT_ROLE || 'ops';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const { runBirthdayWishes } = require('../bot/birthday-wishes');
const { closeBrowser } = require('../bot/browser-pool');

(async () => {
  const report = await runBirthdayWishes({ force: true });
  const rows = (report.results || []).map((r) => ({
    member_id: r.member_id,
    name: r.name,
    email: r.email || null,
    skipped: r.skipped || null,
  }));
  console.log(
    JSON.stringify(
      {
        date: report.date,
        scanned: report.scanned,
        due: report.due,
        sent: report.sent,
        results: rows,
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
